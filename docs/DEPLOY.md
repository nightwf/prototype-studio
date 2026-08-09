# Prototype Studio 网页端 · 部署文档

## 服务器要求

- Ubuntu/Debian 或兼容 Linux，2 GB 内存、20 GB 磁盘即可；
- Docker Engine 20+ 与 Docker Compose 插件（`docker compose`）；
- 公网 IP（或内网使用），对外端口 `8787`（应用/MCP）；如走 HTTPS 再开放 `80/443` 并配置反向代理。

## 部署步骤

1. 上传项目到服务器（任选其一）：

   ```bash
   git clone <你的仓库地址> prototype-studio-web
   # 或 rsync -av --exclude node_modules --exclude .git ./prototype-studio-web/ user@server:/srv/prototype-studio-web/
   ```

2. 进入目录，设置环境变量并一键部署：

   ```bash
   cd /srv/prototype-studio-web
   PUBLIC_URL=https://studio.example.com INVITE_CODES=PROTOTYPE-DEV bash scripts/deploy.sh
   ```

3. 验证：

   - `curl http://127.0.0.1:8787/api/me` 返回 200；
   - 浏览器访问 `PUBLIC_URL`，用邀请码注册登录；
   - Codex MCP 配置：`url = <PUBLIC_URL>/mcp` + `bearer_token_env_var`（token 在网页端“我的项目”页复制）。

## HTTPS 与域名（推荐）

`docker-compose.yml` 暴露 `8787`。如需域名 + HTTPS，在前面加反向代理，例如 Caddy：

```text
studio.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

`Caddyfile` 放入 `/etc/caddy/` 并 `systemctl reload caddy`，然后部署时设置 `PUBLIC_URL=https://studio.example.com`（分享链接/预览地址会使用该值）。

## 配置项

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PUBLIC_URL` | 服务器 IP | 对外地址（决定分享/预览链接） |
| `INVITE_CODES` | `PROTOTYPE-DEV` | 逗号分隔的注册邀请码（一次性） |
| `PORT` | `8787` | 服务端口 |
| `SPACES_DIR` | `/data/spaces`（卷） | 项目文件空间 |
| `DATABASE_URL` | compose 内置 | PostgreSQL 连接串（自动执行迁移） |

## 数据与备份

- 项目文件：`docker compose` 的 `spaces` 数据卷（/data/spaces）；
- 元数据：`pgdata` 数据卷（PostgreSQL）；
- 备份：`docker compose` 卷快照 + `data/spaces` 目录即可完整恢复；整包下载/导入是另一种迁移方式（与桌面版格式兼容）。

## 安全提示

- 上线前务必修改 `INVITE_CODES` 并妥善分发；
- `/mcp` 需要有效的 Bearer Token（来自登录响应），无效 token 返回 UNAUTHORIZED；
- 建议在反向代理层启用 HTTPS，并按需限制来源 IP。

## 自动部署与持续更新

支持“push 即部署”：仓库推送到 GitHub（私有仓库）后，GitHub Actions 自动 SSH 到服务器执行 `git pull && docker compose up -d --build`。

首次配置：

1. 把本仓库推到 GitHub 私有仓库；
2. 在服务器上执行 `scripts/server-init.sh`（需先设置 `REPO_URL`/`PUBLIC_URL`/`INVITE_CODES` 环境变量）；
3. 在 GitHub 仓库 Settings → Secrets and variables → Actions 配置：`SSH_HOST`、`SSH_USERNAME`、`SSH_KEY`（服务器 SSH 私钥）、`PUBLIC_URL`、`INVITE_CODES`；
4. 之后每次 push 到 `main` 自动部署；也可在 Actions 页面手动触发。

腾讯云（Gitee 等）平台同理：换成对应 CI 配置（如 Gitee Go），把同一套 SSH 部署命令接入即可。
