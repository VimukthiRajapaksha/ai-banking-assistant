"""Verifies bearer JWTs an agent presents to this MCP server."""

from __future__ import annotations

import logging

import anyio
import jwt
from jwt import PyJWKClient
from mcp.server.auth.provider import AccessToken

from ai_banking_mcp_server.settings import InboundOAuthSettings

logger = logging.getLogger(__name__)

# Pinned explicitly -- never read off the token's own `alg` header (alg-confusion defense).
_ALGORITHMS = ["RS256"]


class JWKSBearerTokenVerifier:
    """Verifies bearer JWTs against the IdP's JWKS (resolved via discovery).

    `PyJWKClient` caches keys by `kid` and only refetches the JWKS on a
    cache miss, so instantiating this once per process (see server.py) is
    cheap and does not hit the network until the first request arrives.
    """

    def __init__(self, settings: InboundOAuthSettings) -> None:
        self._settings = settings
        self._jwk_client = PyJWKClient(settings.jwks_uri, cache_keys=True)

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            # PyJWKClient does blocking I/O (JWKS fetch on a cache miss, plus
            # the signature check itself); keep it off the event loop.
            claims = await anyio.to_thread.run_sync(self._decode, token)
        except jwt.PyJWTError as exc:
            logger.warning("Rejected bearer token: %s", exc)
            return None

        subject = claims.get("sub")
        # RFC 8707: the resource this token was minted for. ThunderID expresses
        # it as `aud` rather than a separate `resource` claim, so map it across
        # -- without this the SDK's validate_token_resource check sees None and
        # rejects every request.
        #
        # What is reported is this server's own resource_server_url, not the
        # audience URN, because that check compares against exactly that URL
        # (RFC 9728 canonical form) -- reporting `urn:apex` fails it with
        # "resource 'urn:apex' is not resource_server_url". Nothing is skipped
        # by doing so: _decode has already rejected any token whose `aud` does
        # not include our configured audience, so reaching this line IS the
        # audience check passing. `aud` may be a list; look for ours in it.
        audience = claims.get("aud")
        audiences = audience if isinstance(audience, list) else [audience]
        resource = (
            str(self._settings.resource_server_url)
            if self._settings.audience in audiences
            else None
        )
        scopes = str(claims.get("scope", "")).split()
        # RFC 8693 delegation: the acting agent, when this token came from a
        # token exchange rather than a plain M2M grant.
        actor = (claims.get("act") or {}).get("sub")
        client_id = str(claims.get("azp") or actor or claims.get("client_id") or claims.get("aud") or "")
        logger.debug(
            "Verified bearer token: subject=%s actor=%s client_id=%s resource=%s scopes=%s",
            subject,
            actor,
            client_id,
            resource,
            scopes,
        )

        return AccessToken(
            token=token,
            client_id=client_id,
            scopes=scopes,
            expires_at=int(claims["exp"]),
            subject=subject,
            resource=resource,
            claims=claims,
        )

    def _decode(self, token: str) -> dict:
        signing_key = self._jwk_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=_ALGORITHMS,
            issuer=self._settings.issuer_url,
            audience=self._settings.audience,
            options={"require": ["exp", "sub"]},
        )
