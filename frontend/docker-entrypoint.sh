#!/bin/sh

set -eu

# Runtime configuration (e.g. the Turnstile site key) is managed in the admin
# Settings page and served by the backend at /config.js; nginx proxies it.
echo "[HostID] Frontend container starting..."

exec "$@"
