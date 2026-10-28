"""Shared authenticated HTTP client for the bank's resource APIs."""

from __future__ import annotations

import logging

import httpx

from ai_banking_mcp_server.outbound.oauth import BankToken

logger = logging.getLogger(__name__)


class BankApiError(Exception):
    """Raised when a call to one of the bank's resource APIs fails.

    `status` is the HTTP status, or None when the bank was never reached --
    the tools turn it into guidance for the model, which the message alone
    (a method, a URL and a code) does not give it.
    """

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


async def request(
    method: str,
    url: str,
    *,
    bank_token: BankToken,
    json: dict | None = None,
    verify_tls: bool = True,
) -> dict | list:
    """Make an authenticated request to a bank resource API and return the parsed JSON body.

    Only the call's metadata is logged, never the response body: these
    endpoints return account/payment data, which must not end up in logs.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=verify_tls) as client:
            response = await client.request(
                method,
                url,
                json=json,
                headers={"Authorization": f"{bank_token.token_type} {bank_token.access_token}"},
            )
    except httpx.HTTPError as exc:
        raise BankApiError(f"{method} {url} failed: {exc}") from exc

    logger.debug("%s %s -> %s", method, url, response.status_code)

    if response.status_code == 401:
        raise BankApiError(
            "Bank rejected the access token (401) -- it may have expired or been revoked.", status=401
        )
    if response.status_code == 403:
        # The gateway admitted the token but refused the operation, which means
        # the scope narrowing was wrong for this tool -- a different fault from
        # an expired token, and one that a generic message hides.
        raise BankApiError(
            f"The gateway refused {method} {url} (403): this token's scope does not cover that operation.",
            status=403,
        )
    if response.status_code >= 300:
        raise BankApiError(f"{method} {url} returned {response.status_code}", status=response.status_code)

    return response.json()
