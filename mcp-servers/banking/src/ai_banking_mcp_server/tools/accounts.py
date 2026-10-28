"""The get_accounts tool: consent-gated read of the user's accounts."""

from __future__ import annotations

import logging

from mcp.server.mcpserver import Context, MCPServer
from mcp.types import InputRequiredResult, ToolAnnotations

from ai_banking_mcp_server.outbound.accounts import fetch_accounts
from ai_banking_mcp_server.outbound.actor_chain import ActorChain
from ai_banking_mcp_server.outbound.client import BankApiError
from ai_banking_mcp_server.outbound.consent import ConsentClient
from ai_banking_mcp_server.settings import Settings
from ai_banking_mcp_server.state import (
    BankTokenCache,
    SessionLocks,
)
from ai_banking_mcp_server.tools import consent_gate, messages
from ai_banking_mcp_server.tools.catalog import GET_ACCOUNTS

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
        title="Get bank accounts",
        annotations=ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True),
    )
    async def get_accounts(ctx: Context) -> list[dict] | str | InputRequiredResult:
        """Return every bank account the signed-in customer holds, with its current balance.

        Returns a list with one object per account: `id` (the account's
        identifier, which get_transactions takes as `account_id`),
        `accountNumber` (the number the customer knows the account by), `name`,
        `type` (for example CURRENT or SAVINGS), `currency` (an ISO 4217 code)
        and `balance` (a number in that currency). This is the only source of
        account ids. It does not return transactions or payees.

        Read-only and safe to repeat. Takes no arguments. The customer may
        first be asked to approve account access; that happens outside this
        conversation, and later calls in the session reuse the approval.
        """
        gate = await consent_gate.clear(
            ctx, GET_ACCOUNTS, settings=settings, consent_client=consent_client,
            token_cache=token_cache, locks=locks, actor_chain=actor_chain,
        )
        if not isinstance(gate, consent_gate.Gate):
            return gate

        try:
            accounts = await fetch_accounts(
                base_url=str(settings.outbound.api.base_url),
                verify_tls=settings.outbound.api.verify_tls, bank_token=gate.bank_token
            )
        except BankApiError as exc:
            logger.warning("Accounts call failed: %s", exc)
            token_cache.invalidate(gate.session_key)
            return messages.bank_api_failure("accounts", exc)
        logger.info("Fetched %d account(s)", len(accounts))
        return accounts
