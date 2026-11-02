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
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	policy "github.com/wso2/api-platform/sdk/core/policy/v1alpha2"
)

var anyPlaceholder = regexp.MustCompile(`\[[A-Z_]+_[0-9a-f]{8,16}\]`)

func newTestPolicy(t *testing.T, params map[string]interface{}) *NPIMaskingRegexPolicy {
	t.Helper()
	if params == nil {
		params = map[string]interface{}{}
	}
	if _, ok := params["hmacKey"]; !ok {
		params["hmacKey"] = "test-key"
	}
	p, err := GetPolicy(policy.PolicyMetadata{}, params)
	if err != nil {
		t.Fatalf("GetPolicy: %v", err)
	}
	return p.(*NPIMaskingRegexPolicy)
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return b
}

// runRequest masks a request and returns the forwarded body and the shared
// context that carries the placeholder table to the response phase.
func runRequest(t *testing.T, p *NPIMaskingRegexPolicy, body []byte) ([]byte, *policy.SharedContext) {
	t.Helper()
	shared := &policy.SharedContext{Metadata: map[string]interface{}{}}
	action := p.OnRequestBody(context.Background(), &policy.RequestContext{
		SharedContext: shared,
		Body:          &policy.Body{Content: body, Present: true},
	}, nil)
	mods, ok := action.(policy.UpstreamRequestModifications)
	if !ok {
		t.Fatalf("expected UpstreamRequestModifications, got %T", action)
	}
	if mods.Body == nil {
		return body, shared
	}
	return mods.Body, shared
}

func runResponse(t *testing.T, p *NPIMaskingRegexPolicy, shared *policy.SharedContext, body []byte) []byte {
	t.Helper()
	action := p.OnResponseBody(context.Background(), &policy.ResponseContext{
		SharedContext: shared,
		ResponseBody:  &policy.Body{Content: body, Present: true},
	}, nil)
	mods, ok := action.(policy.DownstreamResponseModifications)
	if !ok {
		t.Fatalf("expected DownstreamResponseModifications, got %T", action)
	}
	if mods.Body == nil {
		return body
	}
	return mods.Body
}

func decode(t *testing.T, b []byte) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON %s: %v", b, err)
	}
	return m
}

// TestTwoToolFlow_Anthropic is the accounts → transactions flow. The LLM sees
// only placeholders, copies one into its next tool call, and the agent receives
// the real account id.
func TestTwoToolFlow_Anthropic(t *testing.T) {
	p := newTestPolicy(t, nil)

	// Turn 2: get_accounts has returned; its result goes to the LLM.
	forwarded, shared := runRequest(t, p, readFixture(t, "anthropic_turn2_request.json"))
	fs := string(forwarded)

	for _, secret := range []string{"acc-chk-1120", "acc-sav-8842", "40031122", "GB29NWBK60161331926819"} {
		if strings.Contains(fs, secret) {
			t.Fatalf("NPI %q reached the LLM: %s", secret, fs)
		}
	}
	// Keys survive: only values are masked.
	for _, key := range []string{`\"accountId\":\"[ACCOUNT_ID_`, `\"accountNumber\":\"[ACCOUNT_NUMBER_`, `\"iban\":\"[IBAN_`} {
		if !strings.Contains(fs, key) {
			t.Fatalf("expected %s in forwarded body: %s", key, fs)
		}
	}
	// Amounts and names are untouched.
	for _, kept := range []string{"8450.32", "Everyday Checking"} {
		if !strings.Contains(fs, kept) {
			t.Fatalf("%q should not be masked: %s", kept, fs)
		}
	}
	// Tool definitions are never scanned, even though they name "accountId".
	if !strings.Contains(fs, `"accountId":{"type":"string"`) {
		t.Fatalf("tool schema was rewritten: %s", fs)
	}

	// The LLM answers with a tool call that copies the placeholder it saw.
	checkingPH := placeholderFor(t, shared, "acc-chk-1120")
	llmResponse := `{"id":"msg_1","type":"message","role":"assistant","content":[` +
		`{"type":"text","text":"Fetching transactions for ` + checkingPH + `."},` +
		`{"type":"tool_use","id":"toolu_2","name":"get_transactions","input":{"accountId":"` + checkingPH + `","limit":10}}],` +
		`"stop_reason":"tool_use"}`

	restored := decode(t, runResponse(t, p, shared, []byte(llmResponse)))
	content := restored["content"].([]interface{})
	input := content[1].(map[string]interface{})["input"].(map[string]interface{})
	if input["accountId"] != "acc-chk-1120" {
		t.Fatalf("tool argument not restored: %v", input["accountId"])
	}
	if input["limit"] != float64(10) {
		t.Fatalf("unrelated argument changed: %v", input["limit"])
	}
	if text := content[0].(map[string]interface{})["text"]; text != "Fetching transactions for acc-chk-1120." {
		t.Fatalf("text not restored: %v", text)
	}
}

