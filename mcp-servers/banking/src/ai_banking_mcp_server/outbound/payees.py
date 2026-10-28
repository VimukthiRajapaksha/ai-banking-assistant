"""The bank's saved-beneficiaries API."""

from __future__ import annotations

from ai_banking_mcp_server.outbound.client import request
from ai_banking_mcp_server.outbound.oauth import BankToken


async def fetch_payees(*, base_url: str, verify_tls: bool = True, bank_token: BankToken) -> list[dict]:
    payload = await request("GET", f"{base_url.rstrip('/')}/payees", bank_token=bank_token, verify_tls=verify_tls)
    return payload if isinstance(payload, list) else payload.get("payees", [payload])
