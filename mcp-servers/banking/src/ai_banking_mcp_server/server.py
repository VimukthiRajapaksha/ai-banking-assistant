import logging

from mcp.server import MCPServer
from mcp.server.auth.settings import AuthSettings
from mcp.server.request_state import RequestStateSecurity

from ai_banking_mcp_server.inbound.token_verifier import JWKSBearerTokenVerifier
from ai_banking_mcp_server.outbound.actor_chain import ActorChain
from ai_banking_mcp_server.outbound.consent import ConsentClient
from ai_banking_mcp_server.settings import Settings
from ai_banking_mcp_server.state import (
    BankTokenCache,
    SessionLocks,
)
from ai_banking_mcp_server.telemetry import ToolIOMiddleware
from ai_banking_mcp_server.tools.accounts import register as register_accounts
from ai_banking_mcp_server.tools.payees import register as register_payees
from ai_banking_mcp_server.tools.payments import register as register_payments
from ai_banking_mcp_server.tools.transactions import register as register_transactions

logger = logging.getLogger(__name__)


def build(settings: Settings) -> MCPServer:
    auth_settings = AuthSettings(
        issuer_url=settings.inbound.issuer_url,
        resource_server_url=settings.inbound.resource_server_url,
        required_scopes=settings.inbound.required_scopes_list or None,
        # Audiences are API resource identifiers now, so RFC 8707
        # resource validation can be enforced rather than skipped.
        validate_token_resource=True,
    )

    # Without configured keys the SDK seals requestState under a per-process
    # key: pending consents would not survive a restart, and one replica could
    # not read another's. Warned about rather than defaulted silently, because
    # both failures look like "the customer's approval vanished".
    keys = settings.request_state.key_list
    if keys:
        request_state = RequestStateSecurity(keys=keys, ttl=settings.request_state.ttl_seconds)
    else:
        logger.warning(
            "MCP_REQUEST_STATE__KEYS is unset: sealing requestState with a per-process key. "
            "Pending consents will not survive a restart and cannot be shared across replicas."
        )
        request_state = RequestStateSecurity.ephemeral(ttl=settings.request_state.ttl_seconds)

    mcp: MCPServer = MCPServer(
        name="AI banking MCP server",
        auth=auth_settings,
        token_verifier=JWKSBearerTokenVerifier(settings.inbound),
        request_state_security=request_state,
        # Inside the SDK's own OpenTelemetry middleware, so it decorates that
        # span rather than opening another.
        middleware=[ToolIOMiddleware()],
    )

    token_cache = BankTokenCache()
    locks = SessionLocks()
    # Mints this server's "acting for the agent" token, which is what puts the
    # agent into the bank-facing act chain. Process-scoped: the token says
    # nothing about any one customer.
    actor_chain = ActorChain(
        token_endpoint=settings.outbound.oauth.token_endpoint,
        client_id=settings.outbound.oauth.client_id,
        client_secret=settings.outbound.oauth.client_secret.get_secret_value(),
        resource=settings.outbound.oauth.audience,
    )
    consent_client = ConsentClient(
        base_url=str(settings.outbound.consent.base_url),
        org_id=settings.outbound.consent.org_id,
        group_id=settings.outbound.consent.group_id,
    )

    for register_tool in (register_accounts, register_transactions, register_payees, register_payments):
        register_tool(
            mcp,
            settings=settings,
            consent_client=consent_client,
            token_cache=token_cache,
            locks=locks,
            actor_chain=actor_chain,
        )

    return mcp
