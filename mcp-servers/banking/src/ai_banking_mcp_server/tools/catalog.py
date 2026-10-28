"""What each tool needs, in both vocabularies.

Two different questions are asked of every call, and they are answered at
different granularities:

  * OAuth scope -- coarse, endpoint level ("may you call the accounts API at
    all"). Carried on the token and checked against it.
  * Consent permissions -- fine, data level ("may you see transaction detail").
    Held in the consent record and checked against that.

Permissions are declared TRANSITIVELY: a tool that takes an account id also
declares what resolving that id costs, so asking for transactions implies the
account permissions without the caller having to reason about it.

Risk tiering exists because an agent's tool calls are not deterministic. A
declared plan may name any tool, so anything in RESTRICTED_PERMISSIONS can only
be granted when its tool is ACTUALLY invoked -- never pre-authorised from a
plan. That bounds what a prompt-injected agent can obtain by over-declaring.
"""

from __future__ import annotations

from dataclasses import dataclass, field

GET_ACCOUNTS = "get_accounts"
GET_TRANSACTIONS = "get_transactions"
GET_PAYEES = "get_payees"
MAKE_PAYMENT = "make_payment"
VIEW_CARD_PROMOTIONS = "view_card_promotions"


@dataclass(frozen=True)
class ToolRequirement:
    #: OAuth scope this tool's own endpoint needs on the inbound token.
    mcp_scope: str
    #: Coarse scope required on the bank-audience token.
    bank_scope: str
    #: Fine-grained consent permissions, including transitive needs.
    permissions: frozenset[str] = field(default_factory=frozenset)


#: Permissions sensitive enough that a plan may only reach them by naming the
#: tool that needs them outright -- never by transitive expansion from some
#: other tool. See plan_permissions for why that is the line.
RESTRICTED_PERMISSIONS: frozenset[str] = frozenset(
    {"ReadTransactionsDetail", "ReadPAN", "ReadBeneficiariesDetail"}
)

CATALOG: dict[str, ToolRequirement] = {
    VIEW_CARD_PROMOTIONS: ToolRequirement(mcp_scope="", bank_scope="", permissions=frozenset()),
    GET_ACCOUNTS: ToolRequirement(
        mcp_scope="apex:mcp-accounts:read",
        bank_scope="apex:bank:accounts:read apex:bank:accounts:balances:read",
        permissions=frozenset({"ReadAccountsDetail", "ReadBalances"}),
    ),
    GET_TRANSACTIONS: ToolRequirement(
        mcp_scope="apex:mcp-transactions:read",
        bank_scope="apex:bank:accounts:read apex:bank:accounts:transactions:read",
        # Transitive: resolving an account id costs the account permissions too.
        permissions=frozenset({"ReadTransactionsDetail", "ReadAccountsDetail", "ReadBalances"}),
    ),
    GET_PAYEES: ToolRequirement(
        mcp_scope="apex:mcp-payees:read",
        bank_scope="apex:bank:payees:read",
        # No consent: a payee list is who the customer has chosen to pay
        # before. It exposes no balance and no history, and needing approval
        # to resolve "pay Dana" would put a consent form in front of a payment
        # that already carries its own authorisation.
        permissions=frozenset(),
    ),
    MAKE_PAYMENT: ToolRequirement(
        mcp_scope="apex:mcp-payments:write",
        bank_scope="apex:bank:payments:write",
        # Payments carry their own per-transaction consent, not these.
        permissions=frozenset(),
    ),
}


def permissions_for(tool: str) -> frozenset[str]:
    req = CATALOG.get(tool)
    return req.permissions if req else frozenset()


def plan_permissions(planned_tools: list[str]) -> frozenset[str]:
    """Permissions a declared plan may pre-authorise.

    A restricted permission is allowed only from the tool that directly
    requires it, and only when the plan names that tool. It is never picked up
    transitively: planning `get_transactions` legitimately implies the account
    permissions needed to resolve an account id, but planning `get_accounts`
    must never imply transaction history.

    A blanket ban was the first attempt and bought nothing real. The plan
    cannot reach anything the agent could not obtain simply by calling the
    tool, and either way the permission appears on the form the user approves
    -- so banning it only forced a second prompt for a request the user had
    already made in one sentence. What genuinely needs stopping is a plan
    quietly widening its own reach through transitivity, which is what this
    does stop. The real backstops remain the user-facing form, and
    clamp_to_token_scopes, which the agent cannot talk its way past.
    """
    union: set[str] = set()
    for tool in planned_tools:
        direct = CATALOG[tool].permissions if tool in CATALOG else frozenset()
        for permission in direct:
            if permission in RESTRICTED_PERMISSIONS and tool not in planned_tools:
                continue
            union.add(permission)
    # Strip restricted permissions that arrived only by transitive expansion:
    # keep one only if some named tool directly requires it.
    directly_required: set[str] = set()
    for tool in planned_tools:
        req = CATALOG.get(tool)
        if req is not None:
            directly_required |= {p for p in req.permissions if p in RESTRICTED_PERMISSIONS}
    return frozenset((union - RESTRICTED_PERMISSIONS) | directly_required)


def clamp_to_token_scopes(permissions: frozenset[str], token_scopes: list[str]) -> frozenset[str]:
    """Drop permissions whose tool the caller's token cannot invoke anyway.

    The ceiling is the IdP-issued scope set on the inbound token, which the
    agent cannot inflate -- so this is enforced by a signature rather than by
    configuration the agent could talk its way past.
    """
    allowed: set[str] = set()
    for req in CATALOG.values():
        if not req.mcp_scope or req.mcp_scope in token_scopes:
            allowed |= req.permissions
    return frozenset(permissions & allowed)
