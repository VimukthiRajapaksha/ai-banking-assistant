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

// nonPayloadKeys are top-level request fields that never carry conversation
// content. Tool definitions in particular must not be scanned: an "accountId"
// property in a tool's input schema would be key-matched and the schema
// rewritten.
var nonPayloadKeys = map[string]bool{
	"tools":           true,
	"functions":       true,
	"tool_choice":     true,
	"function_call":   true,
	"response_format": true,
	"model":           true,
	"stream":          true,
	"stream_options":  true,
}

// skippedBlockTypes are content blocks the policy must never rewrite. Thinking
// blocks carry a signature over their exact bytes; media blocks carry no text.
var skippedBlockTypes = map[string]bool{
	"thinking":          true,
	"redacted_thinking": true,
	"image":             true,
	"image_url":         true,
	"input_audio":       true,
	"document":          true,
	"file":              true,
}

// maskRequest masks an LLM request body in place and reports whether it changed.
//
// A body with a "messages" array is treated as a conversation in the Anthropic
// Messages or OpenAI Chat Completions shape; one union walk handles both, so no
// provider sniffing is needed. Any other JSON body is walked generically, minus
// the non-payload fields, so the policy still protects requests it has no
// specific knowledge of.
func (m *masker) maskRequest(root *jsonNode) bool {
	changed := m.maskRequestPass(root)
	// Second pass: mask verbatim echoes of the values the first pass masked,
	// such as the agent's own earlier answers (see maskEchoes).
	if len(m.table.Entries) > 0 || len(m.redacted) > 0 {
		m.echo = true
		if m.maskRequestPass(root) {
			changed = true
		}
		m.echo = false
	}
	return changed
}

func (m *masker) maskRequestPass(root *jsonNode) bool {
	if root.Kind != kindObject {
		return m.maskTree(root, 0)
	}
	messages := root.get("messages")
	if messages == nil || messages.Kind != kindArray {
		changed := false
		for i, k := range root.Keys {
			if nonPayloadKeys[k] {
				continue
			}
			if m.maskTree(root.Values[i], 0) {
				changed = true
			}
		}
		return changed
	}

	changed := false
	if sys := root.get("system"); sys != nil && m.maskSystem(sys) {
		changed = true
	}
	for _, msg := range messages.Values {
		if m.maskMessage(msg) {
			changed = true
		}
	}
	return changed
}

// maskSystem scans an operator-authored system prompt with format detectors only.
func (m *masker) maskSystem(n *jsonNode) bool {
	switch n.Kind {
	case kindString:
		masked := m.maskFormatOnly(n.Scalar)
		if masked == n.Scalar {
			return false
		}
		n.Scalar = masked
		return true
	case kindArray:
		changed := false
		for _, block := range n.Values {
			if text := block.get("text"); text != nil && m.maskSystem(text) {
				changed = true
			}
		}
		return changed
	}
	return false
}

// maskMessage masks one conversation message: its text, tool results, and the
// arguments of tool calls already in the history. Those arguments were restored
// to real values on the previous turn, so without this they would reach the LLM
// in clear on the next one.
func (m *masker) maskMessage(msg *jsonNode) bool {
	if msg.Kind != kindObject {
		return false
	}
	role, _ := msg.get("role").str()
	if role == "system" || role == "developer" {
		if content := msg.get("content"); content != nil {
			return m.maskSystem(content)
		}
		return false
	}

	changed := false
	if content := msg.get("content"); content != nil {
		switch content.Kind {
		case kindString:
			if m.maskStringNode(content) {
				changed = true
			}
		case kindArray:
			for _, block := range content.Values {
				if m.maskBlock(block) {
					changed = true
				}
			}
		}
	}
	// OpenAI Chat Completions: tool calls carry their arguments as a JSON string.
	if calls := msg.get("tool_calls"); calls != nil && calls.Kind == kindArray {
		for _, call := range calls.Values {
			if args := call.get("function").get("arguments"); args != nil && m.maskStringNode(args) {
				changed = true
			}
		}
	}
	if fc := msg.get("function_call"); fc != nil {
		if args := fc.get("arguments"); args != nil && m.maskStringNode(args) {
			changed = true
		}
	}
	return changed
}

// maskBlock masks one content block.
func (m *masker) maskBlock(block *jsonNode) bool {
	if block.Kind != kindObject {
		return false
	}
	blockType, _ := block.get("type").str()
	if skippedBlockTypes[blockType] {
		return false
	}
	switch blockType {
	case "tool_use", "server_tool_use":
		if input := block.get("input"); input != nil {
			return m.maskTree(input, 0)
		}
		return false
	case "tool_result":
		content := block.get("content")
		if content == nil {
			return false
		}
		if content.Kind == kindString {
			return m.maskStringNode(content)
		}
		changed := false
		if content.Kind == kindArray {
			for _, inner := range content.Values {
				if m.maskBlock(inner) {
					changed = true
				}
			}
		}
		return changed
	}
	if text := block.get("text"); text != nil {
		return m.maskStringNode(text)
	}
	return false
}

// maskStringNode masks a string node that may hold a JSON document or free text.
func (m *masker) maskStringNode(n *jsonNode) bool {
	if n.Kind != kindString {
		return m.maskTree(n, 0)
	}
	masked, changed := m.maskStringValue(n.Scalar, 0)
	if changed {
		n.Scalar = masked
	}
	return changed
}