// TestHistoryIsMaskedConsistently replays turn 3: the restored tool call is now
// in the history, and must reach the LLM masked with the same placeholder.
func TestHistoryIsMaskedConsistently(t *testing.T) {
	p := newTestPolicy(t, nil)
	_, shared2 := runRequest(t, p, readFixture(t, "anthropic_turn2_request.json"))
	ph := placeholderFor(t, shared2, "acc-chk-1120")

	forwarded, _ := runRequest(t, p, readFixture(t, "anthropic_turn3_request.json"))
	fs := string(forwarded)
	if strings.Contains(fs, "acc-chk-1120") {
		t.Fatalf("restored tool-call argument leaked in history: %s", fs)
	}
	if !strings.Contains(fs, `"input":{"accountId":"`+ph+`"`) {
		t.Fatalf("history tool_use not masked with the stable placeholder %s: %s", ph, fs)
	}
	if strings.Contains(fs, "-86.42") == false {
		t.Fatalf("transaction amounts must survive: %s", fs)
	}
}

func TestOpenAIToolCalls(t *testing.T) {
	p := newTestPolicy(t, nil)
	forwarded, shared := runRequest(t, p, readFixture(t, "openai_turn2_request.json"))
	fs := string(forwarded)
	if strings.Contains(fs, "acc-chk-1120") {
		t.Fatalf("NPI reached the LLM: %s", fs)
	}
	ph := placeholderFor(t, shared, "acc-chk-1120")

	resp := `{"id":"c1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":null,` +
		`"tool_calls":[{"id":"call_2","type":"function","function":{"name":"get_transactions","arguments":"{\"accountId\":\"` + ph + `\",\"limit\":10}"}}]},` +
		`"finish_reason":"tool_calls"}]}`
	restored := decode(t, runResponse(t, p, shared, []byte(resp)))
	args := restored["choices"].([]interface{})[0].(map[string]interface{})["message"].(map[string]interface{})["tool_calls"].([]interface{})[0].(map[string]interface{})["function"].(map[string]interface{})["arguments"].(string)
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(args), &parsed); err != nil {
		t.Fatalf("restored arguments are not valid JSON: %s", args)
	}
	if parsed["accountId"] != "acc-chk-1120" {
		t.Fatalf("arguments not restored: %s", args)
	}
}

func TestRestore_OriginalWithQuotesKeepsJSONValid(t *testing.T) {
	p := newTestPolicy(t, nil)
	req := `{"messages":[{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"{\"accountId\":\"acc \\\"x\\\" 1\"}"}]}]}`
	_, shared := runRequest(t, p, []byte(req))
	ph := placeholderFor(t, shared, `acc "x" 1`)
	resp := `{"content":[{"type":"tool_use","id":"u","name":"f","input":{"accountId":"` + ph + `"}},{"type":"text","text":"id ` + ph + `"}]}`
	out := runResponse(t, p, shared, []byte(resp))
	m := decode(t, out)
	if got := m["content"].([]interface{})[0].(map[string]interface{})["input"].(map[string]interface{})["accountId"]; got != `acc "x" 1` {
		t.Fatalf("got %v", got)
	}
}

func TestNumberValueRestoredAsNumber(t *testing.T) {
	p := newTestPolicy(t, nil)
	req := `{"messages":[{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"{\"accountNumber\":40031122}"}]}]}`
	_, shared := runRequest(t, p, []byte(req))
	ph := placeholderFor(t, shared, "40031122")
	out := decode(t, runResponse(t, p, shared, []byte(`{"content":[{"type":"tool_use","id":"u","name":"f","input":{"accountNumber":"`+ph+`"}}]}`)))
	got := out["content"].([]interface{})[0].(map[string]interface{})["input"].(map[string]interface{})["accountNumber"]
	if got != float64(40031122) {
		t.Fatalf("expected the number 40031122, got %#v", got)
	}
}

