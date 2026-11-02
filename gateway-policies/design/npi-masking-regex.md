# npi-masking-regex: design

Status: **Draft for review** · Policy version: `v0.1.0` · Target gateway: `1.2.1` (WSO2 Agent Manager)

## 1. Purpose

A gateway guardrail that keeps banking **Nonpublic Personal Information (NPI)**
(the GLBA / Regulation P term for consumer financial data) out of LLM requests
while letting an agent keep working with the real values.

It masks NPI in what the agent sends to the LLM and restores it in what the LLM
sends back, so a value the model never saw can still flow into the agent's next
tool call.

### Why not `pii-masking-regex`

The existing policy cannot be configured to meet these requirements, and it is
maintained by another team:

| Need | `pii-masking-regex` | Consequence |
|---|---|---|
| Find a value by its JSON key | Masks the whole regex match, so the key goes with the value | Restored tool arguments become `"accountId":"acc-…"` and the tool call fails |
| Lookbehind / capture groups | Not available: RE2, whole-match only | Labels like `Account number:` are masked along with the value |
| Checksums | None | False positives (e.g. card regex matches digits inside an IBAN) |
| Stable placeholders | Per-request counter with random map order | Same value gets a different placeholder each turn, which also breaks prompt caching |
| Tool-call arguments in streaming | Text deltas only | A streamed `get_transactions([ACCOUNT_ID_…])` reaches the agent unrestored |
| Failure | Passes through on streaming errors | Masked text can leak, or unmasked text can be forwarded |

## 2. Requirements

**Functional**

- **F1 Key-identified values.** In structured data (tool results, tool-call
  arguments), mask a value because of its key, and mask **only the value**.
- **F2 Format-identified values.** Mask values with a verifiable format (IBAN,
  card number, …) wherever they appear, in free text or JSON.
- **F3 Round trip.** A placeholder the LLM copies into a tool call or answer is
  restored to the exact original value and JSON type before the agent sees it.
  This is what makes the accounts → transactions flow work.
- **F4 Configuration.** Every built-in entity can be disabled, switched between
  mask and redact, and given extra keys without a code change. Operators can
  add their own entities.
- **F5 No amounts.** Balances and transaction amounts are never masked by
  default, because the agent needs to reason over them.

**Non-functional**

- **N1 Fail closed.** An unparseable body or unknown format is blocked by default,
  never forwarded unmasked.
- **N2 No NPI in logs.** Only entity names and counts are logged.
- **N3 Deterministic.** The same value produces the same placeholder on every
  turn and every replica that shares the key.
- **N4 Stateless.** No session store; each request carries everything needed to
  restore its response.
- **N5 Platform-native.** Same SDK, layout, licence headers, factory and error
  conventions as `pii-masking-regex`. Published through the documented
  `build.yaml` → `ap gateway image build` path.

## 3. Entities

### 3.1 Format-detected (anywhere: free text and JSON string values)

| Entity | Candidate regex (RE2) | Validation | Default action |
|---|---|---|---|
| `IBAN` | `\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b` | ISO 13616 mod-97 + per-country length | mask |
| `CARD_NUMBER` | `\b\d(?:[ -]?\d){12,18}\b` | Luhn + issuer prefix (IIN ranges) | mask |
| `EMAIL` | built-in regex of `pii-masking-regex` | none | mask |
| `PHONE` | `\+[1-9](?:[ -]?\d){6,14}\b` | E.164 only (requires leading `+`) | mask |

**Priority:** IBAN → CARD_NUMBER → PHONE → EMAIL. A span claimed by a
higher-priority detector is not re-examined. This is how the digits inside an
IBAN stop being read as a card number.

### 3.2 Key-detected (JSON objects inside message payloads)

Keys are normalised before matching: lower-case, then every character outside
`[a-z0-9]` is removed. `accountNumber`, `account_number` and `Account-Number`
all become `accountnumber`. Matching is **exact** on the normalised form, not a
substring.

