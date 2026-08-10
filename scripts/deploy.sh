#!/usr/bin/env bash
set -euo pipefail

# Prototype Studio 网页端一键部署（Ubuntu/Debian + Docker）
# 用法：在服务器上，项目目录内执行： bash scripts/deploy.sh

cd "$(dirname "$0")/.."

echo "== 1/4 检查 Docker =="
if ! command -v docker >/dev/null 2>&1; then
  echo "未安装 Docker。请先安装："
  echo "  curl -fsSL https://get.docker.com | sh"
  echo "  sudo usermod -aG docker $USER && newgrp docker"
  exit 1
fi
docker compose version >/dev/null 2>&1 || { echo "需要 docker compose 插件。"; exit 1; }

echo "== 2/4 配置 =="
ENV_FILE="${ENV_FILE:-.env.production}"
if [ ! -f "$ENV_FILE" ]; then
  echo "缺少 $ENV_FILE。请先复制 .env.example，并填写生产配置。"
  exit 1
fi
echo "使用生产配置：${ENV_FILE}"

echo "== 3/4 构建并启动（PostgreSQL + 应用）=="
docker compose --env-file "$ENV_FILE" up -d --build

echo "== 4/4 等待就绪并健康检查 =="
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:8787/api/me" || true)
  if [ "$code" = "200" ]; then
    echo "部署成功。"
    echo "备份：docker compose 数据卷 pgdata 与项目 data/spaces 目录"
    exit 0
  fi
  sleep 2
done
echo "健康检查超时，请查看： docker compose --env-file $ENV_FILE logs app"
exit 1
