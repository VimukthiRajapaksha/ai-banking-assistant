"""The bank's payments resource API."""

from __future__ import annotations

from ai_banking_mcp_server.outbound.client import request
from ai_banking_mcp_server.outbound.oauth import BankToken


async def execute_payment(
    *, base_url: str, verify_tls: bool = True, payee: str, amount: str, debtor_account: str,
    reference: str = "", bank_token: BankToken
) -> dict:
    """Submit one payment.

    The gateway checks the payee, amount and funding account against the consent
    the customer approved, so they must be exactly what was authorised -- not a
    re-derived or re-rounded version of it. The reference is what the customer
    said the payment was for, and rides along so the statement shows it.
    """
    payload = await request(
        "POST",
        f"{base_url.rstrip('/')}/accounts/{debtor_account}/payments",
        bank_token=bank_token,
        verify_tls=verify_tls,
        json={"payee": payee, "amount": amount, "reference": reference},
    )
    return payload if isinstance(payload, dict) else {"result": payload}
