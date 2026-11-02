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
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// jsonKind is the type of a jsonNode.
type jsonKind uint8

const (
	kindNull jsonKind = iota
	kindBool
	kindNumber
	kindString
	kindArray
	kindObject
)

const (
	// maxDocumentDepth bounds nesting in any one JSON document.
	maxDocumentDepth = 128
	// maxEmbeddedDepth bounds JSON-inside-a-JSON-string recursion (a tool result
	// that is itself a JSON document, holding another, …).
	maxEmbeddedDepth = 8
)

// jsonNode is an order-preserving JSON value. A Go map would reorder object keys
// on re-encoding, which changes prompt bytes (defeating provider prompt caching)
// and makes masked payloads hard to diff against the originals.
type jsonNode struct {
	Kind jsonKind
	// Scalar holds the string value, the number literal exactly as written, or
	// "true"/"false".
	Scalar string
	Keys   []string
	Values []*jsonNode
}

func (n *jsonNode) get(key string) *jsonNode {
	if n == nil || n.Kind != kindObject {
		return nil
	}
	for i, k := range n.Keys {
		if k == key {
			return n.Values[i]
		}
	}
	return nil
}

func (n *jsonNode) str() (string, bool) {
	if n == nil || n.Kind != kindString {
		return "", false
	}
	return n.Scalar, true
}

func newStringNode(s string) *jsonNode { return &jsonNode{Kind: kindString, Scalar: s} }

// parseJSON decodes a complete JSON document into an ordered tree.
func parseJSON(data []byte) (*jsonNode, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	n, err := parseNode(dec, 0)
	if err != nil {
		return nil, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("unexpected data after the JSON document")
	}
	return n, nil
}

func parseNode(dec *json.Decoder, depth int) (*jsonNode, error) {
	if depth > maxDocumentDepth {
		return nil, fmt.Errorf("JSON nesting exceeds %d levels", maxDocumentDepth)
	}
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch v := tok.(type) {
	case nil:
		return &jsonNode{Kind: kindNull}, nil
	case bool:
		if v {
			return &jsonNode{Kind: kindBool, Scalar: "true"}, nil
		}
		return &jsonNode{Kind: kindBool, Scalar: "false"}, nil
	case json.Number:
		return &jsonNode{Kind: kindNumber, Scalar: v.String()}, nil
	case string:
		return newStringNode(v), nil
	case json.Delim:
		switch v {
		case '{':
			n := &jsonNode{Kind: kindObject}
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, ok := kt.(string)
				if !ok {
					return nil, errors.New("object key is not a string")
				}
				val, err := parseNode(dec, depth+1)
				if err != nil {
					return nil, err
				}
				n.Keys = append(n.Keys, key)
				n.Values = append(n.Values, val)
			}
			if _, err := dec.Token(); err != nil { // '}'
				return nil, err
			}
			return n, nil
		case '[':
			n := &jsonNode{Kind: kindArray}
			for dec.More() {
				val, err := parseNode(dec, depth+1)
				if err != nil {
					return nil, err
				}
				n.Values = append(n.Values, val)
			}
			if _, err := dec.Token(); err != nil { // ']'
				return nil, err
			}
			return n, nil
		}
	}
	return nil, fmt.Errorf("unexpected JSON token %v", tok)
}

// encodeJSON writes the tree as compact JSON.
func encodeJSON(n *jsonNode) []byte {
	var b bytes.Buffer
	writeNode(&b, n)
	return b.Bytes()
}

func writeNode(b *bytes.Buffer, n *jsonNode) {
	switch n.Kind {
	case kindNull:
		b.WriteString("null")
	case kindBool, kindNumber:
		b.WriteString(n.Scalar)
	case kindString:
		b.WriteByte('"')
		b.WriteString(escapeJSONStringContent(n.Scalar))
		b.WriteByte('"')
	case kindArray:
		b.WriteByte('[')
		for i, v := range n.Values {
			if i > 0 {
				b.WriteByte(',')
			}
			writeNode(b, v)
		}
		b.WriteByte(']')
	case kindObject:
		b.WriteByte('{')
		for i, k := range n.Keys {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteByte('"')
			b.WriteString(escapeJSONStringContent(k))
			b.WriteString(`":`)
			writeNode(b, n.Values[i])
		}
		b.WriteByte('}')
	}
}

const hexDigits = "0123456789abcdef"

// escapeJSONStringContent returns s escaped for use between JSON string quotes.
// Unlike encoding/json it does not HTML-escape <, > and &, which would rewrite
// prompt text the policy has no reason to touch.
func escapeJSONStringContent(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 2)
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch {
			case c == '"':
				b.WriteString(`\"`)
			case c == '\\':
				b.WriteString(`\\`)
			case c == '\n':
				b.WriteString(`\n`)
			case c == '\r':
				b.WriteString(`\r`)
			case c == '\t':
				b.WriteString(`\t`)
			case c < 0x20:
				b.WriteString(`\u00`)
				b.WriteByte(hexDigits[c>>4])
				b.WriteByte(hexDigits[c&0xf])
			default:
				b.WriteByte(c)
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		switch {
		case r == utf8.RuneError && size == 1:
			b.WriteString(`�`)
		case r == ' ':
			b.WriteString(` `)
		case r == ' ':
			b.WriteString(` `)
		default:
			b.WriteString(s[i : i+size])
		}
		i += size
	}
	return b.String()
}