| Entity | Default keys (normalised) | Labelled-text value shape | Default action |
|---|---|---|---|
| `ACCOUNT_NUMBER` | accountnumber, accountno, accountnum, acctnumber, acctno, bankaccountnumber | `[A-Z0-9][A-Z0-9 -]{3,33}`, must contain a digit | mask |
| `ACCOUNT_ID` | accountid, acctid | `[A-Za-z0-9][A-Za-z0-9_-]{3,63}`, must contain a digit | mask |
| `CARD_NUMBER` | cardnumber, cardno, pan, primaryaccountnumber | as 3.1 | mask |
| `CARD_EXPIRY` | expiry, expirydate, expirationdate, cardexpiry, expdate, validthru | `(?:0[1-9]\|1[0-2])\s*/\s*(?:\d{2}\|\d{4})` | redact |
| `CARD_CVV` | cvv, cvv2, cvc, cvc2, csc, securitycode | `\d{3,4}` | redact |
| `IBAN` | iban | as 3.1 | mask |
| `CUSTOMER_ID` | customerid, customernumber, cif, cifnumber, memberid | `[A-Za-z0-9][A-Za-z0-9_-]{3,63}`, must contain a digit | mask |
| `NATIONAL_ID` | nationalid, nic, ssn, nin, taxid, tin | `[A-Za-z0-9][A-Za-z0-9 -]{4,19}`, must contain a digit | mask |
| `PASSPORT_NUMBER` | passportnumber, passportno | `[A-Z0-9]{6,9}`, must contain a digit | mask |
| `DATE_OF_BIRTH` | dob, dateofbirth, birthdate | `\d{4}-\d{2}-\d{2}\|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}` | mask |
| `PHONE` | phone, phonenumber, mobile, mobilenumber, msisdn | `\+?\d[\d -]{6,18}\d` | mask |
| `EMAIL` | email, emailaddress | as 3.1 | mask |
| `ADDRESS` | address, streetaddress, addressline1, addressline2, postalcode, zipcode | not detected in free text | mask |

How values are handled by type:

- **Scalars** (string, number) are masked. `null` and booleans are ignored.
- **Arrays** have each scalar element masked.
- **Objects** under a matched key (e.g. `address: {…}`) have every scalar leaf
  masked under the same entity.

### 3.3 Labelled free text

Prose has no JSON keys, so each key-detected entity also gets a label regex,
compiled once at startup from its key list. Each key is split into words
(`accountNumber` → `account number`), passed through `regexp.QuoteMeta`, and
assembled as:

```
(?i)\b(?:account[\s_-]*number|acct[\s_-]*no|…)\b\s*(?:[:#=]|is)?\s*(<value shape>)
```

Only capture group 1 is masked, so the label survives:
`Account number: [ACCOUNT_NUMBER_3f9a12c4]`.

The "must contain a digit" rule is what stops prose such as *"an account id is
required"* from masking the word `required`.

### 3.4 Excluded by default

- **Amounts** (balance, amount, income, credit limit): F5.
- **Personal names:** the user's own message carries names unmasked, so masking
  the tool result's `name` breaks payee matching ("pay Dana Lee"). `name` is also
  ambiguous: on accounts it holds "Everyday Checking". Operators who accept that
  cost can add a custom entity.
- **SWIFT/BIC, routing number, sort code:** these identify a bank, not a
  customer, and are public. An unlabelled BIC also collides with ordinary
  uppercase words.
- **`clientid`:** collides with OAuth `client_id`.

## 4. Configuration

### 4.1 User parameters (`parameters`)

```yaml
mode: enforce            # enforce | monitor  (monitor: detect + log, never rewrite)
onError: block           # block | passThrough
labelledText: true       # 3.3 on/off
entities:                # overrides for built-ins; an omitted entity keeps its defaults
  - name: CUSTOMER_ID
    enabled: false
  - name: ACCOUNT_NUMBER
    additionalKeys: [accNo]
  - name: ACCOUNT_ID
    action: redact
customEntities:          # operator-defined, key-based, optional value regex
  - name: LOYALTY_ID
    keys: [loyaltyId, rewardsNumber]
    valueRegex: '[A-Z]{2}\d{8}'   # optional: enables format/labelled detection; RE2
    action: mask
```

