"""Tool results that report a failure, written for the model that reads them.

Each one says what happened, whether anything changed at the bank, and what to
do next -- the model acts on these, so an opaque code or a URL leaves it
guessing, and a guess here is either a pointless retry or an invented answer.
The technical detail is logged where each failure is caught, not returned.
"""

from __future__ import annotations

from ai_banking_mcp_server.outbound.client import BankApiError

NO_SESSION = (
    "This request did not carry a signed-in customer, so nothing was accessed. "
    "Do not retry. Tell the customer to sign in again and then repeat the request."
)

CONSENT_SERVICE_DOWN = (
    "The bank's permission service could not be reached, so nothing was accessed. "
    "This is temporary and not the customer's doing. Tell them to try again in a few minutes; "
    "do not retry in this turn."
)

BANK_ACCESS_FAILED = (
    "The bank did not grant access for this request, so nothing was accessed. "
    "Tell the customer the bank could not be reached for this and to try again shortly; "
    "do not retry in this turn."
)

STALE_APPROVAL = (
    "The customer's approval for this request has expired or no longer matches it, "
    "so nothing was accessed. Call the tool again to ask for a fresh approval."
)

FOREIGN_APPROVAL = (
    "The approval sent with this request belongs to a different session, so it was "
    "rejected and nothing was accessed. Do not retry. Tell the customer to start the request again."
)

ACCESS_DECLINED = (
    "The customer declined access, so nothing was accessed. Acknowledge their choice, "
    "and only call this tool again if they ask you to."
)


def missing_scope(scope: str) -> str:
    return (
        f"This session was not granted the {scope} permission, so the request was refused "
        "and nothing was accessed. Retrying will not help. Tell the customer you cannot do "
        "this for them in this session."
    )


def bank_api_failure(resource: str, exc: BankApiError, *, by_account_id: bool = False) -> str:
    """A failed read of `resource` ("accounts", "transactions", "payees").

    `by_account_id` marks a read addressed by an account id the model chose,
    which is the one case where a 404 is the model's mistake to correct.
    """
    if exc.status == 401:
        return (
            f"The bank rejected the access used to read {resource}; it has been discarded. "
            "Call this tool once more. If it fails again, tell the customer to try again later."
        )
    if exc.status == 403:
        return (
            f"The bank refused to share {resource} for this session. Retrying will not help. "
            "Tell the customer you cannot see this for them."
        )
    if exc.status == 404 and by_account_id:
        return (
            "The bank has no account with the account_id you sent. Call get_accounts and pass "
            "an `id` value from its result exactly as returned."
        )
    return (
        f"The bank did not return {resource} because of a problem on its side. "
        "Tell the customer the bank is unavailable right now and to try again shortly; "
        "do not retry in this turn."
    )
