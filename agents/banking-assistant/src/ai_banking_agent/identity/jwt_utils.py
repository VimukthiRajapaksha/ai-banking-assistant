"""Unverified JWT payload decoding.

Both tokens decoded here (the agent's own actor_token and the delegated
on-behalf-of token) come straight from a direct HTTPS response from our own
trusted token endpoint -- not from a third party or an untrusted transport --
so there is nothing to verify signature-wise that TLS hasn't already covered.
Contrast with the MCP server's inbound token_verifier, which verifies bearer
tokens presented by *someone else* over the wire and must check the signature.
"""

from __future__ import annotations

import base64
import json
from typing import Any


def decode_claims(jwt_token: str) -> dict[str, Any]:
    payload_b64 = jwt_token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    return json.loads(base64.urlsafe_b64decode(payload_b64))
