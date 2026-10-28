"""Env-var config, namespaced MCP_<DIRECTION>_OAUTH[__<PROVIDER>]__<FIELD>.
See .env.example for the full list of variables."""

from __future__ import annotations

import os
from functools import cache, lru_cache

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
    """Local-dev convenience only: .env is used unless MCP_ENV picks another
    profile. Staging/production are expected to get real env vars from
    whatever deploys them -- the file is just a fallback if one exists."""
    env = os.getenv("MCP_ENV", "development")
    try:
        return _ENV_FILES[env]
    except KeyError:
        raise RuntimeError(f"Unknown MCP_ENV={env!r}, expected one of {sorted(_ENV_FILES)}") from None


_ENV_FILE = _active_env_file()


@cache
def _discover(discovery_url: str) -> dict:
    """Fetch and cache an OIDC/OAuth-AS discovery document."""
    # Not traced: it runs once per process, outside any conversation, so it
    # became a one-span trace of its own -- one AMP's monitors scored as an
    # agent run with no name ("Unknown" in the score breakdown).
    with suppress_http_instrumentation():
        response = httpx.get(discovery_url, timeout=10.0, follow_redirects=True)
    response.raise_for_status()
    return response.json()


class InboundOAuthSettings(BaseSettings):
    """Verifies bearer tokens an agent presents to this server."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="MCP_INBOUND_OAUTH__", extra="ignore")

    discovery_url: AnyHttpUrl
    audience: str
    required_scopes: str = ""
    resource_server_url: AnyHttpUrl

    @property
    def required_scopes_list(self) -> list[str]:
        return [s.strip() for s in self.required_scopes.split(",") if s.strip()]

    @property
    def issuer_url(self) -> str:
        return _discover(str(self.discovery_url))["issuer"]

    @property
    def jwks_uri(self) -> str:
        return _discover(str(self.discovery_url))["jwks_uri"]


class OutboundOAuthSettings(BaseSettings):
    """This server's OAuth client for reaching the bank's APIs."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="MCP_OUTBOUND_OAUTH__", extra="ignore")

    discovery_url: AnyHttpUrl
    client_id: str
    client_secret: SecretStr
    redirect_uri: AnyHttpUrl
    scope: str

    # API resource identifier of the bank -- the `audience` of the exchanged
    # token. Must be registered as an allowed audience on this server's OAuth
    # application, or the exchange returns `invalid_target`.
    audience: str

    @property
    def authorize_endpoint(self) -> str:
        return _discover(str(self.discovery_url))["authorization_endpoint"]

    @property
    def token_endpoint(self) -> str:
        return _discover(str(self.discovery_url))["token_endpoint"]


class StepUpSettings(BaseSettings):
    """The payment step-up ceremony this server drives against ThunderID."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="MCP_STEPUP__", extra="ignore")

    #: ThunderID's root. The flow endpoint is a path beneath it.
    base_url: AnyHttpUrl

    #: The application that OWNS the step-up flow. ThunderID addresses a flow by
    #: application and an application holds one flow per type, so this is what
    #: selects `apex-payment-stepup`.
    application_id: str = "apex-mcp-client"

    #: Server credential that lets this service start the flow directly. Never
    #: goes to a browser: anything holding it can begin an authentication
    #: ceremony for any customer.
    flow_secret: SecretStr

    #: Require a passkey, refusing the password fallback. Off here because a
    #: customer with no passkey enrolled would otherwise be unable to pay at
    #: all; turn it on once enrolment is part of onboarding.
    require_passkey: bool = False


class OutboundApiSettings(BaseSettings):
    """The bank's resource API endpoints, called with the exchanged token."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="MCP_OUTBOUND_API__", extra="ignore")

    #: Root of the bank's API. Every resource is a path beneath it, so there is
    #: one value to change and no way for two of them to point at different
    #: hosts. This is the APIM gateway, not the backend: the gateway is what
    #: validates the token and enforces the per-operation scope, so calling the
    #: backend directly would skip the only place that check happens.
    base_url: AnyHttpUrl

    #: Whether to verify the gateway's TLS certificate. The local APIM ships a
    #: self-signed certificate, so this is false for the local stack and must be
    #: true anywhere else -- an unverified gateway connection can be
    #: intercepted, and every bank token travels over it.
    verify_tls: bool = True


class ConsentSettings(BaseSettings):
    """The consent service (OpenFGC) this server records authorization against."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="MCP_CONSENT__", extra="ignore")

    base_url: AnyHttpUrl
    org_id: str
    group_id: str
    #: Purpose grouping the account-information permissions.
    account_access_purpose_id: str
    account_access_purpose_name: str = "account_information_access"
    #: Namespace the consent elements were registered under. The service
    #: resolves unqualified element names to "default" and rejects them.
    element_namespace: str = "banking"
    payment_purpose_id: str = ""
    payment_purpose_name: str = "payment_initiation"
    #: A payment authorization is meant to be answered now, not held open.
    payment_validity_seconds: int = 600
    #: How long an account-information consent stays valid. Kept short for an
    #: agent: an agent acts in bursts, so a long-lived standing grant is a
    #: larger risk than it is for a human-facing application.
    validity_seconds: int = 3600


class OutboundSettings:
    def __init__(self) -> None:
        self.oauth = OutboundOAuthSettings()  # type: ignore[call-arg]
        self.api = OutboundApiSettings()  # type: ignore[call-arg]
        self.consent = ConsentSettings()  # type: ignore[call-arg]


class RequestStateSettings(BaseSettings):
    """Protection for the `requestState` the server hands clients between
    elicitation rounds.

    The SDK seals this value (AES-256-GCM) and binds it to the tool, its
    arguments and the caller's identity, so it is where a pending consent id
    can safely live. Its default key is generated per process, which means
    pending consents die on restart and one replica cannot read another's --
    set `keys` to a shared secret to fix both.

    `keys[0]` seals, every key unseals, so rotation is three fully rolled-out
    phases: [old, new], then [new, old], then [new] after one TTL.
    """

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="MCP_REQUEST_STATE__", extra="ignore")

    #: Comma-separated. Each needs >= 32 bytes of randomness:
    #: python -c "import secrets; print(secrets.token_hex(32))"
    keys: str = ""
    #: Must outlast how long a customer may take to answer a consent form.
    ttl_seconds: float = 3600.0

    @property
    def key_list(self) -> list[str]:
        return [k.strip() for k in self.keys.split(",") if k.strip()]


class RuntimeSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_prefix="MCP_", extra="ignore")

    env: str = "development"
    host: str = "0.0.0.0"
    port: int = 18010
    #: Host headers this server answers to, for the SDK's DNS-rebinding
    #: protection. It has to list every name a caller legitimately reaches us
    #: by: in Compose the agent dials the service name, so `localhost` alone
    #: answers 421 "Invalid Host header" on every tool call.
    #:
    #: Left ON deliberately rather than passing the real bind address and
    #: letting the SDK switch it off -- 0.0.0.0 disables the check entirely,
    #: and an allow-list we maintain is worth more than one we lose by
    #: accident. Comma-separated; `*` is allowed as a port wildcard.
    allowed_hosts: list[str] = ["localhost:*", "127.0.0.1:*", "[::1]:*"]


class Settings:
    def __init__(self) -> None:
        self.inbound = InboundOAuthSettings()  # type: ignore[call-arg]
        self.outbound = OutboundSettings()
        self.stepup = StepUpSettings()  # type: ignore[call-arg]
        self.request_state = RequestStateSettings()  # type: ignore[call-arg]
        self.runtime = RuntimeSettings()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