func TestRedactIsNeverRestored(t *testing.T) {
	p := newTestPolicy(t, nil)
	req := `{"messages":[{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"{\"cardNumber\":\"4111111111111111\",\"cvv\":\"123\",\"expiry\":\"12/29\"}"}]}]}`
	forwarded, shared := runRequest(t, p, []byte(req))
	fs := string(forwarded)
	if strings.Contains(fs, `\"cvv\":\"123\"`) || strings.Contains(fs, "12/29") || strings.Contains(fs, "4111111111111111") {
		t.Fatalf("card data reached the LLM: %s", fs)
	}
	if !strings.Contains(fs, `\"cvv\":\"*****\"`) {
		t.Fatalf("cvv not redacted: %s", fs)
	}
	for ph, e := range tableOf(t, shared).Entries {
		if e.Value == "123" || e.Value == "12/29" {
			t.Fatalf("redacted value stored for restoration under %s", ph)
		}
	}
}

func TestUserTextMasking(t *testing.T) {
	p := newTestPolicy(t, nil)
	req := `{"messages":[{"role":"user","content":"Send 50 to IBAN DE89 3704 0044 0532 0130 00 from account number 40031122, my email is a.b@example.com"}]}`
	forwarded, _ := runRequest(t, p, []byte(req))
	fs := string(forwarded)
	for _, secret := range []string{"DE89 3704", "40031122", "a.b@example.com"} {
		if strings.Contains(fs, secret) {
			t.Fatalf("%q leaked: %s", secret, fs)
		}
	}
	if !strings.Contains(fs, "Send 50 to IBAN [IBAN_") || !strings.Contains(fs, "from account number [ACCOUNT_NUMBER_") {
		t.Fatalf("labels or amounts lost: %s", fs)
	}
}

func TestSystemPromptIsFormatOnly(t *testing.T) {
	p := newTestPolicy(t, nil)
	req := `{"system":"Account number: 12345678 is an example. Escalate to ops@bank.example.","messages":[{"role":"user","content":"hi"}]}`
	forwarded, _ := runRequest(t, p, []byte(req))
	fs := string(forwarded)
	if !strings.Contains(fs, "Account number: 12345678") {
		t.Fatalf("labelled text in a system prompt should be left alone: %s", fs)
	}
	if strings.Contains(fs, "ops@bank.example") {
		t.Fatalf("format detectors must still run on system prompts: %s", fs)
	}
}

func TestDisabledEntityPassesThrough(t *testing.T) {
	p := newTestPolicy(t, map[string]interface{}{
		"entities": []interface{}{map[string]interface{}{"name": "ACCOUNT_ID", "enabled": false}},
	})
	forwarded, _ := runRequest(t, p, readFixture(t, "anthropic_turn2_request.json"))
	if !strings.Contains(string(forwarded), "acc-chk-1120") {
		t.Fatal("disabled ACCOUNT_ID was masked")
	}
}

func TestMonitorModeForwardsUnchanged(t *testing.T) {
	p := newTestPolicy(t, map[string]interface{}{"mode": "monitor"})
	body := readFixture(t, "anthropic_turn2_request.json")
	action := p.OnRequestBody(context.Background(), &policy.RequestContext{
		SharedContext: &policy.SharedContext{Metadata: map[string]interface{}{}},
		Body:          &policy.Body{Content: body, Present: true},
	}, nil)
	if mods := action.(policy.UpstreamRequestModifications); mods.Body != nil {
		t.Fatal("monitor mode modified the request")
	}
}

func TestInvalidJSON(t *testing.T) {
	ctx := func() *policy.RequestContext {
		return &policy.RequestContext{
			SharedContext: &policy.SharedContext{Metadata: map[string]interface{}{}},
			Body:          &policy.Body{Content: []byte(`{"messages": [`), Present: true},
		}
	}
	blocked := newTestPolicy(t, nil).OnRequestBody(context.Background(), ctx(), nil)
	resp, ok := blocked.(policy.ImmediateResponse)
	if !ok || resp.StatusCode != APIMInternalErrorCode || !strings.Contains(string(resp.Body), "npi-masking-regex") {
		t.Fatalf("expected a blocking error response, got %#v", blocked)
	}
	passed := newTestPolicy(t, map[string]interface{}{"onError": "passThrough"}).OnRequestBody(context.Background(), ctx(), nil)
	if _, ok := passed.(policy.UpstreamRequestModifications); !ok {
		t.Fatalf("expected pass-through, got %T", passed)
	}
}

