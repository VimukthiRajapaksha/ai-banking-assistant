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
	"reflect"
	"strings"
	"testing"
)

func TestParseEncode_RoundTrip(t *testing.T) {
	in := `{"b":1.50,"a":[true,null,"x<y&z"],"c":{"é":"line\nbreak \"q\""}}`
	n, err := parseJSON([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	out := string(encodeJSON(n))
	want := `{"b":1.50,"a":[true,null,"x<y&z"],"c":{"é":"line\nbreak \"q\""}}`
	if out != want {
		t.Fatalf("got  %s\nwant %s", out, want)
	}
}

func TestParseJSON_Rejects(t *testing.T) {
	for _, in := range []string{`{"a":1} {"b":2}`, `{"a":`, `[1,2`, strings.Repeat("[", maxDocumentDepth+2)} {
		if _, err := parseJSON([]byte(in)); err == nil {
			t.Errorf("parseJSON(%q) should fail", in)
		}
	}
}

func TestMaskTree_ValueOnly(t *testing.T) {
	m := newMasker(mustConfig(t, nil))
	n, _ := parseJSON([]byte(`{"Account_Number":"40031122","nested":{"address":{"line1":"1 Main St","postalCode":"10001"}},"phones":["+94771234567"],"note":"no npi"}`))
	if !m.maskTree(n, 0) {
		t.Fatal("expected changes")
	}
	out := string(encodeJSON(n))
	for _, secret := range []string{"40031122", "1 Main St", "10001", "+94771234567"} {
		if strings.Contains(out, secret) {
			t.Fatalf("%q survived: %s", secret, out)
		}
	}
	if !strings.Contains(out, `"Account_Number":"[ACCOUNT_NUMBER_`) || !strings.Contains(out, `"note":"no npi"`) {
		t.Fatalf("keys or clean values changed: %s", out)
	}
}

func TestEscapeJSONStringContent(t *testing.T) {
	for _, s := range []string{"plain", `q"uote`, `back\slash`, "ctl\x01\x1f", "tab\t", "uni é ✓", "<html>&", " "} {
		var decoded string
		if err := json.Unmarshal([]byte(`"`+escapeJSONStringContent(s)+`"`), &decoded); err != nil || decoded != s {
			t.Errorf("escape(%q) round-trip failed: %q %v", s, decoded, err)
		}
	}
}

// FuzzMaskRestore checks the central property: for any tool result, restoring
// what the policy masked gives back exactly the original document, and no value
// that was masked is still present in the masked form.
func FuzzMaskRestore(f *testing.F) {
	f.Add(`{"accountId":"acc-chk-1120","iban":"GB29NWBK60161331926819","balance":8450.32}`)
	f.Add(`[{"accountNumber":40031122,"name":"Dana \"DJ\" Lee"}]`)
	f.Add(`{"note":"Account number: 40031122, card 4111 1111 1111 1111"}`)
	f.Add(`{"x":"{\"customerId\":\"CUST-1\"}"}`)
	f.Fuzz(func(t *testing.T, doc string) {
		var original interface{}
		if err := json.Unmarshal([]byte(doc), &original); err != nil {
			return
		}
		cfg := &policyConfig{}
		*cfg = *fuzzConfig
		m := newMasker(cfg)
		n, err := parseJSON([]byte(doc))
		if err != nil {
			return
		}
		m.maskTree(n, 0)
		remaining := make(map[string]bool)
		collectStringValues(n, remaining, 0)
		for ph, e := range m.table.Entries {
			if remaining[e.Value] {
				t.Fatalf("masked value %q (%s) still present as a whole string value", e.Value, ph)
			}
		}
		restoreTree(n, m.table, 0)
		var restored interface{}
		if err := json.Unmarshal(encodeJSON(n), &restored); err != nil {
			t.Fatalf("restored document is not JSON: %v", err)
		}
		if !reflect.DeepEqual(normalizeEmbedded(original), normalizeEmbedded(restored)) {
			t.Fatalf("round trip changed the document\n in: %s\nout: %s", doc, encodeJSON(n))
		}
	})
}

// collectStringValues gathers every string value (not key) in a tree, descending
// into strings that are themselves JSON documents.
func collectStringValues(n *jsonNode, out map[string]bool, depth int) {
	switch n.Kind {
	case kindObject, kindArray:
		for _, v := range n.Values {
			collectStringValues(v, out, depth)
		}
	case kindString:
		if depth < maxEmbeddedDepth {
			if docs, ok := parseEmbeddedJSON(n.Scalar); ok {
				for _, doc := range docs {
					collectStringValues(doc, out, depth+1)
				}
				return
			}
		}
		out[n.Scalar] = true
	}
}

// fuzzConfig masks only (no redaction), so every change is reversible.
var fuzzConfig = func() *policyConfig {
	params := map[string]interface{}{"hmacKey": "fuzz"}
	var overrides []interface{}
	for _, e := range builtinEntities {
		overrides = append(overrides, map[string]interface{}{"name": e.Name, "action": "mask"})
	}
	params["entities"] = overrides
	cfg, err := parseParams(params)
	if err != nil {
		panic(err)
	}
	return cfg
}()

// normalizeEmbedded parses strings that are JSON documents, since masking
// re-encodes an embedded document compactly.
func normalizeEmbedded(v interface{}) interface{} {
	switch x := v.(type) {
	case map[string]interface{}:
		for k, val := range x {
			x[k] = normalizeEmbedded(val)
		}
	case []interface{}:
		for i, val := range x {
			x[i] = normalizeEmbedded(val)
		}
	case string:
		t := strings.TrimSpace(x)
		if len(t) > 1 && (t[0] == '{' || t[0] == '[') {
			var inner interface{}
			if json.Unmarshal([]byte(t), &inner) == nil {
				return normalizeEmbedded(inner)
			}
		}
	}
	return v
}