Built-ins are **on by default (opt-out)**, so a new deployment is safe until an
operator deliberately turns something off.

Validation runs in `GetPolicy`, so a bad configuration is rejected when it is
deployed, not at request time:

- Entity names match `^[A-Z][A-Z_]*$`. This keeps the placeholder alphabet that
  stream boundary detection relies on. Names are unique, and custom names may
  not reuse built-in names.
- `entities[].name` must be a known built-in.
- Keys must be non-empty after normalisation. A key may not belong to two entities.
- `valueRegex` must compile.
- At least one entity must be enabled.

Every complex parameter carries `x-wso2-policy-advanced-param: true`, as in
`pii-masking-regex`, so the Agent Manager form shows the simple toggles first.

### 4.2 System parameters (`systemParameters`)

| Name | Source | Purpose |
|---|---|---|
| `hmacKey` | `"wso2/defaultValue": "${config.npi_masking_regex_hmac_key}"` | Placeholder derivation key (5.2) |

The key never appears as a literal. It is resolved through `config.toml`'s
documented secret tokens (docs-api-platform `api-gateway/1.2.0/setup/configuration.md:34-37`).
The mounted-file form is preferred:

```toml
npi_masking_regex_hmac_key = '{{ file "/etc/npi-masking/hmac-key" }}'      # Secret mounted as a file
# or
npi_masking_regex_hmac_key = '{{ env "APIP_GW_NPI_MASKING_HMAC_KEY" "" }}' # Secret injected as an env var
```

In AMP this line goes in the gateway extension chart's
`apiGateway.config.config_toml`. The chart's own comments direct secrets to
an env token backed by a Secret (`systemExtraEnv`), never a literal.

If the key is absent, a random per-process key is generated and a warning is
logged once. Correctness doesn't depend on the key (each request restores only
its own placeholders, see 5.4). A shared key only buys placeholder stability
across replicas and restarts, which helps prompt caching.

## 5. Behaviour

### 5.1 Scope: what is scanned

Only conversation payloads are scanned. Tool definitions, JSON schemas, model
parameters and metadata are never scanned. Without this rule, an `accountId`
property in a tool's input schema would be rewritten and the tool definition
corrupted.

A single union adapter handles both supported wire formats per message, so no
up-front provider sniffing is needed:

| Payload slot | Anthropic Messages | OpenAI Chat Completions | Treated as |
|---|---|---|---|
| Plain text | `content` string, `text` block | `content` string or `text` part | text |
| Tool result | `tool_result.content` (string or text blocks) | `role: tool` message `content` | JSON if it parses, else text |
| Tool-call arguments (history) | `tool_use.input` (object) | `tool_calls[].function.arguments` (JSON string) | JSON |
| System prompt | `system` | `role: system` / `developer` | text, format detectors only |

Assistant tool calls already in the history are scanned too. Their values
were restored on the previous turn, so without this they would reach the LLM in
clear on the next one.

v0.1 supports Anthropic Messages and OpenAI Chat Completions. OpenAI Chat
Completions also covers every OpenAI-compatible provider. Gemini and the OpenAI
Responses API are planned for v0.2. A JSON body without a `messages` array
(embeddings, or a provider this version does not know) is walked generically,
minus the non-payload fields (`tools`, `functions`, `tool_choice`,
`response_format`, `model`, `stream`), so it is still protected. Only a body
that is not valid JSON falls under `onError`.

*Implementation note:* one union walk handles both formats per message, so no
provider detection exists. Thinking, image and document blocks are never
rewritten: thinking blocks carry a signature over their exact bytes.

