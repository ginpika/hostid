#!/bin/sh
# Disposable containers only: deployment containers and volumes are untouched.
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
frontend_image=${1:-hostid-frontend:smoke}
backend_image=${2:-hostid-backend:smoke}
platform=${3:-linux/amd64}
name="hostid-smoke-$(date +%s)-$$"
backend="$name-backend"
frontend="$name-frontend"

cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ]; then
    docker logs "$backend" 2>&1 | sed 's/password: .*/password: [redacted]/' || true
    docker logs "$frontend" 2>&1 || true
  fi
  docker rm -f "$frontend" "$backend" >/dev/null 2>&1 || true
  docker volume rm "$name-data" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
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

docker network create "$name" >/dev/null
docker volume create "$name-data" >/dev/null
docker run -d --platform "$platform" --name "$backend" --init \
  --network "$name" --network-alias backend --cap-drop ALL \
  --mount "type=volume,source=$name-data,target=/app/data" \
  --security-opt no-new-privileges:true \
  -e JWT_SECRET=container-smoke-test-only-do-not-use-in-production \
  -e MAIL_DOMAIN=smoke.invalid \
  "$backend_image" >/dev/null
wait_healthy "$backend"

docker run -d --platform "$platform" --name "$frontend" --init \
  --network "$name" --network-alias frontend --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -e CF_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
  "$frontend_image" >/dev/null
wait_healthy "$frontend"
test "$(docker exec "$frontend" id -u)" != 0
docker exec -i -e SMOKE_RESTART=false "$backend" node --input-type=module < "$script_dir/smoke-checks.mjs"

# Verify empty configuration and regeneration from the original template.
docker exec -e CF_TURNSTILE_SITE_KEY= "$frontend" /usr/local/bin/hostid-frontend true >/dev/null
docker exec "$backend" node -e "fetch('http://frontend:3000/config.js').then(r=>r.text()).then(t=>{if(!t.includes('CF_TURNSTILE_SITE_KEY: \"\"'))process.exit(1)})"
docker restart "$frontend" >/dev/null
wait_healthy "$frontend"

# migrate deploy must be idempotent and retain the initialized database.
docker restart "$backend" >/dev/null
wait_healthy "$backend"
docker exec -i -e SMOKE_RESTART=true "$backend" node --input-type=module < "$script_dir/smoke-checks.mjs"
echo "Container checks passed for $platform."
