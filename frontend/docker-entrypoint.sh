#!/bin/sh

echo "[HostID] Frontend container starting..."

if [ -n "$CF_TURNSTILE_SITE_KEY" ]; then
  echo "[HostID] Cloudflare Turnstile initialized"
  echo "[HostID] CF_TURNSTILE_SITE_KEY: $CF_TURNSTILE_SITE_KEY"
else
  echo "[HostID] Cloudflare Turnstile is disabled (no site key configured)"
fi

envsubst < /usr/share/nginx/html/config.js > /usr/share/nginx/html/config.js.tmp
mv /usr/share/nginx/html/config.js.tmp /usr/share/nginx/html/config.js

echo "[HostID] Starting nginx..."

exec nginx -g "daemon off;"
