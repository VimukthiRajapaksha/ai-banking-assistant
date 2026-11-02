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
)

func TestValidIBAN(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"GB29NWBK60161331926819", true},
		{"GB29 NWBK 6016 1331 9268 19", true},
		{"DE89370400440532013000", true},
		{"FR1420041010050500013M02606", true},
		{"GB28NWBK60161331926819", false}, // checksum
		{"GB29NWBK6016133192681", false},  // length for GB
		{"ZZ29NWBK60161331926819", false}, // unknown country
	}
	for _, tt := range tests {
		if got := validIBAN(tt.in); got != tt.want {
			t.Errorf("validIBAN(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestValidCardNumber(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"4111111111111111", true},
		{"4111 1111 1111 1111", true},
		{"5500-0000-0000-0004", true},
		{"378282246310005", true},
		{"4111111111111112", false}, // Luhn
		{"1696512345678", false},    // epoch millis: issuer digit 1
		{"411111111111", false},     // too short
	}
	for _, tt := range tests {
		if got := validCardNumber(tt.in); got != tt.want {
			t.Errorf("validCardNumber(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestFindSpans(t *testing.T) {
	cfg := mustConfig(t, nil)
	tests := []struct {
		name string
		in   string
		want []string // "ENTITY=value"
	}{
		{"iban grouped, not read as card", "IBAN GB29 NWBK 6016 1331 9268 19 please",
			[]string{"IBAN=GB29 NWBK 6016 1331 9268 19"}},
		{"card", "pay with 4111 1111 1111 1111 now", []string{"CARD_NUMBER=4111 1111 1111 1111"}},
		{"luhn failure ignored", "order 4111111111111112", nil},
		{"e164 phone", "call +44 20 7946 0958", []string{"PHONE=+44 20 7946 0958"}},
		{"phone without plus ignored", "ref 0771234567", nil},
		{"email", "mail dana.lee@example.com", []string{"EMAIL=dana.lee@example.com"}},
		{"label keeps label", "Account number: 40031122.", []string{"ACCOUNT_NUMBER=40031122"}},
		{"label with is", "my customer id is CUST-77812", []string{"CUSTOMER_ID=CUST-77812"}},
		{"label needs digit", "an account id is required", nil},
		{"cvv label", "CVV: 123", []string{"CARD_CVV=123"}},
		{"amounts untouched", "balance 8450.32 and amount -86.42", nil},
		{"placeholder not remasked", "Account number: [ACCOUNT_NUMBER_0a1b2c3d]", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			for _, sp := range findSpans(tt.in, cfg, true) {
				got = append(got, sp.Entity+"="+tt.in[sp.Start:sp.End])
			}
			if strings.Join(got, "|") != strings.Join(tt.want, "|") {
				t.Fatalf("findSpans(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestFindSpans_FormatOnlySkipsLabels(t *testing.T) {
	cfg := mustConfig(t, nil)
	spans := findSpans("Account number: 40031122, IBAN GB29NWBK60161331926819", cfg, false)
	if len(spans) != 1 || spans[0].Entity != EntityIBAN {
		t.Fatalf("format-only scan should find only the IBAN, got %+v", spans)
	}
}

func TestFindSpans_LabelledTextDisabled(t *testing.T) {
	cfg := mustConfig(t, map[string]interface{}{"labelledText": false})
	if spans := findSpans("Account number: 40031122", cfg, true); len(spans) != 0 {
		t.Fatalf("labelledText=false should disable label detection, got %+v", spans)
	}
}

func TestFindSpans_DisabledEntity(t *testing.T) {
	cfg := mustConfig(t, map[string]interface{}{
		"entities": []interface{}{map[string]interface{}{"name": "IBAN", "enabled": false}},
	})
	spans := findSpans("GB29NWBK60161331926819", cfg, true)
	for _, sp := range spans {
		if sp.Entity == EntityIBAN {
			t.Fatal("disabled IBAN entity still detected")
		}
	}
}