### 5.2 Placeholders

```
[<ENTITY>_<8 lowercase hex>]      e.g. [ACCOUNT_ID_3f9a12c4]
hex = first 4 bytes of HMAC-SHA256(hmacKey, ENTITY || 0x00 || value)
```

- **Same alphabet as `pii-masking-regex`** (`[A-Z_]+_[0-9a-f]+`), so the proven
  streaming boundary rule carries over unchanged.
- **HMAC rather than a plain hash.** CVVs, dates and short IDs have tiny value
  spaces, so an unkeyed hash could be reversed by brute force by anyone who sees
  the prompt, including the LLM provider.
- **Collisions.** If two different values in one request produce the same
  placeholder, the second is extended to 12 hex digits. Detection is a map
  lookup.
- **Redaction** uses `*****`, as `pii-masking-regex` does. Redacted values are
  never stored and never restored.

### 5.3 Request path (`OnRequestBody`, buffered)

1. Decode the body into an **order-preserving tree** (`json.Decoder` tokens,
   numbers kept as `json.Number`). A Go `map` would reorder keys. That changes
   the prompt bytes, which breaks prompt caching and makes diffs unreadable.
2. For each payload slot (5.1):
   - **JSON slot:** walk the tree. A normalised key match masks the value (3.2).
     Every remaining string leaf goes through the format detectors (3.1) and,
     if enabled, the labelled-text detectors (3.3). A string that itself parses
     as JSON (a tool result inside a tool result) is walked recursively, up to
     depth 8. So is a *sequence* of JSON objects or arrays, concatenated or
     NDJSON. pydantic-ai's MCP integration sends a multi-item tool result as
     pretty-printed objects one after another, which is not a single JSON
     document. The end-to-end test found this: it would otherwise be read as
     prose and its key-based values missed. A changed sequence is re-encoded
     as NDJSON.
   - **Text slot:** format detectors, then labelled-text detectors.
3. Record `placeholder → {value, JSON type}` in request metadata under
   `npimaskingregex:placeholders`.
4. Re-encode only the slots that changed, then the body.
5. In `monitor` mode, do steps 1–2 for counting only and forward the original body.

**Echo pass** (added after the end-to-end test). The agent re-sends its own
earlier answers, which the response phase restored for the user. A value found
only by its key (`"accountNumber": "••••7756"`) reappears there as bare prose
(`Account: ••••7756`), with no key, no label shape and no format. The detectors
cannot see it, and it reached the LLM in clear on the second turn. The tool
result it came from is still in the request's history, so after the first pass
a second pass replaces verbatim occurrences of every value masked or redacted
in the first pass, using the same placeholder (or `*****`). It runs over every
slot the first pass scanned.

- Values shorter than 4 characters are not echo-masked (a 3-digit CVV would
  match ordinary text).
- Existing placeholders are protected, so a value that looks like placeholder
  hex is never replaced inside one.
- Limitation: if an agent drops old tool results from its history but keeps its
  own answers, the value is no longer known in that request and its echo is
  not masked.

### 5.4 Response path

Only placeholders minted for **this request** are restored. A placeholder typed
by a user, or produced by a prompt injection, maps to nothing and is left as
text.

**Buffered (non-streaming):**

| Slot | Anthropic | OpenAI |
|---|---|---|
| Text | `content[].text` | `choices[].message.content` |
| Tool-call arguments | `content[].input` (object) | `choices[].message.tool_calls[].function.arguments` (string) |

