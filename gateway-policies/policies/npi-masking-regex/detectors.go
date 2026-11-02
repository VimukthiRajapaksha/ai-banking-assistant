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
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

const (
	// IBANRegex finds IBAN candidates, with or without the 4-character grouping.
	IBANRegex = `\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b`
	// CardNumberRegex finds 13–19 digit runs, optionally grouped by spaces or dashes.
	CardNumberRegex = `\b\d(?:[ -]?\d){12,18}\b`
	// PhoneRegex finds E.164 numbers. The leading "+" is required on purpose:
	// without it a phone number is indistinguishable from an account number.
	PhoneRegex = `\+[1-9](?:[ -]?\d){6,14}\b`
	// EmailRegex is pii-masking-regex's built-in email pattern.
	EmailRegex = `(?i)\b[a-z0-9.!#$%&'*+/=?^_{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])\b`
)

// formatDetector finds an entity by the shape of its value alone, so it applies
// to free text and to every JSON string value.
type formatDetector struct {
	Entity   string
	Pattern  *regexp.Regexp
	Validate func(match string) bool
}

// labelDetector finds an entity in prose by the label in front of it. Capture
// group 1 is the value; only that group is masked, so the label survives.
type labelDetector struct {
	Entity      string
	Pattern     *regexp.Regexp
	NeedsDigit  bool
	phraseCount int
}

// span is a detected value inside a string.
type span struct {
	Start, End int
	Entity     string
}

// buildFormatDetectors returns the format detectors for the enabled entities, in
// priority order: IBAN before card number (the digits inside an IBAN pass a card
// regex), then phone, then email, then custom value regexes.
func buildFormatDetectors(cfg *policyConfig) []formatDetector {
	var out []formatDetector
	if cfg.entity(EntityIBAN) != nil {
		out = append(out, formatDetector{EntityIBAN, regexp.MustCompile(IBANRegex), validIBAN})
	}
	if cfg.entity(EntityCardNumber) != nil {
		out = append(out, formatDetector{EntityCardNumber, regexp.MustCompile(CardNumberRegex), validCardNumber})
	}
	if cfg.entity(EntityPhone) != nil {
		out = append(out, formatDetector{EntityPhone, regexp.MustCompile(PhoneRegex), nil})
	}
	if cfg.entity(EntityEmail) != nil {
		out = append(out, formatDetector{EntityEmail, regexp.MustCompile(EmailRegex), nil})
	}
	var customs []*entityConfig
	for _, e := range cfg.entities {
		if e.ValueRegex != nil {
			customs = append(customs, e)
		}
	}
	sort.Slice(customs, func(i, j int) bool { return customs[i].Name < customs[j].Name })
	for _, e := range customs {
		out = append(out, formatDetector{e.Name, e.ValueRegex, nil})
	}
	return out
}

// buildLabelDetectors compiles one label regex per entity that has both keys and
// a value shape. Keys are split into words and quoted, so operators never write a
// regex for a key-based entity.
func buildLabelDetectors(cfg *policyConfig) ([]labelDetector, error) {
	names := make([]string, 0, len(cfg.entities))
	for n := range cfg.entities {
		names = append(names, n)
	}
	sort.Strings(names)

	var out []labelDetector
	for _, n := range names {
		e := cfg.entities[n]
		if e.LabelValue == "" || len(e.Keys) == 0 {
			continue
		}
		seen := make(map[string]bool)
		var phrases []string
		for _, k := range e.Keys {
			words := splitKeyWords(k)
			if len(words) == 0 {
				continue
			}
			quoted := make([]string, len(words))
			for i, w := range words {
				quoted[i] = regexp.QuoteMeta(w)
			}
			p := strings.Join(quoted, `[ \t_-]*`)
			if !seen[p] {
				seen[p] = true
				phrases = append(phrases, p)
			}
		}
		if len(phrases) == 0 {
			continue
		}
		// Longest phrase first, so "account number" wins over "account".
		sort.Slice(phrases, func(i, j int) bool { return len(phrases[i]) > len(phrases[j]) })
		expr := fmt.Sprintf(`(?i:\b(?:%s)\b)[ \t]*(?:[:#=]|(?i:is\b|no\.|no\b))?[ \t]*(%s)\b`,
			strings.Join(phrases, "|"), e.LabelValue)
		re, err := regexp.Compile(expr)
		if err != nil {
			return nil, fmt.Errorf("entity %q: cannot build label pattern: %w", e.Name, err)
		}
		out = append(out, labelDetector{Entity: e.Name, Pattern: re, NeedsDigit: e.LabelNeedsDigit, phraseCount: len(phrases)})
	}
	return out, nil
}

// splitKeyWords splits a key into lower-case words at case changes, digits-to-
// letters boundaries and separators: "addressLine1" → [address line 1].
func splitKeyWords(key string) []string {
	var words []string
	var cur []rune
	flush := func() {
		if len(cur) > 0 {
			words = append(words, strings.ToLower(string(cur)))
			cur = cur[:0]
		}
	}
	runes := []rune(key)
	for i, r := range runes {
		switch {
		case !unicode.IsLetter(r) && !unicode.IsDigit(r):
			flush()
		case unicode.IsUpper(r) && i > 0 && (unicode.IsLower(runes[i-1]) || unicode.IsDigit(runes[i-1])):
			flush()
			cur = append(cur, r)
		case unicode.IsDigit(r) && i > 0 && unicode.IsLetter(runes[i-1]):
			flush()
			cur = append(cur, r)
		default:
			cur = append(cur, r)
		}
	}
	flush()
	return words
}

