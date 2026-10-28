"""Verifies a customer's bearer token, for the endpoints that must not take the
customer's identity on trust.

`/chat` does not use this: it treats the caller's token as opaque, forwards it
as the subject of a delegated exchange, and every authorization decision past
that point is made by the MCP server against a token ThunderID signed. A forged
token there buys nothing, because the exchange would reject it.

Passkey enrolment is different. It writes a new authentication factor onto an
account, and the account it writes to comes from the token. If that were taken
on trust, anyone who could reach this service could enrol their own passkey
against another customer's username and then authenticate as them -- including
approving that customer's payments. So this endpoint verifies the signature,
the issuer and the audience before believing the `username` claim.
"""

from __future__ import annotations

import logging

import anyio
import jwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

# Pinned, never read off the token's own header (alg-confusion defence).
_ALGORITHMS = ["RS256"]


class TokenVerificationError(Exception):
    """Raised when a presented bearer token cannot be trusted."""


class CustomerTokenVerifier:
    """Verifies customer tokens against ThunderID's JWKS.

    `PyJWKClient` caches keys by `kid` and only refetches on a miss, so one
    instance per process costs nothing until the first request arrives.
    """

    def __init__(self, *, jwks_uri: str, issuer: str, audience: str) -> None:
        self._jwks = PyJWKClient(jwks_uri, cache_keys=True)
        self._issuer = issuer
        self._audience = audience

    async def verify_id_token(self, token: str, *, client_id: str) -> dict:
        """Verify an ID token, whose audience is the CLIENT rather than an API.

        Used only to read `auth_time` -- when the customer last actually
        authenticated. The access token does not carry it, and that claim is
        the whole proof that a re-login just happened.
        """
        try:
            return await anyio.to_thread.run_sync(lambda: self._decode(token, audience=client_id))
        except jwt.PyJWTError as exc:
            logger.warning("Rejected id_token: %s", exc)
            raise TokenVerificationError(str(exc)) from exc

    async def verify(self, token: str) -> dict:
        try:
            # PyJWKClient does blocking I/O and the signature check itself;
            # keep both off the event loop.
            return await anyio.to_thread.run_sync(self._decode, token)
        except jwt.PyJWTError as exc:
            logger.warning("Rejected bearer token: %s", exc)
            raise TokenVerificationError(str(exc)) from exc

    def _decode(self, token: str, *, audience: str | None = None) -> dict:
        key = self._jwks.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            key.key,
            algorithms=_ALGORITHMS,
            issuer=self._issuer,
            audience=audience or self._audience,
            options={"require": ["exp", "sub"]},
        )