- **Restore in the decoded value, then re-encode.** Never restore by raw byte
  replacement. A raw replace would inject unescaped quotes when an original
  value contains `"` or `\`.
- **Restore the original JSON type.** When a tool argument's whole value is a
  placeholder, the value goes back with its original type. A masked number
  `40031122` returns as a number, not as `"40031122"`.

**Streaming (SSE):**

| Delta | Anthropic | OpenAI |
|---|---|---|
| Text | `content_block_delta` → `delta.text` | `choices[0].delta.content` |
| Tool-call arguments | `content_block_delta` → `delta.partial_json` | `choices[0].delta.tool_calls[].function.arguments` |

- **Buffering:** use `NeedsMoreResponseData` with the same rule as
  `pii-masking-regex`. Keep buffering while the assembled text of a slot ends in
  an unclosed `[` that could still become a placeholder, capped at 64 bytes.
- **Argument fragments are raw JSON text.** A value restored into
  `partial_json` / `arguments` is inserted **JSON-string-escaped**.
- **Typed values in streaming.** If a placeholder sits between quotes and the
  original was a number, the quotes are consumed too. A window cannot see what
  the previous window ended with, so an argument window that ends on a `"`, or
  exactly on a placeholder, is held for one more event. That way both quotes
  are always in the same window. (Found by the every-byte split test.)
- **Fragments are emptied, not dropped.** After restoring a stream's assembled
  text, the first fragment carries it and the others become `""`. Every event,
  including Anthropic's `event:` lines, keeps its place.
- **Restoration fails open.** A response that cannot be parsed is forwarded
  with placeholders intact. That exposes no NPI (the placeholder *is* the
  masked form), so blocking would only break the conversation. `onError`
  applies to requests, where failing open would leak.

### 5.5 Processing mode

Same as `pii-masking-regex`: request headers skip, **request body buffer**,
response headers skip, **response body stream**.

### 5.6 Errors

The error response uses `pii-masking-regex`'s `buildErrorResponse` shape and
codes (HTTP 500, code `900967`), with the message prefix
`Error occurred during npi-masking-regex mediation:`. Messages never include
matched values.

## 6. Security considerations

| Threat | Mitigation |
|---|---|
| NPI in logs or traces | Log entity names and counts only (`slog.Debug`, as the original) |
| Reversing placeholders | Keyed HMAC (5.2) |
| Forged placeholders restoring someone else's data | Restore map is per request, built only from values in that request |
| Unmasked forward on bad input | `onError: block` default; `monitor` mode for safe rollout |
| ReDoS | RE2, linear time. Regexes compiled once in `GetPolicy` |
| Pathological bodies | Embedded-JSON depth limit 8; total size bounded by the gateway's body buffer limit |
| Tool-definition corruption | Scope rule (5.1) |

## 7. Code layout

Follows `gateway-controllers` conventions. Policies with several concerns
(`mcp-tool-schema-validator`, `llm-cost`) keep **one flat Go package**, split
into files by concern, with fixtures in `testdata/`. `pii-masking-regex` is
the single-file case of the same convention.

```
gateway-policies/                          # future repository root
├── policies/npi-masking-regex/
│   ├── go.mod                             # go 1.26.1; github.com/wso2/api-platform/sdk/core v0.2.4
│   ├── go.sum
│   ├── policy-definition.yaml             # name, version v0.1.0, displayName, description, parameters, systemParameters
│   ├── npimaskingregex.go                 # constants, GetPolicy, Mode, On* hooks, buildErrorResponse
│   ├── config.go                          # parameter parsing + validation
│   ├── entities.go                        # built-in entity catalogue (3.1, 3.2)
│   ├── detectors.go                       # format + labelled-text detectors, Luhn, IBAN mod-97
│   ├── walker.go                          # order-preserving JSON tree, key normalisation, masking walk
│   ├── placeholder.go                     # HMAC placeholders, mask/restore maps
│   ├── payload.go                         # request/response slot extraction (Anthropic, OpenAI)
│   ├── stream.go                          # SSE restoration, NeedsMoreResponseData
│   ├── npimaskingregex_test.go
│   ├── config_test.go
│   ├── detectors_test.go
│   ├── walker_test.go                     # includes FuzzMaskRestore
│   ├── stream_test.go
│   └── testdata/                          # captured Anthropic/OpenAI requests, responses, SSE streams
├── docs/npi-masking-regex/v0.1/
│   ├── metadata.json                      # name, displayName, version "0.1", provider, categories, description
│   └── docs/npi-masking-regex.md          # user docs, same section structure as pii-masking-regex.md
├── build/build.yaml                       # gateway build (section 9)
└── design/npi-masking-regex.md            # this document
```

Conventions carried over:

- **Licence header:** the exact Apache-2.0 block from `piimaskingregex.go`
  (`Copyright (c) 2026, WSO2 LLC.`) on **every** `.go` file, tests included.
  Upstream's `piimaskingregex_test.go` lacks it, and we won't copy that gap.
- **Package and module naming:** package `npimaskingregex`. The Go module path
  is the **future repository's** path (e.g.
  `github.com/<org>/<repo>/policies/npi-masking-regex`), never
  `github.com/wso2/gateway-controllers/...`. The production build references
  the policy by that path (section 9).
