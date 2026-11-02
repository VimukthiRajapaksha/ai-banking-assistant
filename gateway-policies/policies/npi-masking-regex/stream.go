/*
 *  Copyright (c) 2026, WSO2 LLC. (http://www.wso2.org) All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */

package npimaskingregex

import (
	"encoding/json"
	"strconv"
	"strings"
)

// ─── Streaming restore ───────────────────────────────────────────
//
// Accumulation is the policy engine's job: it buffers response chunks and hands
// them over only once NeedsMoreResponseData stops asking for more. As in
// pii-masking-regex, the rule is "never release a window that ends inside a
// placeholder", so every flushed window is restored on its own, statelessly.
//
// Unlike pii-masking-regex, two streams are tracked rather than one: assistant
// text, and tool-call argument fragments. The second is what lets a streamed
// get_transactions({"accountId":"[ACCOUNT_ID_…]"}) reach the agent restored.

// maxPlaceholderTailBytes bounds how much text may accumulate after an unclosed
// "[" before it is released regardless of shape. The longest possible
// placeholder for a sensibly named entity is well under this.
const maxPlaceholderTailBytes = 64

const (
	sseDataPrefix = "data: "
	sseDataField  = "data:"
	sseEventField = "event:"
	sseDone       = "[DONE]"
)

// fragmentKind says how a streamed fragment is restored.
type fragmentKind uint8

const (
	// fragmentText is decoded assistant text: the original is inserted as is.
	fragmentText fragmentKind = iota
	// fragmentJSON is a slice of raw JSON (tool-call arguments): the original is
	// inserted JSON-escaped, or as a bare number when it was one.
	fragmentJSON
)

// fragment is one delta field inside one SSE data line.
type fragment struct {
	line  int
	root  *jsonNode
	field *jsonNode
	kind  fragmentKind
}

// sseWindow is a parsed SSE buffer: its lines, and the delta fragments grouped
// per logical stream (one content block, or one choice's text / one tool call).
type sseWindow struct {
	lines   []string
	order   []string
	streams map[string][]fragment
}

// parseSSEWindow extracts every delta fragment from an SSE buffer. Lines that are
// not data lines, or whose payload is not a recognised delta, are left alone.
func parseSSEWindow(s string) *sseWindow {
	w := &sseWindow{lines: strings.Split(s, "\n"), streams: make(map[string][]fragment)}
	for i, line := range w.lines {
		payload, ok := sseDataPayload(line)
		if !ok || payload == sseDone {
			continue
		}
		root, err := parseJSON([]byte(payload))
		if err != nil || root.Kind != kindObject {
			continue
		}
		for _, f := range deltaFragments(root) {
			f.fragment.line = i
			f.fragment.root = root
			if _, seen := w.streams[f.key]; !seen {
				w.order = append(w.order, f.key)
			}
			w.streams[f.key] = append(w.streams[f.key], f.fragment)
		}
	}
	return w
}

type keyedFragment struct {
	key      string
	fragment fragment
}

// deltaFragments finds the restorable delta fields in one SSE payload.
//
//	Anthropic   content_block_delta → delta.text (text_delta)
//	                                → delta.partial_json (input_json_delta)
//	OpenAI      choices[i].delta.content
//	            choices[i].delta.tool_calls[j].function.arguments
func deltaFragments(root *jsonNode) []keyedFragment {
	var out []keyedFragment
	if t, _ := root.get("type").str(); t == "content_block_delta" {
		idx := scalarOr(root.get("index"), "0")
		delta := root.get("delta")
		switch dt, _ := delta.get("type").str(); dt {
		case "text_delta":
			if f := delta.get("text"); f != nil && f.Kind == kindString {
				out = append(out, keyedFragment{"a:" + idx, fragment{field: f, kind: fragmentText}})
			}
		case "input_json_delta":
			if f := delta.get("partial_json"); f != nil && f.Kind == kindString {
				out = append(out, keyedFragment{"a:" + idx, fragment{field: f, kind: fragmentJSON}})
			}
		}
		return out
	}
	choices := root.get("choices")
	if choices == nil || choices.Kind != kindArray {
		return nil
	}
	for ci, choice := range choices.Values {
		cidx := scalarOr(choice.get("index"), strconv.Itoa(ci))
		delta := choice.get("delta")
		if f := delta.get("content"); f != nil && f.Kind == kindString {
			out = append(out, keyedFragment{"o:" + cidx + ":c", fragment{field: f, kind: fragmentText}})
		}
		calls := delta.get("tool_calls")
		if calls == nil || calls.Kind != kindArray {
			continue
		}
		for ti, call := range calls.Values {
			tidx := scalarOr(call.get("index"), strconv.Itoa(ti))
			if f := call.get("function").get("arguments"); f != nil && f.Kind == kindString {
				out = append(out, keyedFragment{"o:" + cidx + ":t" + tidx, fragment{field: f, kind: fragmentJSON}})
			}
		}
	}
	return out
}

