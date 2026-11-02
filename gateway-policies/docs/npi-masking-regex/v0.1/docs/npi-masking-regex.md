---
title: "Overview"
---
# NPI Masking Regex Guardrail

## Overview

The NPI Masking Regex Guardrail keeps banking **Nonpublic Personal Information
(NPI)** out of LLM requests while letting an agent keep working with the real
values. It masks NPI in what an agent sends to the LLM and restores it in what
the LLM sends back. A value the model never saw can therefore still flow into
the agent's next tool call.

Values are found three ways:

- **By key** in structured data: tool results and tool-call arguments.
  `{"accountId": "acc-chk-1120"}` becomes
  `{"accountId": "[ACCOUNT_ID_3f9a12c4]"}`. Only the value is replaced; the
  key stays, so the LLM still knows what the value is.
- **By format**, anywhere: IBAN (mod-97 checked), card number (Luhn checked),
  E.164 phone number, email.
- **By label** in free text: `Account number: 40031122` becomes
  `Account number: [ACCOUNT_NUMBER_9c1d07ab]`.

The policy supports Anthropic Messages and OpenAI Chat Completions, both
buffered and streamed (SSE), including streamed tool-call arguments.

## Features

- Value-only masking: JSON keys and text labels are never removed.
- Round trip through tool calls: a placeholder the LLM copies into a tool call
  is restored, with its original JSON type, before the agent receives it.
- Deterministic placeholders (HMAC-SHA256): the same value gets the same
  placeholder on every turn, so masked history stays consistent and prompt
  caching keeps working.
- Per-entity action: `mask` (restorable) or `redact` (`*****`, never restored).
- Checksums on format detection, which keeps false positives low.
- Fail closed: a request the policy cannot inspect is blocked by default.
- `monitor` mode for rollout: detects and logs counts without changing traffic.
- Matched values are never logged; only entity names and counts are.

## Configuration

### User Parameters (API Definition)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `mode` | string | No | `enforce` | `enforce` masks requests and restores responses. `monitor` only detects and logs entity counts. |
| `onError` | string | No | `block` | For a request body that is not valid JSON: `block` rejects it with HTTP 500; `passThrough` forwards it unmasked and logs a warning. |
| `labelledText` | boolean | No | `true` | Detect key-based entities in free text by their label. |
| `entities` | `EntityOverride` array | No | - | Overrides for the built-in entities. Every built-in is enabled by default. |
| `customEntities` | `CustomEntity` array | No | - | Deployment-specific entities. |

#### EntityOverride

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Built-in entity name (see the table below). |
| `enabled` | boolean | No | `false` turns the entity off. |
| `action` | string | No | `mask` or `redact`. |
| `additionalKeys` | string array | No | Extra JSON keys for this entity. |

#### CustomEntity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Uppercase letters and underscores; must not reuse a built-in name. |
| `keys` | string array | One of `keys`/`valueRegex` | JSON keys that identify the entity. |
| `valueRegex` | string | One of `keys`/`valueRegex` | Go RE2 pattern for the value. When set, the value is also detected anywhere by its format. |
| `action` | string | No | `mask` (default) or `redact`. |

### System Parameters

| Parameter | Config key | Description |
|-----------|------------|-------------|
| `hmacKey` | `npi_masking_regex_hmac_key` | Key used to derive placeholders. Supply it from a secret (`{{ env "..." }}` or `{{ file "..." }}` in `config.toml`). When empty, a random per-process key is used: restoration still works, but placeholders differ across replicas and restarts. |

### Built-in entities

Keys are matched after normalisation: lower-cased, with everything outside
`[a-z0-9]` removed. `accountNumber`, `account_number` and `Account-Number` are
the same key.