- **SDK and factory:** SDK `policy/v1alpha2`, a package-level `GetPolicy`
  factory, and `Mode()`. Both are mandatory for the gateway builder.
- **Dependencies:** standard library only, plus `sdk/core`. Tests use plain
  `testing` and table-driven cases, no assertion libraries.
- **Logging:** `log/slog`, with debug-level detection logs guarded by
  `slog.Default().Enabled`.

## 8. Testing

| Level | What |
|---|---|
| Unit | Table-driven per detector: valid and invalid checksums, boundaries, priority overlaps; config validation errors; key normalisation |
| Golden | `testdata/` request/response pairs for both formats, including the accounts → transactions two-tool flow and history replay |
| Property / fuzz | `FuzzMaskRestore`: for any body, restore(mask(x)) equals x semantically, and no detected value survives in mask(x) |
| Streaming | Every placeholder split at every byte offset across SSE events, for text and tool-argument deltas |
| Benchmark | Latency per request size (1 KB / 32 KB / 256 KB); budget agreed before v0.1.0 |
| Integration | Custom gateway image on k3d with a mock LLM upstream |
| End-to-end | Demo agent in AMP: tool result masked at the LLM, restored tool call succeeds, final answer shows real values |

CI: `gofmt`/`go vet`/`golangci-lint`, `go test -race ./...`, a short fuzz run
(`-fuzztime=30s`), and a licence-header check.

## 9. Publishing to Agent Manager

Every step below comes from the official API Platform documentation
(`docs-api-platform`, gateway 1.2.0 docs; AMP runs 1.2.1) or from AMP's own
installation guide. Agent Manager has no separate custom-guardrail procedure:
its guardrail catalogue is whatever the gateway reports
(`agent-manager/documentation/docs/concepts/llm-service-provider.mdx:59`).
The AI Gateway guardrail catalogue sends custom guardrails to the same
custom-policy guide (`ai-gateway/next/guardrails/guardrails-catalogue.md:43-45`).

| Step | Source |
|---|---|
| Write the policy (Go module, `Mode`, phase hooks, `GetPolicy`, `policy-definition.yaml`) | `api-gateway/1.2.0/policies/custom-policies/writing-a-custom-policy.md` |
| Add it to `build.yaml`, build images with `ap` | `api-gateway/1.2.0/policies/custom-policies/building-gateway-with-custom-policies.md` |
| Run the images on Kubernetes through the gateway operator | `api-gateway/1.2.0/deployment/deployment-modes/kubernetes/gateway-operator.md`; AMP `_amp-installation.mdx:73-76` |
| Supply secrets to system parameters | `api-gateway/1.2.0/setup/configuration.md:34-37` |

