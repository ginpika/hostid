#!/bin/sh
# Disposable containers only: deployment containers and volumes are untouched.
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
image=${1:-hostid-full:smoke}
platform=${2:-linux/amd64}
name="hostid-smoke-full-$(date +%s)-$$"
empty="$name-empty"

cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ]; then
    docker logs "$name" 2>&1 | sed 's/password: .*/password: [redacted]/' || true
    docker logs "$empty" 2>&1 | sed 's/password: .*/password: [redacted]/' || true
  fi
  docker rm -f "$name" "$empty" >/dev/null 2>&1 || true
  docker volume rm "$name-data" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_healthy() {
  container=$1
  attempt=0
  while [ "$attempt" -lt 90 ]; do
    state=$(docker inspect --format '{{.State.Status}}/{{.State.Health.Status}}' "$container")
    case "$state" in
      running/healthy) return 0 ;;
      exited/*|dead/*|*/unhealthy) echo "$container: $state" >&2; return 1 ;;
    esac
    attempt=$((attempt + 1))
    sleep 2
  done
  echo "Timed out waiting for $container" >&2
  return 1
}

docker volume create "$name-data" >/dev/null
docker run -d --platform "$platform" --name "$name" --init \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=volume,source=$name-data,target=/app/data" \
  -e JWT_SECRET=container-smoke-test-only-do-not-use-in-production \
  -e MAIL_DOMAIN=smoke.invalid \
  -e CF_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
  "$image" >/dev/null
wait_healthy "$name"
docker exec -i -e SMOKE_BASE_URL=http://127.0.0.1:3000 -e SMOKE_FULL=true \
  -e SMOKE_RESTART=false "$name" node --input-type=module < "$script_dir/smoke-checks.mjs"

docker restart "$name" >/dev/null
wait_healthy "$name"
docker exec -i -e SMOKE_BASE_URL=http://127.0.0.1:3000 -e SMOKE_FULL=true \
  -e SMOKE_RESTART=true "$name" node --input-type=module < "$script_dir/smoke-checks.mjs"

# An independent instance verifies the default empty runtime configuration.
docker run -d --platform "$platform" --name "$empty" --init \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e JWT_SECRET=container-smoke-test-only-do-not-use-in-production \
  -e MAIL_DOMAIN=smoke.invalid \
  "$image" >/dev/null
wait_healthy "$empty"
docker exec "$empty" node -e "fetch('http://127.0.0.1:3000/config.js').then(r=>r.text()).then(t=>{if(t !== 'window.__ENV__ = {\"CF_TURNSTILE_SITE_KEY\":\"\"};\\n')process.exit(1)})"
echo "Full image checks passed for $platform."
