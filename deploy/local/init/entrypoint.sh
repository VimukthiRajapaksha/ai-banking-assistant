#!/usr/bin/env bash
# curl implements RFC 6761 itself: any host ending in .localhost resolves to
# loopback and /etc/hosts is ignored. So `extra_hosts` in compose, which is how
# a container reaches ThunderID and the AMP gateway running outside this
# network, has no effect on curl -- every request fails to connect with no
# diagnostic beyond exit code 7.
#
# --connect-to keeps the Host header (which the k3d gateway routes on) while
# dialling the mapped address. Emitting it into .curlrc applies it to every
# curl in every provisioning script without each one having to know.
set -euo pipefail

CURLRC="${HOME:-/root}/.curlrc"
: > "$CURLRC"

while read -r addr host _; do
  case "$host" in
    *.localhost)
      for port in 8080 19080 9000; do
        printf 'connect-to = "%s:%s:%s:%s"\n' "$host" "$port" "$addr" "$port" >> "$CURLRC"
      done
      ;;
  esac
done < /etc/hosts

[ -s "$CURLRC" ] && echo "==> curl .localhost overrides: $(grep -c connect-to "$CURLRC") entries"

exec /bin/bash "$@"
