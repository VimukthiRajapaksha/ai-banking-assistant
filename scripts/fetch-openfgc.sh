#!/usr/bin/env bash
# Fetches WSO2 OpenFGC (https://github.com/wso2/openfgc) into
# deploy/local/external/openfgc and applies the Apex changes to its portal.
#
# Pinned to a commit of the unreleased feature/portal branch: the consent portal
# and its BFF only exist there, and the patch is made against this commit.
#
# Idempotent: an existing checkout at the pinned commit is left as it is.
set -euo pipefail

REPO="${OPENFGC_REPO:-https://github.com/wso2/openfgc.git}"
COMMIT="a5556a58e4866178e672d2092bcc7608f5221f4f"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${ROOT}/deploy/local/external/openfgc"
PATCH="${ROOT}/deploy/local/consent/openfgc-portal.patch"

say() { printf '==> %s\n' "$*"; }
die() { printf '!! %s\n' "$*" >&2; exit 1; }

fresh=0
if [ ! -d "${DEST}/.git" ]; then
  say "cloning ${REPO}"
  mkdir -p "$(dirname "$DEST")"
  git clone --quiet --filter=blob:none --no-checkout "$REPO" "$DEST"
  fresh=1
fi

head="$(git -C "$DEST" rev-parse HEAD 2>/dev/null || true)"
if [ "$head" != "$COMMIT" ]; then
  # A --no-checkout clone reports every file as deleted; that is not a change.
  [ "$fresh" = 1 ] || [ -z "$(git -C "$DEST" status --porcelain 2>/dev/null)" ] ||
    die "${DEST} has local changes and is not at ${COMMIT}; move it aside and re-run"
  say "checking out ${COMMIT:0:7}"
  git -C "$DEST" fetch --quiet origin "$COMMIT" 2>/dev/null || git -C "$DEST" fetch --quiet origin
  git -C "$DEST" checkout --quiet --detach "$COMMIT"
fi

if git -C "$DEST" apply --reverse --check "$PATCH" 2>/dev/null; then
  say "Apex portal patch already applied"
else
  git -C "$DEST" apply --check "$PATCH" || die "the portal patch does not apply to ${DEST}"
  git -C "$DEST" apply "$PATCH"
  say "applied the Apex portal patch"
fi

say "OpenFGC ready at ${DEST}"
