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
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// RedactionMarker replaces values whose entity action is redact. It matches
// pii-masking-regex's redaction marker.
const RedactionMarker = "*****"

// placeholderPattern matches a placeholder minted by this policy:
// [<ENTITY>_<8, 12 or 16 lowercase hex>]. The alphabet is the one
// pii-masking-regex uses ([A-Z_] name, [0-9a-f] counter), so the streaming
// boundary rule carries over unchanged.
var placeholderPattern = regexp.MustCompile(`\[[A-Z][A-Z_]*_[0-9a-f]{8,16}\]`)

// placeholderTailPattern matches the text after an unclosed "[" when it could
// still become a placeholder: a run of the name alphabet, then of the hex one.
var placeholderTailPattern = regexp.MustCompile(`^[A-Z_]*[0-9a-f]{0,16}$`)

// restoreEntry is the original behind one placeholder.
type restoreEntry struct {
	Value string
	// Number records that the original was a JSON number, so a tool argument
	// whose whole value is the placeholder is restored as a number again.
	Number bool
}

// placeholderTable maps the placeholders minted for one request to their
// originals. It lives in request metadata and is the only thing restoration
// consults, so a placeholder typed by a user or produced by a prompt injection
// can never be turned into a value the request did not carry.
type placeholderTable struct {
	Entries map[string]restoreEntry
}

func newPlaceholderTable() *placeholderTable {
	return &placeholderTable{Entries: make(map[string]restoreEntry)}
}

// minEchoRunes is the shortest value whose verbatim echoes are masked. Shorter
// values (a 3-digit CVV, a 2-letter code) would match ordinary text.
const minEchoRunes = 4

// masker applies the configured actions while one request is processed.
type masker struct {
	cfg    *policyConfig
	table  *placeholderTable
	counts map[string]int
	// redacted records redacted values (value → entity) so their echoes can be
	// redacted too; they are never stored for restoration.
	redacted map[string]string
	// echo switches the text detectors to the echo pass (see maskEchoes).
	echo         bool
	echoReplacer *strings.Replacer
}

func newMasker(cfg *policyConfig) *masker {
	return &masker{cfg: cfg, table: newPlaceholderTable(), counts: make(map[string]int), redacted: make(map[string]string)}
}

// replacement returns what stands in for value: a placeholder for mask, or
// RedactionMarker for redact.
func (m *masker) replacement(entity, value string, number bool) string {
	e := m.cfg.entity(entity)
	if e == nil || value == "" {
		return value
	}
	if value == RedactionMarker || isPlaceholder(value) {
		return value
	}
	m.counts[entity]++
	if e.Action == ActionRedact {
		m.redacted[value] = entity
		return RedactionMarker
	}
	return m.mint(entity, value, number)
}

// mint derives a deterministic placeholder from an HMAC of the value. A keyed
// MAC rather than a plain hash: CVVs, dates and short IDs have value spaces small
// enough that an unkeyed hash could be reversed by brute force by anyone who
// sees the prompt, the LLM provider included.
func (m *masker) mint(entity, value string, number bool) string {
	mac := hmac.New(sha256.New, m.cfg.hmacKey)
	mac.Write([]byte(entity))
	mac.Write([]byte{0})
	mac.Write([]byte(value))
	sum := mac.Sum(nil)
	var ph string
	// Lengthen on the (vanishingly rare) collision with a different value in the
	// same request; 16 hex digits is the ceiling the pattern accepts.
	for n := 4; n <= 8; n += 2 {
		ph = "[" + entity + "_" + hex.EncodeToString(sum[:n]) + "]"
		existing, taken := m.table.Entries[ph]
		if !taken {
			m.table.Entries[ph] = restoreEntry{Value: value, Number: number}
			return ph
		}
		if existing.Value == value {
			return ph
		}
	}
	return ph
}

// maskText replaces every NPI span found in free text.
func (m *masker) maskText(s string) string {
	if m.echo {
		return m.maskEchoes(s)
	}
	return m.maskSpans(s, findSpans(s, m.cfg, true))
}

// maskFormatOnly replaces only values found by their format. Used for system
// prompts, which are operator-authored instructions rather than customer data.
func (m *masker) maskFormatOnly(s string) string {
	if m.echo {
		return m.maskEchoes(s)
	}
	return m.maskSpans(s, findSpans(s, m.cfg, false))
}