func TestForgedPlaceholderIsNotRestored(t *testing.T) {
	p := newTestPolicy(t, nil)
	_, shared := runRequest(t, p, readFixture(t, "anthropic_turn2_request.json"))
	resp := `{"content":[{"type":"text","text":"try [ACCOUNT_ID_deadbeef]"}]}`
	if out := runResponse(t, p, shared, []byte(resp)); string(out) != resp {
		t.Fatalf("unknown placeholder changed the response: %s", out)
	}
}

func TestPlaceholdersAreDeterministic(t *testing.T) {
	p := newTestPolicy(t, nil)
	a, _ := runRequest(t, p, readFixture(t, "anthropic_turn2_request.json"))
	b, _ := runRequest(t, p, readFixture(t, "anthropic_turn2_request.json"))
	if string(a) != string(b) {
		t.Fatal("same input produced different masked bodies")
	}
	other := newTestPolicy(t, map[string]interface{}{"hmacKey": "another-key"})
	c, _ := runRequest(t, other, readFixture(t, "anthropic_turn2_request.json"))
	if string(a) == string(c) {
		t.Fatal("placeholders must depend on the HMAC key")
	}
}

func TestNoNPIForwardsOriginalBytes(t *testing.T) {
	p := newTestPolicy(t, nil)
	body := []byte(`{ "model": "m",  "messages": [ {"role": "user", "content": "What can you do?"} ] }`)
	action := p.OnRequestBody(context.Background(), &policy.RequestContext{
		SharedContext: &policy.SharedContext{Metadata: map[string]interface{}{}},
		Body:          &policy.Body{Content: body, Present: true},
	}, nil)
	if mods := action.(policy.UpstreamRequestModifications); mods.Body != nil {
		t.Fatalf("a body without NPI must be forwarded untouched, got %s", mods.Body)
	}
}

func TestKeyOrderPreserved(t *testing.T) {
	p := newTestPolicy(t, nil)
	body := []byte(`{"zeta":1,"messages":[{"role":"user","content":"IBAN GB29NWBK60161331926819"}],"alpha":true,"max_tokens":10}`)
	forwarded, _ := runRequest(t, p, body)
	if !regexp.MustCompile(`^\{"zeta":1,"messages":.*,"alpha":true,"max_tokens":10\}$`).Match(forwarded) {
		t.Fatalf("key order changed: %s", forwarded)
	}
}

func placeholderFor(t *testing.T, shared *policy.SharedContext, value string) string {
	t.Helper()
	for ph, e := range tableOf(t, shared).Entries {
		if e.Value == value {
			return ph
		}
	}
	t.Fatalf("no placeholder minted for %q", value)
	return ""
}

func tableOf(t *testing.T, shared *policy.SharedContext) *placeholderTable {
	t.Helper()
	tbl, ok := shared.Metadata[MetadataKeyPlaceholders].(*placeholderTable)
	if !ok {
		t.Fatal("no placeholder table in metadata")
	}
	return tbl
}

func BenchmarkOnRequestBody(b *testing.B) {
	p, err := GetPolicy(policy.PolicyMetadata{}, map[string]interface{}{"hmacKey": "bench"})
	if err != nil {
		b.Fatal(err)
	}
	base, err := os.ReadFile(filepath.Join("testdata", "anthropic_turn3_request.json"))
	if err != nil {
		b.Fatal(err)
	}
	for _, size := range []int{1, 32, 256} {
		body := growConversation(b, base, size*1024)
		b.Run(fmt.Sprintf("%dKB", size), func(b *testing.B) {
			b.SetBytes(int64(len(body)))
			for i := 0; i < b.N; i++ {
				p.(*NPIMaskingRegexPolicy).OnRequestBody(context.Background(), &policy.RequestContext{
					SharedContext: &policy.SharedContext{Metadata: map[string]interface{}{}},
					Body:          &policy.Body{Content: body, Present: true},
				}, nil)
			}
		})
	}
}

// growConversation repeats the fixture's tool exchange until the body reaches
// roughly size bytes, giving a realistic long multi-turn request.
func growConversation(b *testing.B, base []byte, size int) []byte {
	var doc map[string]interface{}
	if err := json.Unmarshal(base, &doc); err != nil {
		b.Fatal(err)
	}
	msgs := doc["messages"].([]interface{})
	tail := msgs[1:]
	for {
		out, _ := json.Marshal(doc)
		if len(out) >= size {
			return out
		}
		msgs = append(msgs, tail...)
		doc["messages"] = msgs
	}
}