1. **Build file.** Start from the `build.yaml` shipped in the gateway
   distribution package for AMP's gateway version. The guide says to *edit
   this file to add your custom policies*, so the stock policies stay
   listed. Then add one entry. The guide defines two source types:

   | Stage | Entry | Doc's guidance |
   |---|---|---|
   | Development (this repo, now) | `filePath: ../policies/npi-masking-regex` | "`filePath` for local development", relative to `build.yaml` |
   | Production (own repository) | `gomodule: github.com/<org>/<repo>/policies/npi-masking-regex@v0` | "For published policies (production), use the module reference" |

   The `name` must equal `policy-definition.yaml`'s `name`. The list *is* the
   gateway's policy set: the builder compiles only what is listed. That's
   inferred from `gateway-builder/cmd/builder/main.go` and consistent with the
   guide's "edit this file" wording.
2. **Build images.** From the directory holding `build.yaml`, run
   `ap gateway image build` (ap CLI v0.9.1 per the guide). Add
   `--repository <registry> --push` to publish. The build prints the two image
   names (`…-gateway-controller`, `…-gateway-runtime`) and writes
   `build-manifest.yaml` with the resolved policy versions. Keep that manifest
   as a build record. For WSO2 subscription builds, set all three
   `gateway.images` keys to `registry.wso2.com` as the guide describes.
3. **Deploy.** Install or upgrade the gateway operator with the image values
   from AMP's installation guide pointed at those images
   (`agent-manager/documentation/docs/guides/_partials/_amp-installation.mdx:73-76`):
   ```bash
   --set gateway.values.gateway.controller.image.repository=<registry>/amp-gateway-controller \
   --set gateway.values.gateway.controller.image.tag=1.2.1 \
   --set gateway.values.gateway.gatewayRuntime.image.repository=<registry>/amp-gateway-runtime \
   --set gateway.values.gateway.gatewayRuntime.image.tag=1.2.1
   ```
   A default change applies only to new gateways. Roll existing ones by bumping
   `spec.infrastructure.annotations` on each `APIGateway`
   (`api-platform/kubernetes/gateway-operator/README.md:143-181`).
4. **HMAC key.** Set `config_toml` and the Secret as in 4.2.
5. **Verify.** The controller pushes its manifest on connect, and
   **NPI Masking Regex** appears under the provider's Guardrails tab.
   Reference it as version `v0`: AMP deploys major-only versions.

Constraints to respect:

- **One policy bundle per AMP deployment.** AMP keeps a single, last-push-wins
  manifest for all gateways
  (`agent-manager-service/services/gateway_manifest_cache.go:26`). Every gateway
  must run the custom image, or the picker flips between bundles.
- **LLM providers only.** MCP proxies get their policy list by intersecting with
  Policy Hub, so a local policy won't appear there. That's fine, because this
  guardrail targets LLM traffic.
- **k3d.** There is no documented guidance for local registries. Push to a
  registry the cluster can pull from, or `k3d image import` the two images
  before step 3.

## 10. Delivery plan

| Phase | Output | Exit criterion |
|---|---|---|
| 0 | This design, reviewed | Open decisions (11) closed |
| 1 | Publishing spike: a no-op policy built, deployed, visible in AMP | Appears in the Guardrails picker on k3d |
| 2 | `config`, `entities`, `detectors`, `placeholder` + unit tests | Coverage ≥ 90 %; fuzz clean |
| 3 | `walker`, `payload`, buffered request/response | Golden two-tool flow passes |
| 4 | `stream` | Every-offset split tests pass |
| 5 | Docs (`docs/…/v0.1`), CI, image build | Image published |
| 6 | Rollout: `monitor` on the demo agent → `enforce` → provider-wide | No false positives in monitor logs over an agreed window |

## 11. Open decisions

1. **Personal names.** Keep them excluded (3.4), or ship a disabled-by-default
   `PERSON_NAME` entity?
2. **`ACCOUNT_ID` on by default.** It's an internal reference rather than
   customer data, but the demo flow is built on it.
3. **Go module path.** Which future repository (org/name)? Production builds
   reference the policy by this path (`gomodule:`), so it should be fixed
   before v0.1.0 is tagged.
4. **Gemini / OpenAI Responses.** Confirm these can wait for v0.2.
5. **Latency budget** for the benchmark gate.