| Entity | Keys | Also found by | Default action |
|--------|------|---------------|----------------|
| `ACCOUNT_NUMBER` | accountNumber, accountNo, accountNum, acctNumber, acctNo, bankAccountNumber | label | mask |
| `ACCOUNT_ID` | accountId, acctId | label | mask |
| `CARD_NUMBER` | cardNumber, cardNo, pan, primaryAccountNumber | format (Luhn), label | mask |
| `CARD_EXPIRY` | expiry, expiryDate, expirationDate, cardExpiry, expDate, validThru | label | redact |
| `CARD_CVV` | cvv, cvv2, cvc, cvc2, csc, securityCode | label | redact |
| `IBAN` | iban | format (mod-97) | mask |
| `CUSTOMER_ID` | customerId, customerNumber, cif, cifNumber, memberId | label | mask |
| `NATIONAL_ID` | nationalId, nic, ssn, nin, taxId, tin | label | mask |
| `PASSPORT_NUMBER` | passportNumber, passportNo | label | mask |
| `DATE_OF_BIRTH` | dob, dateOfBirth, birthDate | label | mask |
| `PHONE` | phone, phoneNumber, mobile, mobileNumber, msisdn | format (E.164, leading `+`), label | mask |
| `EMAIL` | email, emailAddress | format | mask |
| `ADDRESS` | address, streetAddress, addressLine1, addressLine2, postalCode, zipCode | — | mask |

Not masked by default:

- **Amounts.** The agent needs them to reason.
- **Personal names.** The user's own message carries them unmasked, so masking
  the tool result's copy breaks matching.
- **Bank identifiers** (BIC, routing number, sort code). They identify a bank,
  not a customer.

**Note:**

Inside the `gateway/build.yaml`, ensure the policy is added under `policies:`:

```yaml
- name: npi-masking-regex
  filePath: ../policies/npi-masking-regex          # local build
  # gomodule: github.com/wso2/bfsi-gateway-policies/policies/npi-masking-regex@v0   # published
```

## Reference Scenarios

### Example 1: Provider-wide guardrail

```yaml
  policies:
    - name: npi-masking-regex
      version: v0
      paths:
        - path: /*
          methods: ["*"]
          params:
            mode: enforce
            onError: block
```

### Example 2: Disable an entity, redact another, add a key

```yaml
          params:
            entities:
              - name: CUSTOMER_ID
                enabled: false
              - name: ACCOUNT_ID
                action: redact
              - name: ACCOUNT_NUMBER
                additionalKeys: [accNo]
            customEntities:
              - name: LOYALTY_ID
                keys: [loyaltyId]
                valueRegex: 'LY\d{8}'
```

### Example 3: Tool-call round trip

The agent sends a tool result to the LLM:

```json
{"type": "tool_result", "content": "[{\"accountId\":\"acc-chk-1120\",\"iban\":\"GB29NWBK60161331926819\",\"balance\":8450.32}]"}
```

The LLM receives:

```json
{"type": "tool_result", "content": "[{\"accountId\":\"[ACCOUNT_ID_3f9a12c4]\",\"iban\":\"[IBAN_0d4e9b21]\",\"balance\":8450.32}]"}
```

The LLM answers with `get_transactions({"accountId": "[ACCOUNT_ID_3f9a12c4]"})`,
and the agent receives `get_transactions({"accountId": "acc-chk-1120"})`.

## How It Works

#### Request Phase

1. The body is decoded into an order-preserving tree, so key order and prompt
   bytes are kept.
2. Conversation payloads are scanned: message text, tool results, and the
   arguments of tool calls already in the history. Tool definitions are never
   scanned. System prompts get format detection only.
3. Key matches mask the whole value. Other strings go through format and label
   detection. A string that is itself JSON is walked recursively, whether it
   holds one document or a sequence of them (concatenated objects, NDJSON).
4. Verbatim echoes of every masked value elsewhere in the request get the same
   placeholder. The main case is the agent's own earlier answers: they were
   restored for the user and come back as prose in the history. Values shorter
   than 4 characters are not echo-masked.
5. Placeholder → original mappings are stored in request metadata for the
   response phase.

#### Response Phase

Placeholders minted for this request are restored in text and in tool-call
arguments. Placeholders the request did not mint are left alone, so a forged
placeholder cannot reveal anything. For streamed responses, the policy holds a
window while it ends in a partial placeholder, at most 64 bytes past the `[`.
It restores the assembled text of each stream and writes it back without
dropping events.

## Notes

- Regular expressions use Go's regexp package (RE2 syntax).
- Entity names must contain only uppercase letters and underscores.
- Placeholder format is `[ENTITY_hhhhhhhh]`: 8 lowercase hex digits, extended to
  12 or 16 on a collision.
- A key matched in structured data identifies the value only under that key.
  Data that uses a generic key (for example `id`) is not masked unless that key
  is added to an entity, which applies to every `id` in the payload.
- Request masking costs about 0.1 ms for a 1 KB conversation and about 2.3 ms at
  32 KB (Apple M3 Pro).