// TestEchoedValuesInLaterTurns covers the leak found end to end: the agent
// re-sends its own earlier answer, which the response phase restored for the
// user. A value found only by its key in a tool result reappears there as plain
// prose, so it must be masked wherever it is echoed in the same request.
func TestEchoedValuesInLaterTurns(t *testing.T) {
	p := newTestPolicy(t, nil)
	req := `{"messages":[` +
		`{"role":"user","content":"list my payees"},` +
		`{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"get_payees","input":{}}]},` +
		`{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"[{\"id\":\"pye-7756\",\"name\":\"Riverside Properties\",\"accountNumber\":\"••••7756\",\"cvv\":\"9876\"}]"}]},` +
		`{"role":"assistant","content":[{"type":"text","text":"Riverside Properties — Account: ••••7756 (code 9876)"}]},` +
		`{"role":"user","content":"Is ••••7756 the landlord?"}]}`
	forwarded, shared := runRequest(t, p, []byte(req))
	fs := string(forwarded)
	if strings.Contains(fs, "••••7756") || strings.Contains(fs, "9876") {
		t.Fatalf("a key-identified value leaked through an echo: %s", fs)
	}
	ph := placeholderFor(t, shared, "••••7756")
	if strings.Count(fs, ph) != 3 {
		t.Fatalf("expected the same placeholder in the tool result and both echoes: %s", fs)
	}
	if !strings.Contains(fs, "(code *****)") {
		t.Fatalf("a redacted value's echo should be redacted too: %s", fs)
	}
}

func TestEchoMaskingSkipsShortValuesAndPlaceholders(t *testing.T) {
	m := newMasker(mustConfig(t, nil))
	m.replacement(EntityAccountID, "1120", false) // mints a placeholder for "1120"
	m.replacement(EntityCardCVV, "123", false)    // too short to echo-mask
	ph := placeholderFor(t, &policy.SharedContext{Metadata: map[string]interface{}{MetadataKeyPlaceholders: m.table}}, "1120")
	in := "acc 1120, cvv 123, and " + ph
	out := m.maskEchoes(in)
	if !strings.Contains(out, "acc "+ph) || !strings.Contains(out, "cvv 123") || !strings.HasSuffix(out, ph) {
		t.Fatalf("got %q", out)
	}
}

// TestConcatenatedJSONToolResult reproduces what pydantic-ai's MCP integration
// sends for a multi-item tool result: pretty-printed JSON objects one after
// another, which is not a single JSON document. Found end to end in the Apex
// agent's own trace.
func TestConcatenatedJSONToolResult(t *testing.T) {
	p := newTestPolicy(t, nil)
	content := "{\n  \"id\": \"pye-7756\",\n  \"name\": \"Riverside Properties\",\n  \"accountNumber\": \"••••7756\"\n}\n" +
		"{\n  \"id\": \"pye-2093\",\n  \"name\": \"Alice Johnson\",\n  \"accountNumber\": \"••••2093\"\n}"
	ndjson := `{"accountId":"acc-chk-1120","amount":-86.42}` + "\n" + `{"accountId":"acc-chk-1120","amount":3200.0}`
	body, _ := json.Marshal(map[string]interface{}{"messages": []interface{}{
		map[string]interface{}{"role": "user", "content": []interface{}{
			map[string]interface{}{"type": "tool_result", "tool_use_id": "t1", "content": []interface{}{
				map[string]interface{}{"type": "text", "text": content},
			}},
			map[string]interface{}{"type": "tool_result", "tool_use_id": "t2", "content": ndjson},
		}},
	}})
	forwarded, shared := runRequest(t, p, body)
	fs := string(forwarded)
	for _, secret := range []string{"••••7756", "••••2093", "acc-chk-1120"} {
		if strings.Contains(fs, secret) {
			t.Fatalf("%q leaked from a concatenated-JSON tool result: %s", secret, fs)
		}
	}
	if !strings.Contains(fs, "Riverside Properties") || !strings.Contains(fs, "-86.42") {
		t.Fatalf("non-NPI values changed: %s", fs)
	}
	ph := placeholderFor(t, shared, "••••7756")
	resp := `{"content":[{"type":"text","text":"Riverside: ` + ph + `"}]}`
	if out := string(runResponse(t, p, shared, []byte(resp))); !strings.Contains(out, "Riverside: ••••7756") {
		t.Fatalf("not restored: %s", out)
	}
}
