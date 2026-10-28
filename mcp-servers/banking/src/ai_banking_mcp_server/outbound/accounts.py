"""The bank's accounts resource API."""

from __future__ import annotations

from ai_banking_mcp_server.outbound.client import request
from ai_banking_mcp_server.outbound.oauth import BankToken


async def fetch_accounts(*, base_url: str, verify_tls: bool = True, bank_token: BankToken) -> list[dict]:
    payload = await request("GET", f"{base_url.rstrip('/')}/accounts", bank_token=bank_token, verify_tls=verify_tls)
    return payload if isinstance(payload, list) else payload.get("accounts", [payload])
