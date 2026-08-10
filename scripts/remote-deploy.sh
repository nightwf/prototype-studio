#!/usr/bin/env bash
set -euo pipefail

repo=/srv/prototype-studio-web
env_file=.env.production

cd "$repo"
test -f "$env_file"
test -z "$(git status --porcelain --untracked-files=no)"

git fetch origin main
git merge --ff-only origin/main
docker compose --env-file "$env_file" build app
docker compose --env-file "$env_file" up -d

for attempt in $(seq 1 45); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/me || true)
  if [ "$code" = "200" ]; then
    echo "deploy:ok commit=$(git rev-parse --short HEAD) health=200"
    exit 0
  fi
  sleep 2
done

docker compose --env-file "$env_file" logs --tail=100 app
echo "deploy:failed health check timed out" >&2
exit 1