// maskEchoes replaces verbatim occurrences of values already masked elsewhere in
// the same request.
//
// This closes a leak the detectors cannot: an agent re-sends its own earlier
// answers, which the response phase restored for the user. A value found only
// by its JSON key ("accountNumber": "••••7756") reappears there as bare prose
// ("Account: ••••7756"), with no key and no recognisable format. The tool result
// it came from is in the same request's history, so the value is known.
// Existing placeholders are left untouched, so a value that happens to look like
// placeholder hex is never replaced inside one.
func (m *masker) maskEchoes(s string) string {
	if m.echoReplacer == nil {
		m.echoReplacer = m.buildEchoReplacer()
	}
	if m.echoReplacer == nil || s == "" {
		return s
	}
	locs := placeholderPattern.FindAllStringIndex(s, -1)
	if len(locs) == 0 {
		return m.echoReplacer.Replace(s)
	}
	var b strings.Builder
	b.Grow(len(s))
	last := 0
	for _, loc := range locs {
		b.WriteString(m.echoReplacer.Replace(s[last:loc[0]]))
		b.WriteString(s[loc[0]:loc[1]])
		last = loc[1]
	}
	b.WriteString(m.echoReplacer.Replace(s[last:]))
	return b.String()
}

// buildEchoReplacer returns a replacer from every masked or redacted value to its
// stand-in, longest value first so a value containing another wins.
func (m *masker) buildEchoReplacer() *strings.Replacer {
	type pair struct{ value, stand string }
	var pairs []pair
	for ph, e := range m.table.Entries {
		if utf8.RuneCountInString(e.Value) >= minEchoRunes {
			pairs = append(pairs, pair{e.Value, ph})
		}
	}
	for v := range m.redacted {
		if utf8.RuneCountInString(v) >= minEchoRunes {
			pairs = append(pairs, pair{v, RedactionMarker})
		}
	}
	if len(pairs) == 0 {
		return nil
	}
	sort.Slice(pairs, func(i, j int) bool {
		if len(pairs[i].value) != len(pairs[j].value) {
			return len(pairs[i].value) > len(pairs[j].value)
		}
		return pairs[i].value < pairs[j].value
	})
	args := make([]string, 0, 2*len(pairs))
	for _, p := range pairs {
		args = append(args, p.value, p.stand)
	}
	return strings.NewReplacer(args...)
}

func (m *masker) maskSpans(s string, spans []span) string {
	if len(spans) == 0 {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	last := 0
	for _, sp := range spans {
		b.WriteString(s[last:sp.Start])
		b.WriteString(m.replacement(sp.Entity, s[sp.Start:sp.End], false))
		last = sp.End
	}
	b.WriteString(s[last:])
	return b.String()
}

func (m *masker) total() int {
	n := 0
	for _, c := range m.counts {
		n += c
	}
	return n
}

func isPlaceholder(s string) bool {
	loc := placeholderPattern.FindStringIndex(s)
	return loc != nil && loc[0] == 0 && loc[1] == len(s)
}

// restoreText replaces the table's placeholders in decoded text. Placeholders the
// table does not hold are left as they are.
func restoreText(s string, t *placeholderTable) string {
	if t == nil || len(t.Entries) == 0 || !strings.Contains(s, "[") {
		return s
	}
	return placeholderPattern.ReplaceAllStringFunc(s, func(ph string) string {
		if e, ok := t.Entries[ph]; ok {
			return e.Value
		}
		return ph
	})
}

// restoreJSONFragment restores placeholders inside raw JSON text, such as a
// streamed tool-argument fragment. The original is inserted JSON-string-escaped,
// and a placeholder that is the whole of a string literal whose original was a
// number replaces the quotes too, giving the number back its type.
func restoreJSONFragment(s string, t *placeholderTable) string {
	if t == nil || len(t.Entries) == 0 || !strings.Contains(s, "[") {
		return s
	}
	locs := placeholderPattern.FindAllStringIndex(s, -1)
	if len(locs) == 0 {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	last := 0
	for _, loc := range locs {
		ph := s[loc[0]:loc[1]]
		e, ok := t.Entries[ph]
		if !ok {
			continue
		}
		start, end := loc[0], loc[1]
		if e.Number && start > 0 && end < len(s) && s[start-1] == '"' && s[end] == '"' && start-1 >= last {
			b.WriteString(s[last : start-1])
			b.WriteString(e.Value)
			last = end + 1
			continue
		}
		b.WriteString(s[last:start])
		b.WriteString(escapeJSONStringContent(e.Value))
		last = end
	}
	b.WriteString(s[last:])
	return b.String()
}
