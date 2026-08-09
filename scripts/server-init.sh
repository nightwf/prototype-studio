#!/usr/bin/env bash
set -euo pipefail

# Prototype Studio 网页端 · 服务器首次初始化（Ubuntu 24.04 + 腾讯云）
# 在服务器 root 下执行： bash <(curl -sL <你的脚本地址>) 或直接粘贴执行

echo "== 安装 Docker + Compose =="
apt update
apt install -y docker.io docker-compose-v2
systemctl enable --now docker

echo "== 配置腾讯云镜像加速 =="
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }
EOF
systemctl restart docker

echo "== 添加 2G 交换分区 =="
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 拉取项目 =="
if [ ! -d /srv/prototype-studio-web/.git ]; then
  mkdir -p /srv
  git clone "$REPO_URL" /srv/prototype-studio-web
fi

echo "== 首次部署 =="
cd /srv/prototype-studio-web
BASE_URL="${PUBLIC_URL:-http://127.0.0.1:8787}" INVITE_CODES="${INVITE_CODES:-PROTOTYPE-DEV}" docker compose up -d --build
echo "部署完成。浏览器访问 ${BASE_URL}"
