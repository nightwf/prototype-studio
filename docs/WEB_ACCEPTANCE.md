# Prototype Studio 网页端 · 验收清单

> 对照 `docs/WEB_REQUIREMENTS.md` 第 8 节逐项确认。证据来自自动化测试、E2E、MCP 烟测与构建产物。

## 1. 浏览器可用邀请码注册/登录，创建项目后进入页面工作台

- 证据：`apps/web-server/src/index.test.ts`（注册/登录/项目创建）、`apps/web-server/src/mcp.test.ts`、网页端 E2E `scripts/e2e_web.py`（注册→新建项目→进入画布工作台）。

## 2. 页面编辑、画布（标注/说明/流程/ER/连线）、版本与撤销与桌面版行为一致

- 证据：内核单测全量沿用（命令引擎、校验、渲染、画布、需求引擎共 47+ 项）；网页端 E2E 覆盖页面创建、画布说明、导出；服务端测试覆盖页面命令（Revision 2）、画布命令（Revision 2）、快照撤销写入（revision 3）、版本索引。

## 3. Codex 经云端 MCP 一次性配置后，可列项目、建项目、读 DSL、提交页面与画布命令、获取预览

- 证据：`apps/web-server/src/mcp.test.ts` 真实 HTTP MCP 客户端烟测：`list_projects` / `create_project` / `get_project` / `get_dsl` / `apply_commands` / `apply_board_commands` / `get_board` / `get_preview_url` 全部通过。

## 4. create_project_from_requirement 可创建项目并生成页面与画布，返回可打开链接

- 证据：`mcp.test.ts` 中 `prototype_create_project_from_requirement` 由模板生成 `case-list` 页面并返回 `preview_url`（`?project=&page=`，前端已支持按参数打开）。

## 5. 只读分享链接匿名可查看可交互原型与画布

- 证据：`apps/web-server/src/share.test.ts`：创建分享→匿名 `GET /api/share/:token` 返回项目/页面/画布数据；`GET /share/:token` 返回完整 HTML 画布（含页面帧与标注）；撤销后 404；过期后 404。

## 6. 导出 HTML、Product Package、整包下载/导入均可用

- 证据：HTML 导出（服务端测试 + 网页端 E2E 下载）；Product Package（`buildProductPackage` 测试）；整包下载（zip 接口 + 网页端“整包”按钮）；导入恢复（`share.test.ts` 导出→导入往返，页面/画布/清单一致；路径穿越与缺失 project.yaml 拒绝）。

## 7. 项目间权限隔离：A 项目的 token/链接无法访问 B 项目

- 证据：REST 测试（B 访问 A 项目 403、路径穿越 400/404）；MCP 测试（跨用户 FORBIDDEN、无效 token UNAUTHORIZED）；分享链接仅绑定项目，A 项目 token 无法读取 B 项目数据。

## 8. 全量单测、网页端 E2E、云端 MCP 烟测、构建与部署通过；原桌面项目保持可构建、未改动

- 证据：`pnpm typecheck` 全绿；`pnpm test` 57 项通过；`pnpm lint` 零警告；`pnpm build` 通过；`python scripts/e2e_web.py` 通过；云端 MCP 真实客户端烟测通过；原项目 `pnpm --filter @prototype-studio/desktop build` 回归通过（桌面 .app 成功打包，原项目代码未改动）。
- 部署：提供 `Dockerfile` + `docker-compose.yml`（postgres 元数据 + 磁盘项目空间 + 迁移自动执行）；本机无 Docker 环境，容器运行时验证留待部署环境执行（服务端本体已通过内置二进制 + 全量集成测试验证）。
