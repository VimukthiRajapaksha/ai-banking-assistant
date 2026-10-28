"""Env-var config for the AI banking agent, namespaced AGENT_<GROUP>__<FIELD>.

Two IdP-facing OAuth relationships, both against the SAME WSO2 tenant/app here
(unlike the MCP server's inbound/outbound split, which may be different IdPs):

  1. Agent self-authentication ("Agent Acting on Its Own"): this agent proves
     its own identity (agent_id/agent_secret) to get an `actor_token`. No end
     user, fully deterministic, no browser.
  2. On-behalf-of-user delegation: an RFC 8693 token exchange presenting the
     caller's token as the subject and this agent's `actor_token` as the actor,
     yielding a delegated JWT (`sub`=user, `act.sub`=agent). Non-interactive --
     no browser redirect, no consent prompt.

See identity/ for the flows themselves. See .env.example for the full var list.
"""

from __future__ import annotations

import os
from functools import lru_cache

import httpx
from opentelemetry.instrumentation.utils import suppress_http_instrumentation
from pydantic import AnyHttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILES = {
    "development": ".env",
    "staging": ".env.staging",
    "production": ".env.production",
}


def _active_env_file() -> str:
    """Local-dev convenience only: .env is used unless AGENT_ENV picks another
    profile. Staging/production are expected to get real env vars from
    whatever deploys them -- the file is just a fallback if one exists."""
    env = os.getenv("AGENT_ENV", "development")
    try:
        return _ENV_FILES[env]
    except KeyError:
        raise RuntimeError(f"Unknown AGENT_ENV={env!r}, expected one of {sorted(_ENV_FILES)}") from None


_ENV_FILE = _active_env_file()


@lru_cache(maxsize=None)
def _discover(discovery_url: str) -> dict:
    """Fetch and cache an OIDC/OAuth-AS discovery document."""
    # Not traced: it runs once per process, outside any conversation, so it
    # became a one-span trace of its own -- one AMP's monitors scored as an
    # agent run with no name ("Unknown" in the score breakdown).
    with suppress_http_instrumentation():
        response = httpx.get(discovery_url, timeout=10.0, follow_redirects=True)
    response.raise_for_status()
    return response.json()


class IdentitySettings(BaseSettings):
    """This agent's own OAuth application + WSO2 Agent Identity credentials.

    The agent identity is an OAuth client in its own right, so it needs no
    native-authentication endpoint: `agent_id`/`agent_secret` are client
    credentials, not a directory username and password.
    """

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="AGENT_IDENTITY__", extra="ignore")

    discovery_url: AnyHttpUrl

    # OAuth application ("clientID"/"clientSecret" in WSO2 terms); used as
    # Basic auth on every /authorize, /authn and /token call.
    client_id: str
    client_secret: SecretStr

    # The agent's own principal -- what appears as act.sub on a delegated
    # token. Client credentials, used directly on the token endpoint.
    agent_id: str
    agent_secret: SecretStr

    # Resource indicator for the agent's own actor_token. Omitting it yields a
    # token scoped to the server default with none of these scopes.
    self_resource: str = "urn:apex"

    # Scopes on this agent's own actor_token. A delegated exchange is bounded
    # by BOTH the subject's and the actor's grants, so this must cover whatever
    # the agent will act on the user's behalf for.
    self_scope: str = "openid"

    @property
    def authorize_endpoint(self) -> str:
        return _discover(str(self.discovery_url))["authorization_endpoint"]

    @property
    def token_endpoint(self) -> str:
        return _discover(str(self.discovery_url))["token_endpoint"]

    @property
    def issuer(self) -> str:
        return _discover(str(self.discovery_url))["issuer"]

    @property
    def jwks_uri(self) -> str:
        return _discover(str(self.discovery_url))["jwks_uri"]

    @property
    def base_url(self) -> str:
        """ThunderID's root, for the endpoints that are not in discovery --
        `/flow/execute` among them."""
        return str(self.discovery_url).split("/.well-known/")[0]


class SecuritySettings(BaseSettings):
    """Passkey enrolment, relayed for the customer. See security.py."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="AGENT_SECURITY__", extra="ignore")

    #: The application that OWNS the enrolment flow. ThunderID addresses a flow
    #: by application, and this one holds `apex-passkey-enrol`.
    application_id: str = "apex-security-client"

    #: Server credential that starts the flow directly. Anything holding it can
    #: begin an authentication ceremony for any customer, so it stays here and
    #: never reaches the browser.
    flow_secret: SecretStr

    #: What an inbound customer token must carry to be believed. Enrolment
    #: writes a new authentication factor onto the account this names, so
    #: unlike /chat it is verified rather than forwarded.
    audience: str = "urn:apex"

    #: The portal's OAuth client. An ID token's audience is the client it was
    #: issued to, not an API, so this is what the freshness check verifies
    #: against.
    portal_client_id: str = "apex-portal-client"

    #: How recently the customer must have authenticated to add a passkey.
    #: Long enough to cover a sign-in plus the redirect back and a moment's
    #: hesitation; short enough that a session left open is not a licence to
    #: add an authentication factor to the account hours later.
    max_auth_age_seconds: int = 300


class McpSettings(BaseSettings):
    """The MCP server this agent connects to as a client."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="AGENT_MCP__", extra="ignore")

    server_url: AnyHttpUrl

    # API resource identifier of the MCP server -- the `audience` of the
    # delegated token. Must be registered as an allowed audience on this
    # agent's OAuth application or the exchange returns `invalid_target`.
    audience: str

    # Scopes requested on the delegated token. A delegated exchange can only
    # narrow, never widen, so these must already be present on the caller's
    # token or they are silently dropped.
    scopes: str = "openid"


class LlmSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="AGENT_LLM__", extra="ignore")

    anthropic_api_key: SecretStr
    model: str = "claude-haiku-4-5-20251001"
    #: Where the Anthropic-shaped API lives. Unset means api.anthropic.com.
    #: Set it to put a gateway in front of the model -- an APIM proxy that
    #: meters and audits model calls, or a compatible endpoint elsewhere.
    #: The key above is then whatever that endpoint authenticates with.
    base_url: str | None = None
    #: Header the endpoint reads that key from, when it is not Anthropic's own
    #: x-api-key. AMP's per-agent LLM proxy uses "API-Key". Unset sends the key
    #: as x-api-key only.
    api_key_header: str | None = None


class FrontendSettings(BaseSettings):
    """The browser origin allowed to call /chat. Only used to bound CORS --
    there is no post-consent redirect on this leg any more."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="AGENT_FRONTEND__", extra="ignore")

    origin: AnyHttpUrl = "http://localhost:3000"  # type: ignore[assignment]


class RuntimeSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="AGENT_", extra="ignore")

    env: str = "development"
    host: str = "0.0.0.0"
    port: int = 8010


class Settings:
    def __init__(self) -> None:
        self.identity = IdentitySettings()  # type: ignore[call-arg]
        self.mcp = McpSettings()  # type: ignore[call-arg]
        self.security = SecuritySettings()  # type: ignore[call-arg]
        self.llm = LlmSettings()  # type: ignore[call-arg]
        self.frontend = FrontendSettings()  # type: ignore[call-arg]
        self.runtime = RuntimeSettings()


@lru_cache
def get_settings() -> Settings:
    return Settings()
