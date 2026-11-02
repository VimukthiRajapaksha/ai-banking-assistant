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
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	policy "github.com/wso2/api-platform/sdk/core/policy/v1alpha2"
)

// simulateKernel feeds SSE events to the policy the way the policy engine does:
// events accumulate until NeedsMoreResponseData says the window may be released,
// the window is passed to OnResponseBodyChunk, and whatever is left is flushed at
// end of stream.
func simulateKernel(t *testing.T, p *NPIMaskingRegexPolicy, shared *policy.SharedContext, events []string) string {
	t.Helper()
	ctx := &policy.ResponseStreamContext{SharedContext: shared}
	var out, window strings.Builder
	flush := func(eos bool) {
		chunk := window.String()
		window.Reset()
		action := p.OnResponseBodyChunk(context.Background(), ctx, &policy.StreamBody{Chunk: []byte(chunk), EndOfStream: eos}, nil)
		fwd, ok := action.(policy.ForwardResponseChunk)
		if !ok {
			t.Fatalf("unexpected streaming action %T", action)
		}
		if fwd.Body != nil {
			out.Write(fwd.Body)
		} else {
			out.WriteString(chunk)
		}
	}
	for _, e := range events {
		window.WriteString(e)
		if !p.NeedsMoreResponseData([]byte(window.String())) {
			flush(false)
		}
	}
	if window.Len() > 0 {
		flush(true)
	}
	return out.String()
}

func anthropicTextEvent(text string) string {
	b, _ := json.Marshal(map[string]interface{}{
		"type": "content_block_delta", "index": 0,
		"delta": map[string]interface{}{"type": "text_delta", "text": text},
	})
	return "event: content_block_delta\ndata: " + string(b) + "\n\n"
}

func anthropicJSONEvent(index int, partial string) string {
	b, _ := json.Marshal(map[string]interface{}{
		"type": "content_block_delta", "index": index,
		"delta": map[string]interface{}{"type": "input_json_delta", "partial_json": partial},
	})
	return "event: content_block_delta\ndata: " + string(b) + "\n\n"
}

func openAIArgsEvent(args string) string {
	b, _ := json.Marshal(map[string]interface{}{
		"object": "chat.completion.chunk",
		"choices": []interface{}{map[string]interface{}{
			"index": 0,
			"delta": map[string]interface{}{"tool_calls": []interface{}{map[string]interface{}{
				"index": 0, "function": map[string]interface{}{"arguments": args},
			}}},
		}},
	})
	return "data: " + string(b) + "\n\n"
}

// assembled reconstructs what an SSE client sees for one Anthropic block or one
// OpenAI tool call.
func assembled(t *testing.T, stream string) string {
	t.Helper()
	var b strings.Builder
	for _, line := range strings.Split(stream, "\n") {
		payload, ok := sseDataPayload(line)
		if !ok || payload == sseDone {
			continue
		}
		root, err := parseJSON([]byte(payload))
		if err != nil {
			t.Fatalf("forwarded an invalid SSE payload %q: %v", payload, err)
		}
		for _, f := range deltaFragments(root) {
			b.WriteString(f.fragment.field.Scalar)
		}
	}
	return b.String()
}

// splits returns s cut into two pieces at every byte offset, plus one piece per
// byte, which together cover every way an upstream can tokenise a placeholder.
func splits(s string) [][]string {
	var out [][]string
	for i := 1; i < len(s); i++ {
		out = append(out, []string{s[:i], s[i:]})
	}
	perByte := make([]string, 0, len(s))
	for i := 0; i < len(s); i++ {
		perByte = append(perByte, s[i:i+1])
	}
	return append(out, perByte)
}

func streamSetup(t *testing.T) (*NPIMaskingRegexPolicy, *policy.SharedContext, string) {
	t.Helper()
	p := newTestPolicy(t, nil)
	_, shared := runRequest(t, p, readFixture(t, "anthropic_turn2_request.json"))
	return p, shared, placeholderFor(t, shared, "acc-chk-1120")
}

func TestStream_AnthropicText_EverySplit(t *testing.T) {
	p, shared, ph := streamSetup(t)
	text := "Your checking account " + ph + " is ready."
	for _, parts := range splits(text) {
		events := make([]string, 0, len(parts))
		for _, part := range parts {
			events = append(events, anthropicTextEvent(part))
		}
		got := assembled(t, simulateKernel(t, p, shared, events))
		if got != "Your checking account acc-chk-1120 is ready." {
			t.Fatalf("split %q: client saw %q", parts, got)
		}
	}
}

