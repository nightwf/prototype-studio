#!/usr/bin/env bash
set -euo pipefail

# Prototype Studio 网页端一键部署：直接 SSH 到腾讯云服务器执行（不走 GitHub Actions）。
# 用法：bash scripts/deploy-remote.sh

SSH_KEY="${SSH_KEY:-$HOME/.ssh/guanchen_codex_deploy_ed25519}"
HOST="${DEPLOY_HOST:-root@49.234.4.212}"
REPO="/srv/prototype-studio-web"

echo "== 1/3 拉取最新代码并重建容器 =="
ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST" \
  "cd $REPO && git fetch origin main && git merge --ff-only origin/main && docker compose --env-file .env.production up -d --build"

echo "== 2/3 等待服务就绪 =="
ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST" \
  "for i in \$(seq 1 45); do code=\$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/me || true); if [ \"\$code\" = \"200\" ]; then echo \"deploy:ok commit=\$(git -C $REPO rev-parse --short HEAD)\"; exit 0; fi; sleep 2; done; echo 'deploy:failed health check timed out' >&2; exit 1"

echo "== 3/3 部署完成 =="
