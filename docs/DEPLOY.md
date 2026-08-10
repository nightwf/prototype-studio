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

2. 进入目录，创建仅保存在服务器上的生产配置：

   ```bash
   cd /srv/prototype-studio-web
   cp .env.example .env.production
   chmod 600 .env.production
   # 编辑 .env.production，填写数据库密码、DATABASE_URL、域名和邀请码
   bash scripts/deploy.sh
   ```

3. 验证：

   - `curl http://127.0.0.1:8787/api/me` 返回 200；
   - 浏览器访问 `BASE_URL`，用邀请码注册登录；
   - Codex MCP 配置：`url = <BASE_URL>/mcp` + `bearer_token_env_var`（token 在网页端“我的项目”页复制）。

## HTTPS 与域名（推荐）

`docker-compose.yml` 暴露 `8787`。如需域名 + HTTPS，在前面加反向代理，例如 Caddy：

```text
studio.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

`Caddyfile` 放入 `/etc/caddy/` 并 `systemctl reload caddy`，然后在 `.env.production` 中设置 `BASE_URL=https://studio.example.com`（分享链接/预览地址会使用该值）。

## 配置项

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `BASE_URL` | 必填 | 对外地址（决定分享/预览链接） |
| `INVITE_CODES` | 必填 | 逗号分隔的注册邀请码（一次性） |
| `PORT` | `8787` | 服务端口 |
| `SPACES_DIR` | `/data/spaces`（卷） | 项目文件空间 |
| `POSTGRES_USER` | 必填 | PostgreSQL 用户名 |
| `POSTGRES_PASSWORD` | 必填 | PostgreSQL 密码，建议使用 URL 安全的长随机字符串 |
| `POSTGRES_DB` | 必填 | PostgreSQL 数据库名 |
| `DATABASE_URL` | 必填 | 与上述 PostgreSQL 配置一致的应用连接串 |

## 数据与备份

- 项目文件：`docker compose` 的 `spaces` 数据卷（/data/spaces）；
- 元数据：`pgdata` 数据卷（PostgreSQL）；
- 备份：`docker compose` 卷快照 + `data/spaces` 目录即可完整恢复；整包下载/导入是另一种迁移方式（与桌面版格式兼容）。

## 安全提示

- `.env.production` 只保存在服务器，权限设为 `600`，不得提交 Git；
- 上线前务必修改 `INVITE_CODES` 并妥善分发；
- `/mcp` 需要有效的 Bearer Token（来自登录响应），无效 token 返回 UNAUTHORIZED；
- 建议在反向代理层启用 HTTPS，并按需限制来源 IP。

## 自动部署与持续更新

支持“push 即部署”：仓库推送到 GitHub（私有仓库）后，GitHub Actions 先执行完整质量门禁，再 SSH 到服务器执行 fast-forward 更新和 Docker Compose 构建。生产配置始终由服务器上的 `.env.production` 提供。

首次配置：

1. 把本仓库推到 GitHub 私有仓库；
2. 在服务器上设置 `REPO_URL` 后执行 `scripts/server-init.sh`，再填写生成的 `.env.production`；
3. 给服务器配置 GitHub 私有仓库的只读 Deploy Key；
4. 在 GitHub 仓库 Settings → Environments 创建 `production`，配置：`SSH_HOST`、`SSH_PORT`、`SSH_USERNAME`、`SSH_KEY`、`SSH_FINGERPRINT`；
5. 之后每次 push 到 `main` 自动部署；也可在 Actions 页面手动触发。

已有 PostgreSQL 数据卷时，不要只修改 `.env.production` 中的密码：先在数据库内修改角色密码，再同步更新 `POSTGRES_PASSWORD` 和 `DATABASE_URL`。任何维护操作都不要执行 `docker compose down -v`。

腾讯云（Gitee 等）平台同理：换成对应 CI 配置（如 Gitee Go），把同一套 SSH 部署命令接入即可。
