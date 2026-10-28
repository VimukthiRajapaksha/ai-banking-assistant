"""The bank's transactions resource API."""

from __future__ import annotations

from ai_banking_mcp_server.outbound.client import request
from ai_banking_mcp_server.outbound.oauth import BankToken


async def fetch_transactions(
    *, base_url: str, verify_tls: bool = True, account_id: str, limit: int, bank_token: BankToken
) -> list[dict]:
    payload = await request(
        "GET",
        f"{base_url.rstrip('/')}/transactions?accountId={account_id}&limit={limit}",
        bank_token=bank_token,
        verify_tls=verify_tls,
    )
    # Paginated endpoint: the rows are under `items`, and a bare list would
    # mean the bank changed shape underneath us.
    if isinstance(payload, dict):
        payload = payload.get("items", [])
    items = payload if isinstance(payload, list) else payload.get("transactions", [payload])
    # The bank may ignore `limit`; the user asked for a number, so honour it here.
    return items[:limit]
