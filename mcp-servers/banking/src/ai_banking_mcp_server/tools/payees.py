"""The get_payees tool: the customer's saved beneficiaries.

Read-only and consent-free. A payee list is who the customer has already
chosen to pay; it carries no balance and no history, and requiring approval to
resolve "pay Dana" would put a consent form in front of a payment that already
carries its own authorisation. The token's scope is the whole authorisation.
"""

from __future__ import annotations

import logging

from mcp.server.mcpserver import Context, MCPServer
from mcp.types import InputRequiredResult, ToolAnnotations

from ai_banking_mcp_server.outbound.client import BankApiError
from ai_banking_mcp_server.outbound.actor_chain import ActorChain
from ai_banking_mcp_server.outbound.consent import ConsentClient
from ai_banking_mcp_server.outbound.payees import fetch_payees
from ai_banking_mcp_server.settings import Settings
from ai_banking_mcp_server.state import BankTokenCache, SessionLocks
from ai_banking_mcp_server.tools import consent_gate, messages
from ai_banking_mcp_server.tools.catalog import GET_PAYEES

logger = logging.getLogger(__name__)


def register(
    mcp: MCPServer,
    *,
    settings: Settings,
    consent_client: ConsentClient,
    token_cache: BankTokenCache,
    locks: SessionLocks,
    actor_chain: ActorChain,
) -> None:
    @mcp.tool(
        title="Get saved payees",
        annotations=ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True),
    )
    async def get_payees(ctx: Context) -> list[dict] | str | InputRequiredResult:
        """Return the customer's saved payees: the people and organisations they can pay.

        Returns a list with one object per payee, most recently paid first:
        `id`, `name` (the value make_payment takes as `payee`), `type` (for
        example friend, utility or landlord), `bank`, `accountNumber`,
        `currency` and `lastPaidOn` (YYYY-MM-DD). `accountNumber` may arrive
        as a masked placeholder and is never needed to make a payment. This
        is the only source of valid payee names. It returns no balances and
        no payment history.

        Read-only, safe to repeat, and needs no approval from the customer.
        """
        gate = await consent_gate.clear(
            ctx, GET_PAYEES, settings=settings, consent_client=consent_client,
            token_cache=token_cache, locks=locks, actor_chain=actor_chain,
        )
        if not isinstance(gate, consent_gate.Gate):
            return gate

        try:
            payees = await fetch_payees(
                base_url=str(settings.outbound.api.base_url),
                verify_tls=settings.outbound.api.verify_tls, bank_token=gate.bank_token
            )
        except BankApiError as exc:
            logger.warning("Payees call failed: %s", exc)
            token_cache.invalidate(gate.session_key)
            return messages.bank_api_failure("payees", exc)
        logger.info("Fetched %d payee(s)", len(payees))
        return payees
