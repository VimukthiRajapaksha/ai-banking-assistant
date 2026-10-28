"""The get_transactions tool: consent-gated read of one account's history.

Rides the same account-information consent as get_accounts -- transactions are
a permission within it, not a separate consent -- so a user who has already
approved account access is not asked again.
"""

from __future__ import annotations

import logging
from typing import Annotated

from mcp.server.mcpserver import Context, MCPServer
from mcp.types import InputRequiredResult, ToolAnnotations
from pydantic import Field

from ai_banking_mcp_server.outbound.client import BankApiError
from ai_banking_mcp_server.outbound.actor_chain import ActorChain
from ai_banking_mcp_server.outbound.consent import ConsentClient
from ai_banking_mcp_server.outbound.transactions import fetch_transactions
from ai_banking_mcp_server.settings import Settings
from ai_banking_mcp_server.state import (
    BankTokenCache,
    SessionLocks,
)
from ai_banking_mcp_server.tools import consent_gate, messages
from ai_banking_mcp_server.tools.catalog import GET_TRANSACTIONS

logger = logging.getLogger(__name__)

MAX_LIMIT = 100


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
        title="Get account transactions",
        annotations=ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True),
    )
    async def get_transactions(
        ctx: Context,
        account_id: Annotated[str, Field(
            description=(
                'The `id` of the account, exactly as returned by get_accounts, for example "acc-sav-8842". '
                "An account's name or type is not accepted."
            ),
        )],
        limit: Annotated[int, Field(
            description=(
                f"The maximum number of transactions to return, newest first. Defaults to 10; values outside "
                f"1 to {MAX_LIMIT} are clamped to that range."
            ),
        )] = 10,
    ) -> list[dict] | str | InputRequiredResult:
        """Return transactions on one of the customer's accounts, newest first.

        Reads a single account per call, so covering several accounts takes
        one call each. Returns a list with one object per transaction: `id`,
        `accountId`, `accountName`, `accountNumber`, `date` (YYYY-MM-DD),
        `description` (the merchant or counterparty), `category`, `amount`
        (negative for money out, positive for money in) and `currency`. An empty list means the
        account has no transactions. There is no filtering by date, merchant,
        category or amount; request enough rows with `limit` and filter the
        result.

        Read-only and safe to repeat. Transaction history is a separate
        permission from balances, so the customer may first be asked to
        approve access; that happens outside this conversation.
        """
        if not account_id:
            return (
                "account_id was empty, so nothing was read. Call get_accounts, pick the account the "
                "customer means, and pass its `id`."
            )
        limit = max(1, min(limit, MAX_LIMIT))

        gate = await consent_gate.clear(
            ctx, GET_TRANSACTIONS, settings=settings, consent_client=consent_client,
            token_cache=token_cache, locks=locks, actor_chain=actor_chain,
        )
        if not isinstance(gate, consent_gate.Gate):
            return gate

        try:
            transactions = await fetch_transactions(
                base_url=str(settings.outbound.api.base_url),
                verify_tls=settings.outbound.api.verify_tls,
                account_id=account_id,
                limit=limit,
                bank_token=gate.bank_token,
            )
        except BankApiError as exc:
            logger.warning("Transactions call failed: %s", exc)
            token_cache.invalidate(gate.session_key)
            return messages.bank_api_failure("transactions", exc, by_account_id=True)
        logger.info("Fetched %d transaction(s) for account", len(transactions))
        return transactions