func scalarOr(n *jsonNode, def string) string {
	if n == nil || (n.Kind != kindNumber && n.Kind != kindString) {
		return def
	}
	return n.Scalar
}

func (w *sseWindow) concat(key string) (string, fragmentKind) {
	frags := w.streams[key]
	var b strings.Builder
	for _, f := range frags {
		b.WriteString(f.field.Scalar)
	}
	return b.String(), frags[0].kind
}

// restoreSSE restores every stream in an SSE window. Each stream's fragments are
// concatenated, restored as a whole, and written back: the first fragment takes
// the restored text and the rest become empty strings. Emptying rather than
// dropping events keeps every event, and every Anthropic "event:" line, intact.
func restoreSSE(s string, t *placeholderTable) (string, bool) {
	w := parseSSEWindow(s)
	dirty := make(map[int]*jsonNode)
	for _, key := range w.order {
		full, kind := w.concat(key)
		var restored string
		if kind == fragmentJSON {
			restored = restoreJSONFragment(full, t)
		} else {
			restored = restoreText(full, t)
		}
		if restored == full {
			continue
		}
		for i, f := range w.streams[key] {
			if i == 0 {
				f.field.Scalar = restored
			} else {
				f.field.Scalar = ""
			}
			dirty[f.line] = f.root
		}
	}
	if len(dirty) == 0 {
		return s, false
	}
	for i, root := range dirty {
		line := w.lines[i]
		cr := strings.HasSuffix(line, "\r")
		rebuilt := sseDataPrefix + string(encodeJSON(root))
		if cr {
			rebuilt += "\r"
		}
		w.lines[i] = rebuilt
	}
	return strings.Join(w.lines, "\n"), true
}

// needsMoreSSE reports whether an SSE window must keep buffering: it ends inside
// an event, or some stream ends in a placeholder that is not yet complete. A tool
// argument that ends on the quote opening a value, or exactly on a placeholder,
// also waits one more event, so both quotes are in the same window when a number
// is restored without them.
func needsMoreSSE(s string) bool {
	if !endsAtSSEEventBoundary(s) {
		return true
	}
	w := parseSSEWindow(s)
	for _, key := range w.order {
		full, kind := w.concat(key)
		if couldCompletePlaceholder(full) {
			return true
		}
		if kind == fragmentJSON && (endsWithPlaceholder(full) || endsWithValueQuote(full)) {
			return true
		}
	}
	return false
}

// endsWithValueQuote reports whether raw JSON text ends on a quote. A window
// cannot see what the previous one ended with, so any trailing quote may be the
// one opening a value, and holding it costs at most one event.
func endsWithValueQuote(s string) bool {
	return strings.HasSuffix(s, `"`)
}

func endsWithPlaceholder(s string) bool {
	locs := placeholderPattern.FindAllStringIndex(s, -1)
	return len(locs) > 0 && locs[len(locs)-1][1] == len(s)
}

// couldCompletePlaceholder reports whether content ends in an unclosed "[" whose
// trailing text is still a viable placeholder prefix.
func couldCompletePlaceholder(content string) bool {
	lastOpen := strings.LastIndex(content, "[")
	if lastOpen == -1 {
		return false
	}
	tail := content[lastOpen+1:]
	if strings.Contains(tail, "]") {
		return false
	}
	if len(tail) > maxPlaceholderTailBytes {
		return false
	}
	return placeholderTailPattern.MatchString(tail)
}

// endsAtSSEEventBoundary reports whether s ends on a complete SSE event, with
// either terminator.
func endsAtSSEEventBoundary(s string) bool {
	return strings.HasSuffix(s, "\n\n") || strings.HasSuffix(s, "\r\n\r\n")
}

// sseDataPayload returns the payload of an SSE data line and whether line is one.
// The space after "data:" is optional in the SSE grammar.
func sseDataPayload(line string) (string, bool) {
	body := strings.TrimSuffix(line, "\r")
	if !strings.HasPrefix(body, sseDataField) {
		return "", false
	}
	return strings.TrimPrefix(strings.TrimPrefix(body, sseDataField), " "), true
}

// isSSE reports whether a buffer looks like an SSE stream.
func isSSE(s string) bool {
	for _, line := range strings.SplitN(s, "\n", 5) {
		line = strings.TrimSuffix(line, "\r")
		if strings.HasPrefix(line, sseDataField) || strings.HasPrefix(line, sseEventField) {
			return true
		}
	}
	return false
}

// needsMoreJSON reports whether a non-SSE body is still incomplete JSON.
func needsMoreJSON(s string) bool {
	t := strings.TrimSpace(s)
	return t != "" && !json.Valid([]byte(t))
}
