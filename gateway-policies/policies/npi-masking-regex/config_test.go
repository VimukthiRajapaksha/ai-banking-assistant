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
	"strings"
	"testing"

	policy "github.com/wso2/api-platform/sdk/core/policy/v1alpha2"
)

func TestGetPolicy_ParseErrors(t *testing.T) {
	tests := []struct {
		name           string
		params         map[string]interface{}
		wantErrContain string
	}{
		{"bad mode", map[string]interface{}{"mode": "audit"}, "'mode' must be one of"},
		{"bad onError", map[string]interface{}{"onError": "ignore"}, "'onError' must be one of"},
		{"labelledText not bool", map[string]interface{}{"labelledText": 3}, "'labelledText' must be a boolean"},
		{"entities wrong type", map[string]interface{}{"entities": 1}, "'entities' must be an array or JSON string"},
		{"entities malformed json", map[string]interface{}{"entities": `[{"name":"IBAN"}`}, "error unmarshaling 'entities'"},
		{"entity not object", map[string]interface{}{"entities": []interface{}{"IBAN"}}, "'entities[0]' must be an object"},
		{"entity unknown", map[string]interface{}{"entities": []interface{}{map[string]interface{}{"name": "SORT_CODE"}}}, "is not a built-in entity"},
		{"entity twice", map[string]interface{}{"entities": []interface{}{
			map[string]interface{}{"name": "IBAN"}, map[string]interface{}{"name": "IBAN"},
		}}, "configured more than once"},
		{"bad action", map[string]interface{}{"entities": []interface{}{map[string]interface{}{"name": "IBAN", "action": "hash"}}}, "'entities[0].action' must be"},
		{"custom bad name", map[string]interface{}{"customEntities": []interface{}{map[string]interface{}{"name": "loyalty", "keys": []interface{}{"x"}}}}, "uppercase letters"},
		{"custom clashes builtin", map[string]interface{}{"customEntities": []interface{}{map[string]interface{}{"name": "IBAN", "keys": []interface{}{"x"}}}}, "clashes with a built-in"},
		{"custom without detector", map[string]interface{}{"customEntities": []interface{}{map[string]interface{}{"name": "LOYALTY_ID"}}}, "needs at least one of 'keys' or 'valueRegex'"},
		{"custom bad regex", map[string]interface{}{"customEntities": []interface{}{map[string]interface{}{"name": "LOYALTY_ID", "valueRegex": "(?<=x)y"}}}, "'customEntities[0].valueRegex' is invalid"},
		{"key claimed twice", map[string]interface{}{"customEntities": []interface{}{map[string]interface{}{"name": "LOYALTY_ID", "keys": []interface{}{"account_number"}}}}, "is claimed by both"},
		{"all disabled", map[string]interface{}{"entities": disableAll()}, "at least one NPI entity must be enabled"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := GetPolicy(policy.PolicyMetadata{}, tt.params)
			if err == nil {
				t.Fatalf("expected error containing %q", tt.wantErrContain)
			}
			if !strings.Contains(err.Error(), tt.wantErrContain) {
				t.Fatalf("error %q does not contain %q", err.Error(), tt.wantErrContain)
			}
		})
	}
}

func disableAll() []interface{} {
	out := make([]interface{}, 0, len(builtinEntities))
	for _, e := range builtinEntities {
		out = append(out, map[string]interface{}{"name": e.Name, "enabled": false})
	}
	return out
}

func TestParseParams_Defaults(t *testing.T) {
	cfg := mustConfig(t, nil)
	if cfg.Mode != ModeEnforce || cfg.OnError != OnErrorBlock || !cfg.LabelledText {
		t.Fatalf("unexpected defaults: mode=%s onError=%s labelledText=%v", cfg.Mode, cfg.OnError, cfg.LabelledText)
	}
	if len(cfg.entities) != len(builtinEntities) {
		t.Fatalf("expected every built-in enabled, got %d of %d", len(cfg.entities), len(builtinEntities))
	}
	if got := cfg.entity(EntityCardCVV).Action; got != ActionRedact {
		t.Fatalf("CARD_CVV default action = %s, want redact", got)
	}
	if got := cfg.keyIndex["accountnumber"]; got != EntityAccountNumber {
		t.Fatalf("accountnumber → %q, want ACCOUNT_NUMBER", got)
	}
}

func TestParseParams_Overrides(t *testing.T) {
	cfg := mustConfig(t, map[string]interface{}{
		"entities": []interface{}{
			map[string]interface{}{"name": "CUSTOMER_ID", "enabled": false},
			map[string]interface{}{"name": "ACCOUNT_ID", "action": "redact"},
			map[string]interface{}{"name": "ACCOUNT_NUMBER", "additionalKeys": []interface{}{"accNo"}},
		},
		"customEntities": `[{"name":"LOYALTY_ID","keys":["loyaltyId"],"valueRegex":"LY\\d{8}"}]`,
	})
	if cfg.entity(EntityCustomerID) != nil {
		t.Fatal("CUSTOMER_ID should be disabled")
	}
	if _, ok := cfg.keyIndex["customerid"]; ok {
		t.Fatal("a disabled entity's keys must not be indexed")
	}
	if cfg.entity(EntityAccountID).Action != ActionRedact {
		t.Fatal("ACCOUNT_ID action override not applied")
	}
	if cfg.keyIndex["accno"] != EntityAccountNumber {
		t.Fatal("additionalKeys not indexed")
	}
	if cfg.keyIndex["loyaltyid"] != "LOYALTY_ID" || cfg.entity("LOYALTY_ID").ValueRegex == nil {
		t.Fatal("custom entity not configured")
	}
}

func TestNormalizeKey(t *testing.T) {
	for in, want := range map[string]string{
		"accountNumber":   "accountnumber",
		"account_number":  "accountnumber",
		"Account-Number":  "accountnumber",
		" ACCOUNT NUMBER": "accountnumber",
		"addressLine1":    "addressline1",
	} {
		if got := normalizeKey(in); got != want {
			t.Errorf("normalizeKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSplitKeyWords(t *testing.T) {
	for in, want := range map[string]string{
		"accountNumber":     "account number",
		"account_number":    "account number",
		"addressLine1":      "address line 1",
		"cvv2":              "cvv 2",
		"IBAN":              "iban",
		"bankAccountNumber": "bank account number",
	} {
		if got := strings.Join(splitKeyWords(in), " "); got != want {
			t.Errorf("splitKeyWords(%q) = %q, want %q", in, got, want)
		}
	}
}

func mustConfig(t *testing.T, params map[string]interface{}) *policyConfig {
	t.Helper()
	if params == nil {
		params = map[string]interface{}{}
	}
	if _, ok := params["hmacKey"]; !ok {
		params["hmacKey"] = "test-key"
	}
	cfg, err := parseParams(params)
	if err != nil {
		t.Fatalf("parseParams: %v", err)
	}
	return cfg
}
