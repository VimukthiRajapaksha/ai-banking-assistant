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

// Package npimaskingregex masks banking Nonpublic Personal Information (NPI) in
// LLM requests and restores it in LLM responses.
//
// Values are found three ways: by the JSON key that holds them (tool results and
// tool-call arguments), by a verifiable format (IBAN, card number, E.164 phone,
// email) anywhere, and by the label in front of them in prose. Only the value is
// replaced, never its key or label, and the placeholder an LLM copies into a tool
// call is restored before the agent sees it.
package npimaskingregex

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	policy "github.com/wso2/api-platform/sdk/core/policy/v1alpha2"
)

const (
	APIMInternalErrorCode     = 500
	APIMInternalExceptionCode = 900967
	MetadataKeyPlaceholders   = "npimaskingregex:placeholders"
)

// NPIMaskingRegexPolicy implements NPI masking and restoration.
type NPIMaskingRegexPolicy struct {
	cfg *policyConfig
}

// GetPolicy is the v1alpha2 factory entry point (loaded by v1alpha2 kernels).
// All parameters are validated and every regex compiled here, so a bad
// configuration is rejected when it is deployed rather than at request time.
func GetPolicy(
	metadata policy.PolicyMetadata,
	params map[string]interface{},
) (policy.Policy, error) {
	cfg, err := parseParams(params)
	if err != nil {
		return nil, fmt.Errorf("invalid parameters: %w", err)
	}
	return &NPIMaskingRegexPolicy{cfg: cfg}, nil
}

// Mode returns the processing mode for the NPI masking policy.
func (p *NPIMaskingRegexPolicy) Mode() policy.ProcessingMode {
	return policy.ProcessingMode{
		RequestHeaderMode:  policy.HeaderModeSkip,
		RequestBodyMode:    policy.BodyModeBuffer,
		ResponseHeaderMode: policy.HeaderModeSkip,
		ResponseBodyMode:   policy.BodyModeStream,
	}
}

// OnRequestHeaders implements v1alpha2.RequestHeaderPolicy.
// NPI masking operates on the body, so headers are passed through unchanged.
func (p *NPIMaskingRegexPolicy) OnRequestHeaders(ctx context.Context, reqCtx *policy.RequestHeaderContext, params map[string]interface{}) policy.RequestHeaderAction {
	return policy.UpstreamRequestHeaderModifications{}
}

// OnResponseHeaders implements v1alpha2.ResponseHeaderPolicy.
// NPI masking operates on the body, so headers are passed through unchanged.
func (p *NPIMaskingRegexPolicy) OnResponseHeaders(ctx context.Context, respCtx *policy.ResponseHeaderContext, params map[string]interface{}) policy.ResponseHeaderAction {
	return policy.DownstreamResponseHeaderModifications{}
}

// OnRequestBody masks NPI in the request body before forwarding to upstream.
func (p *NPIMaskingRegexPolicy) OnRequestBody(ctx context.Context, reqCtx *policy.RequestContext, _ map[string]interface{}) policy.RequestAction {
	if reqCtx == nil || reqCtx.Body == nil || len(reqCtx.Body.Content) == 0 {
		return policy.UpstreamRequestModifications{}
	}

	root, err := parseJSON(reqCtx.Body.Content)
	if err != nil {
		return p.handleRequestError("request body is not valid JSON")
	}

	m := newMasker(p.cfg)
	changed := m.maskRequest(root)
	p.logDetection(m)

	if !changed || p.cfg.Mode == ModeMonitor {
		return policy.UpstreamRequestModifications{}
	}

	if len(m.table.Entries) > 0 {
		if reqCtx.SharedContext == nil {
			return p.handleRequestError("no shared context to carry placeholders to the response")
		}
		if reqCtx.Metadata == nil {
			reqCtx.Metadata = make(map[string]interface{})
		}
		reqCtx.Metadata[MetadataKeyPlaceholders] = m.table
	}
	return policy.UpstreamRequestModifications{Body: encodeJSON(root)}
}

// handleRequestError applies onError. Blocking is the default: forwarding a body
// the policy could not inspect would send unmasked NPI to the LLM.
func (p *NPIMaskingRegexPolicy) handleRequestError(reason string) policy.RequestAction {
	if p.cfg.OnError == OnErrorPassThrough {
		slog.Warn("NPIMaskingRegex: request forwarded unmasked", "reason", reason, "onError", p.cfg.OnError)
		return policy.UpstreamRequestModifications{}
	}
	return p.buildErrorResponse(reason).(policy.RequestAction)
}