// parseEmbeddedJSON parses s as one or more JSON objects or arrays separated by
// whitespace, or reports false. A sequence is accepted because that is how many
// tool results arrive: pydantic-ai's MCP integration, for one, sends a
// multi-item result as pretty-printed objects one after another, and NDJSON is
// common in tool output. Scalars are not treated as documents: a tool result of
// "42" is text.
func parseEmbeddedJSON(s string) ([]*jsonNode, bool) {
	t := strings.TrimSpace(s)
	if len(t) < 2 || (t[0] != '{' && t[0] != '[') {
		return nil, false
	}
	dec := json.NewDecoder(strings.NewReader(t))
	dec.UseNumber()
	var docs []*jsonNode
	for {
		n, err := parseNode(dec, 0)
		if err == io.EOF && len(docs) > 0 {
			return docs, true
		}
		if err != nil || (n.Kind != kindObject && n.Kind != kindArray) {
			return nil, false
		}
		docs = append(docs, n)
	}
}

// encodeEmbedded re-encodes documents parsed by parseEmbeddedJSON: one document
// compactly, a sequence as one compact document per line (NDJSON).
func encodeEmbedded(docs []*jsonNode) string {
	parts := make([]string, len(docs))
	for i, d := range docs {
		parts[i] = string(encodeJSON(d))
	}
	return strings.Join(parts, "\n")
}

// maskTree masks a structured payload in place and reports whether it changed.
// Key matches mask the whole value; every other string goes through the text
// detectors, and a string that is itself a JSON document is walked recursively.
func (m *masker) maskTree(n *jsonNode, embedded int) bool {
	switch n.Kind {
	case kindObject:
		changed := false
		for i, k := range n.Keys {
			if entity, ok := m.cfg.keyIndex[normalizeKey(k)]; ok {
				if m.maskAllLeaves(n.Values[i], entity) {
					changed = true
				}
				continue
			}
			if m.maskTree(n.Values[i], embedded) {
				changed = true
			}
		}
		return changed
	case kindArray:
		changed := false
		for _, v := range n.Values {
			if m.maskTree(v, embedded) {
				changed = true
			}
		}
		return changed
	case kindString:
		masked, changed := m.maskStringValue(n.Scalar, embedded)
		if changed {
			n.Scalar = masked
		}
		return changed
	}
	return false
}

// maskStringValue masks one string that may hold a JSON document or free text.
func (m *masker) maskStringValue(s string, embedded int) (string, bool) {
	if embedded < maxEmbeddedDepth {
		if docs, ok := parseEmbeddedJSON(s); ok {
			changed := false
			for _, doc := range docs {
				if m.maskTree(doc, embedded+1) {
					changed = true
				}
			}
			if changed {
				return encodeEmbedded(docs), true
			}
			return s, false
		}
	}
	masked := m.maskText(s)
	return masked, masked != s
}

// maskAllLeaves masks every scalar under a key-matched value with one entity.
func (m *masker) maskAllLeaves(n *jsonNode, entity string) bool {
	switch n.Kind {
	case kindString:
		r := m.replacement(entity, n.Scalar, false)
		if r == n.Scalar {
			return false
		}
		n.Scalar = r
		return true
	case kindNumber:
		r := m.replacement(entity, n.Scalar, true)
		if r == n.Scalar {
			return false
		}
		n.Kind, n.Scalar = kindString, r
		return true
	case kindArray, kindObject:
		changed := false
		for _, v := range n.Values {
			if m.maskAllLeaves(v, entity) {
				changed = true
			}
		}
		return changed
	}
	return false
}

// restoreTree restores placeholders in every string of a response tree and
// reports whether it changed. A string that is exactly a placeholder for a
// number becomes that number again; a string holding a JSON document (an OpenAI
// tool-call "arguments" value) is restored inside the document, so an original
// containing quotes never breaks the document's syntax.
func restoreTree(n *jsonNode, t *placeholderTable, embedded int) bool {
	switch n.Kind {
	case kindObject, kindArray:
		changed := false
		for _, v := range n.Values {
			if restoreTree(v, t, embedded) {
				changed = true
			}
		}
		return changed
	case kindString:
		if !strings.Contains(n.Scalar, "[") {
			return false
		}
		if e, ok := t.Entries[n.Scalar]; ok {
			if e.Number {
				n.Kind = kindNumber
			}
			n.Scalar = e.Value
			return true
		}
		if embedded < maxEmbeddedDepth {
			if docs, ok := parseEmbeddedJSON(n.Scalar); ok {
				changed := false
				for _, doc := range docs {
					if restoreTree(doc, t, embedded+1) {
						changed = true
					}
				}
				if changed {
					n.Scalar = encodeEmbedded(docs)
				}
				return changed
			}
		}
		restored := restoreText(n.Scalar, t)
		if restored == n.Scalar {
			return false
		}
		n.Scalar = restored
		return true
	}
	return false
}
