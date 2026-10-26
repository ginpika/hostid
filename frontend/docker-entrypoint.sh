#!/bin/sh

set -eu

: "${CF_TURNSTILE_SITE_KEY:=}"
export CF_TURNSTILE_SITE_KEY

case "$CF_TURNSTILE_SITE_KEY" in
  *[!a-zA-Z0-9_-]*)
    echo "[HostID] Invalid Turnstile site key" >&2
    exit 1
    ;;
esac

echo "[HostID] Frontend container starting..."

if [ -n "$CF_TURNSTILE_SITE_KEY" ]; then
  echo "[HostID] Cloudflare Turnstile initialized"
else
  echo "[HostID] Cloudflare Turnstile is disabled (no site key configured)"
fi

# Pass the literal variable name so envsubst only replaces this public setting.
# shellcheck disable=SC2016
envsubst '${CF_TURNSTILE_SITE_KEY}' \
  < /etc/hostid/config.js.template \
  > /usr/share/nginx/html/config.js

echo "[HostID] Starting nginx..."

exec "$@"