// OnResponseBody restores NPI placeholders in a buffered response body.
func (p *NPIMaskingRegexPolicy) OnResponseBody(ctx context.Context, respCtx *policy.ResponseContext, _ map[string]interface{}) policy.ResponseAction {
	if respCtx == nil || respCtx.ResponseBody == nil || len(respCtx.ResponseBody.Content) == 0 {
		return policy.DownstreamResponseModifications{}
	}
	t := placeholdersFrom(respCtx.SharedContext)
	if t == nil {
		return policy.DownstreamResponseModifications{}
	}
	if restored, ok := restoreBody(string(respCtx.ResponseBody.Content), t); ok {
		return policy.DownstreamResponseModifications{Body: []byte(restored)}
	}
	return policy.DownstreamResponseModifications{}
}

// NeedsMoreResponseData implements v1alpha2.StreamingResponsePolicy.
//
// A plain JSON body accumulates until it parses. An SSE stream accumulates while
// a window ends mid-event or while any text or tool-argument stream ends in a
// bracket that could still be completing a placeholder.
func (p *NPIMaskingRegexPolicy) NeedsMoreResponseData(accumulated []byte) bool {
	if p.cfg.Mode == ModeMonitor {
		return false
	}
	s := string(accumulated)
	if !isSSE(s) {
		return needsMoreJSON(s)
	}
	return needsMoreSSE(s)
}

// OnResponseBodyChunk implements v1alpha2.StreamingResponsePolicy. Restores NPI
// placeholders in a flushed response window. NeedsMoreResponseData guarantees
// the window holds whole placeholders, so no state is carried between calls.
func (p *NPIMaskingRegexPolicy) OnResponseBodyChunk(ctx context.Context, respCtx *policy.ResponseStreamContext, chunk *policy.StreamBody, params map[string]interface{}) policy.StreamingResponseAction {
	if chunk == nil || len(chunk.Chunk) == 0 || respCtx == nil {
		return policy.ForwardResponseChunk{}
	}
	t := placeholdersFrom(respCtx.SharedContext)
	if t == nil {
		return policy.ForwardResponseChunk{}
	}
	if restored, ok := restoreBody(string(chunk.Chunk), t); ok {
		return policy.ForwardResponseChunk{Body: []byte(restored)}
	}
	return policy.ForwardResponseChunk{}
}

// restoreBody restores an SSE window or a JSON body. A body that does not parse
// is restored as raw JSON text. Restoration never blocks: an unrestored
// placeholder exposes no NPI, so failing open here is safe.
func restoreBody(s string, t *placeholderTable) (string, bool) {
	if isSSE(s) {
		return restoreSSE(s, t)
	}
	if root, err := parseJSON([]byte(s)); err == nil {
		if restoreTree(root, t, 0) {
			return string(encodeJSON(root)), true
		}
		return s, false
	}
	restored := restoreJSONFragment(s, t)
	return restored, restored != s
}

func placeholdersFrom(sc *policy.SharedContext) *placeholderTable {
	if sc == nil || sc.Metadata == nil {
		return nil
	}
	t, ok := sc.Metadata[MetadataKeyPlaceholders].(*placeholderTable)
	if !ok || t == nil || len(t.Entries) == 0 {
		return nil
	}
	return t
}

// logDetection emits a debug log describing which NPI entities matched.
// Only entity names (from policy config) and counts are logged — never the
// matched values, which are the NPI this policy exists to keep out of logs.
func (p *NPIMaskingRegexPolicy) logDetection(m *masker) {
	if !slog.Default().Enabled(context.Background(), slog.LevelDebug) {
		return
	}
	total := m.total()
	if total == 0 {
		slog.Debug("NPIMaskingRegex: no NPI detected", "mode", p.cfg.Mode)
		return
	}
	slog.Debug("NPIMaskingRegex: NPI detected",
		"mode", p.cfg.Mode,
		"entities", m.counts,
		"matchCount", total)
}

func (p *NPIMaskingRegexPolicy) buildErrorResponse(reason string) interface{} {
	responseBody := map[string]interface{}{
		"code":    APIMInternalExceptionCode,
		"message": "Error occurred during npi-masking-regex mediation: " + reason,
	}

	bodyBytes, err := json.Marshal(responseBody)
	if err != nil {
		bodyBytes = []byte(fmt.Sprintf(`{"code":%d,"type":"NPI_MASKING_REGEX","message":"Internal error"}`, APIMInternalExceptionCode))
	}

	return policy.ImmediateResponse{
		StatusCode: APIMInternalErrorCode,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
		Body: bodyBytes,
	}
}