func TestStream_AnthropicToolArgs_EverySplit(t *testing.T) {
	p, shared, ph := streamSetup(t)
	args := `{"accountId": "` + ph + `", "limit": 10}`
	for _, parts := range splits(args) {
		events := make([]string, 0, len(parts))
		for _, part := range parts {
			events = append(events, anthropicJSONEvent(1, part))
		}
		got := assembled(t, simulateKernel(t, p, shared, events))
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(got), &parsed); err != nil {
			t.Fatalf("split %q: assembled arguments are not JSON: %q", parts, got)
		}
		if parsed["accountId"] != "acc-chk-1120" {
			t.Fatalf("split %q: accountId = %v", parts, parsed["accountId"])
		}
	}
}

func TestStream_OpenAIToolArgs_EverySplit(t *testing.T) {
	p, shared, ph := streamSetup(t)
	args := `{"accountId":"` + ph + `","limit":10}`
	for _, parts := range splits(args) {
		events := make([]string, 0, len(parts)+1)
		for _, part := range parts {
			events = append(events, openAIArgsEvent(part))
		}
		events = append(events, "data: [DONE]\n\n")
		got := assembled(t, simulateKernel(t, p, shared, events))
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(got), &parsed); err != nil || parsed["accountId"] != "acc-chk-1120" {
			t.Fatalf("split %q: got %q (%v)", parts, got, err)
		}
	}
}

func TestStream_NumberRestoredWithoutQuotes(t *testing.T) {
	p := newTestPolicy(t, nil)
	_, shared := runRequest(t, p, []byte(`{"messages":[{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"{\"accountNumber\":40031122}"}]}]}`))
	ph := placeholderFor(t, shared, "40031122")
	args := `{"accountNumber":"` + ph + `"}`
	for _, parts := range splits(args) {
		events := make([]string, 0, len(parts))
		for _, part := range parts {
			events = append(events, anthropicJSONEvent(0, part))
		}
		got := assembled(t, simulateKernel(t, p, shared, events))
		if got != `{"accountNumber":40031122}` {
			t.Fatalf("split %q: got %q", parts, got)
		}
	}
}

func TestStream_EventLinesKept(t *testing.T) {
	p, shared, ph := streamSetup(t)
	events := []string{
		"event: message_start\ndata: {\"type\":\"message_start\"}\n\n",
		anthropicTextEvent("id " + ph[:5]),
		anthropicTextEvent(ph[5:] + " done"),
		": keep-alive\n\n",
		"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
	}
	out := simulateKernel(t, p, shared, events)
	if strings.Count(out, "event: content_block_delta") != 2 || !strings.Contains(out, ": keep-alive") || !strings.Contains(out, "message_stop") {
		t.Fatalf("stream structure changed:\n%s", out)
	}
	if got := assembled(t, out); got != "id acc-chk-1120 done" {
		t.Fatalf("got %q", got)
	}
}

func TestStream_ProseBracketReleasedImmediately(t *testing.T) {
	p, _, _ := streamSetup(t)
	if p.NeedsMoreResponseData([]byte(anthropicTextEvent("see [note"))) {
		t.Fatal("lowercase text after '[' cannot be a placeholder and must not be held")
	}
	if !p.NeedsMoreResponseData([]byte(anthropicTextEvent("see [ACCOUNT_I"))) {
		t.Fatal("a partial placeholder must be held")
	}
	if !p.NeedsMoreResponseData([]byte("event: content_block_delta\ndata: {\"type\":")) {
		t.Fatal("a partial event must be held")
	}
}

func TestStream_NonSSEChunkedJSON(t *testing.T) {
	p, shared, ph := streamSetup(t)
	body := `{"content":[{"type":"text","text":"acct ` + ph + `"}]}`
	if !p.NeedsMoreResponseData([]byte(body[:20])) {
		t.Fatal("incomplete JSON must be held")
	}
	action := p.OnResponseBodyChunk(context.Background(), &policy.ResponseStreamContext{SharedContext: shared},
		&policy.StreamBody{Chunk: []byte(body), EndOfStream: true}, nil)
	if got := string(action.(policy.ForwardResponseChunk).Body); !strings.Contains(got, "acct acc-chk-1120") {
		t.Fatalf("got %s", got)
	}
}

func TestStream_NoTableIsPassThrough(t *testing.T) {
	p := newTestPolicy(t, nil)
	action := p.OnResponseBodyChunk(context.Background(),
		&policy.ResponseStreamContext{SharedContext: &policy.SharedContext{Metadata: map[string]interface{}{}}},
		&policy.StreamBody{Chunk: []byte(anthropicTextEvent("[ACCOUNT_ID_0123abcd]"))}, nil)
	if action.(policy.ForwardResponseChunk).Body != nil {
		t.Fatal("chunk modified without a placeholder table")
	}
}

func ExampleNPIMaskingRegexPolicy_streaming() {
	fmt.Println(couldCompletePlaceholder("account [ACCOUNT_ID_3f"), couldCompletePlaceholder("see [docs"))
	// Output: true false
}