// findSpans returns the non-overlapping NPI spans in s, sorted by position.
// Format detectors run first and in priority order; label detectors then claim
// only what is still free. A span already holding a placeholder is never
// re-examined, so masking is idempotent. withLabels false runs the format
// detectors only, which is how operator-authored system prompts are scanned.
func findSpans(s string, cfg *policyConfig, withLabels bool) []span {
	if s == "" {
		return nil
	}
	var spans []span
	overlaps := func(start, end int) bool {
		for _, sp := range spans {
			if start < sp.End && sp.Start < end {
				return true
			}
		}
		return false
	}
	for _, loc := range placeholderPattern.FindAllStringIndex(s, -1) {
		spans = append(spans, span{Start: loc[0], End: loc[1]}) // reserved, Entity ""
	}
	for _, d := range cfg.formatDetectors {
		for _, loc := range d.Pattern.FindAllStringIndex(s, -1) {
			if overlaps(loc[0], loc[1]) {
				continue
			}
			if d.Validate != nil && !d.Validate(s[loc[0]:loc[1]]) {
				continue
			}
			spans = append(spans, span{Start: loc[0], End: loc[1], Entity: d.Entity})
		}
	}
	if !withLabels {
		return sortedEntitySpans(spans)
	}
	for _, d := range cfg.labelDetectors {
		for _, m := range d.Pattern.FindAllStringSubmatchIndex(s, -1) {
			start, end := m[2], m[3]
			if start < 0 || overlaps(start, end) {
				continue
			}
			if d.NeedsDigit && !strings.ContainsAny(s[start:end], "0123456789") {
				continue
			}
			spans = append(spans, span{Start: start, End: end, Entity: d.Entity})
		}
	}
	return sortedEntitySpans(spans)
}

// sortedEntitySpans drops the reserved placeholder spans and sorts the rest.
func sortedEntitySpans(spans []span) []span {
	out := spans[:0]
	for _, sp := range spans {
		if sp.Entity != "" {
			out = append(out, sp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

// validCardNumber accepts a 13–19 digit payment card number that passes the Luhn
// checksum and starts with a major-network issuer digit (2–6). Digit runs that
// start with 0, 1, 7, 8 or 9 (epoch-millisecond timestamps, phone numbers,
// reference numbers) are rejected even when they happen to pass Luhn.
func validCardNumber(s string) bool {
	digits := stripSeparators(s)
	if len(digits) < 13 || len(digits) > 19 {
		return false
	}
	if digits[0] < '2' || digits[0] > '6' {
		return false
	}
	return luhnValid(digits)
}

func luhnValid(digits string) bool {
	sum := 0
	double := false
	for i := len(digits) - 1; i >= 0; i-- {
		d := int(digits[i] - '0')
		if d < 0 || d > 9 {
			return false
		}
		if double {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		double = !double
	}
	return sum%10 == 0
}

// ibanLengths is the ISO 13616 IBAN length per country (SWIFT IBAN registry).
var ibanLengths = map[string]int{
	"AD": 24, "AE": 23, "AL": 28, "AT": 20, "AZ": 28, "BA": 20, "BE": 16, "BG": 22,
	"BH": 22, "BI": 27, "BR": 29, "BY": 28, "CH": 21, "CR": 22, "CY": 28, "CZ": 24,
	"DE": 22, "DJ": 27, "DK": 18, "DO": 28, "EE": 20, "EG": 29, "ES": 24, "FI": 18,
	"FK": 18, "FO": 18, "FR": 27, "GB": 22, "GE": 22, "GI": 23, "GL": 18, "GR": 27,
	"GT": 28, "HN": 28, "HR": 21, "HU": 28, "IE": 22, "IL": 23, "IQ": 23, "IS": 26,
	"IT": 27, "JO": 30, "KW": 30, "KZ": 20, "LB": 28, "LC": 32, "LI": 21, "LT": 20,
	"LU": 20, "LV": 21, "LY": 25, "MC": 27, "MD": 24, "ME": 22, "MK": 19, "MN": 20,
	"MR": 27, "MT": 31, "MU": 30, "NI": 28, "NL": 18, "NO": 15, "OM": 23, "PK": 24,
	"PL": 28, "PS": 29, "PT": 25, "QA": 29, "RO": 24, "RS": 22, "RU": 33, "SA": 24,
	"SC": 31, "SD": 18, "SE": 24, "SI": 19, "SK": 24, "SM": 27, "SO": 23, "ST": 25,
	"SV": 28, "TL": 23, "TN": 24, "TR": 26, "UA": 29, "VA": 22, "VG": 24, "XK": 20,
	"YE": 30,
}

var ninetySeven = big.NewInt(97)

// validIBAN checks the country length and the ISO 7064 mod-97 checksum.
func validIBAN(s string) bool {
	iban := stripSeparators(s)
	if len(iban) < 15 {
		return false
	}
	want, ok := ibanLengths[iban[:2]]
	if !ok || len(iban) != want {
		return false
	}
	rearranged := iban[4:] + iban[:4]
	var numeric strings.Builder
	for _, r := range rearranged {
		switch {
		case r >= '0' && r <= '9':
			numeric.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			fmt.Fprintf(&numeric, "%d", r-'A'+10)
		default:
			return false
		}
	}
	n, ok := new(big.Int).SetString(numeric.String(), 10)
	if !ok {
		return false
	}
	return new(big.Int).Mod(n, ninetySeven).Int64() == 1
}

func stripSeparators(s string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '-' {
			return -1
		}
		return r
	}, s)
}
