# Prototype Studio 网页端 · 项目执行文档

> 版本：v1.0（待评审）
> 目标：在**新建独立项目 `prototype-studio-web`** 中实现网页端产品；**原项目 `prototype studio` 原样保留**，桌面版随时可构建使用。
> 关联需求文档：`docs/WEB_REQUIREMENTS.md`

## 1. 执行原则

1. 新建目录 `prototype-studio-web`，以当前项目为基线**完整复制**，此后一切网页端改动都在新项目内进行；原项目不做任何修改；
2. 复用现有内核：dsl-schema、dsl-validator、command-engine、requirement-engine、renderer、design-system 全部沿用；
3. 前端 Studio 引入**存储适配层**：本地模式（开发/对照用）与服务端模式（生产）；桌面 IPC 相关代码保留在新项目内但不再作为上线形态；
4. 服务端只做“项目空间 + 权限 + 同步 + MCP”，业务规则（命令、校验、渲染）不重复实现；
5. 分阶段交付，每阶段可运行、可验证，原项目可随时回归。

## 2. 新项目结构

```text
prototype-studio-web/
  apps/
    web-server/          # 服务端：项目空间 API + 认证 + 存储 + 云端 MCP
    studio/              # 前端（由原 apps/studio 改造：存储适配层，去掉桌面 IPC 依赖）
    mcp/                 # 由原 apps/mcp 改造：HTTP MCP（Streamable HTTP + Token）
  packages/              # 复制自原项目：dsl-schema / dsl-validator / command-engine /
                         #   requirement-engine / renderer / design-system / project-store
  scripts/               # E2E（网页端）、部署、数据校验
  docs/
```

> 备注：若后续需要双项目共享内核，可将 packages 抽成公共 workspace 或 git submodule；本期不做，避免扩大改动面。

## 3. 技术选型

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 服务端 | Node.js + Fastify（或 Express）+ TypeScript | 与前端同语言，复用现有 TS 内核包 |
| 存储 | 本地磁盘目录（每项目空间）+ PostgreSQL（元数据） | 生产可换对象存储（S3 兼容），文件布局不变 |
| 认证 | 邀请码注册 + HttpOnly Cookie（网页）+ Bearer Token（API/MCP） | MVP 不引入完整 RBAC |
| MCP | @modelcontextprotocol/sdk HTTP transport | Codex 原生支持 |
| 前端 | 复用现有 React/Vite Studio | 新增 server adapter |
| 部署 | Docker Compose（server + db + 数据卷） | 单机 MVP，可平滑拆分 |

## 4. 数据模型

### 4.1 文件空间（每项目一个目录，格式与本地项目一致）

与需求文档 4.2 一致：`project.yaml`、`board.yaml`、`requirements/`、`pages/`、`.prototype/{revisions,audit.jsonl,exports,trash}` 等。

### 4.2 数据库（元数据）

```sql
users(id uuid pk, name text, email text unique, invite_code text, created_at timestamptz)
projects(id uuid pk, owner_id uuid fk, name text, description text, status text,
         space_path text, created_at timestamptz, updated_at timestamptz)
project_members(project_id uuid fk, user_id uuid fk, role text, joined_at timestamptz,
                primary key(project_id, user_id))
share_links(id uuid pk, project_id uuid fk, token text unique, mode text,
            created_by uuid fk, expires_at timestamptz)
audit_index(id bigserial pk, project_id uuid fk, object_type text, revision_id text,
            created_at timestamptz, index (project_id, created_at))
```

## 5. 服务端 API（REST，前缀 `/api`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /auth/register | 邀请码注册 |
| POST | /auth/login / /auth/logout | 登录/登出（Cookie） |
| GET | /projects | 我的项目列表 |
| POST | /projects | 新建项目空间 |
| GET/PATCH/DELETE | /projects/:id | 项目详情/重命名/软删 |
| GET | /projects/:id/tree | 页面树 |
| GET/PUT | /projects/:id/pages/:pageId | 读/写页面 YAML（写走命令校验） |
| GET/PUT | /projects/:id/board | 读/写画布 |
| POST | /projects/:id/commands | 页面命令（共享 Command Engine） |
| POST | /projects/:id/board-commands | 画布命令（共享 Board Engine） |
| GET | /projects/:id/revisions | 版本历史索引 |
| GET | /projects/:id/requirements/:file | 读取需求资产 |
| POST | /projects/:id/export | 导出 Product Package / zip / HTML |
| POST | /projects/:id/import | 上传整包恢复空间 |
| POST | /projects/:id/share | 创建只读分享链接 |
| GET | /share/:token | 匿名只读查看 |
| GET | /preview/:projectId/:pageId | 网页端预览渲染页 |

写接口统一：鉴权 → 权限校验 → baseRevision 检查 → 命令/校验 → 原子写文件 → 追加 Revision → 审计索引。

## 6. 云端 MCP

- 基于原 `apps/mcp` 的服务层改造：Project Root 从“环境变量固定目录”改为“每请求按 `project_id` 解析到服务端空间”（白名单 + 权限校验）；
- 新增：`prototype_list_projects`、`prototype_create_project`（含 `create_project_from_requirement` 流程）；
- 现有工具全部增加可选 `project_id`（缺省用“当前用户唯一项目”或显式传入）；
- 传输：Streamable HTTP + Bearer Token；Codex 配置一次；
- 烟测：真实 HTTP MCP 客户端验证工具发现与读写。

## 7. 前端改造（存储适配层）

- 新建 `ProjectStoreAdapter` 接口：`listPages / readPage / writePage / applyCommands / readBoard / applyBoardCommands / revisions / requirements / export / import`；
- `ServerAdapter`（生产）：调用服务端 API；
- `LocalAdapter`（开发/对照）：保留桌面 IPC 或直连本地 project-store，用于对比与回归；
- Studio 组件层不感知后端差异；移除/隔离 `isDesktopRuntime` 分支，改为 `adapter.kind`；
- 画布、标注、属性面板、需求解析、版本 UI 全部复用现有实现。

## 8. 分阶段执行

### Phase 0：基线复制（半天）

- 复制原项目到 `prototype-studio-web`；原项目打 git 基线标记；
- 删除/标记桌面专属（Tauri、sidecar、Rust），保留 packages 与 studio 前端；
- 建立 `apps/web-server`、`apps/mcp`（HTTP）骨架；全量测试保持绿色。

### Phase 1：服务端项目空间（2–3 天）

- 认证（邀请码）、项目空间 CRUD、文件布局、原子写、软删；
- 元数据数据库迁移与连接；
- 项目空间 API（页面/画布/命令/版本/需求/导出导入）；
- 单元测试 + 接口测试。

### Phase 2：前端适配（2–3 天）

- 存储适配层落地，ServerAdapter 替换桌面 IPC；
- 登录/项目列表/创建/打开页；
- 页面与画布编辑在浏览器全流程可用；
- 网页端 E2E（复用现有用例改造）。

### Phase 3：云端 MCP（2 天）

- HTTP MCP 服务、Token 鉴权、project_id 解析；
- 新增 list_projects / create_project（含从需求创建）；
- Codex 联调烟测（一次配置、跨项目操作、权限隔离验证）。

> ✅ 已完成：`/mcp` 挂载于 web-server（Streamable HTTP）；每个会话按 Authorization Bearer 绑定用户；工具：list_projects / create_project / create_project_from_requirement / get_project / list_pages / get_page / get_dsl / get_component / get_requirement / get_board / create_page / delete_page / apply_commands / apply_board_commands / validate_dsl / get_preview_url / render_preview；真实 HTTP MCP 客户端烟测（含跨用户 FORBIDDEN 与无效 token UNAUTHORIZED）通过；预览 URL 支持网页端按 `?project=&page=` 直接打开。

### Phase 4：分享与导出（1–2 天）

- 只读分享链接、匿名预览；
- HTML 导出、Product Package、整包下载/导入；
- 权限与分享失效逻辑测试。

### Phase 5：验收与上线（1 天）

- 全量单测、网页端 E2E、云端 MCP 烟测、构建与 Docker 部署验证；
- 对照需求文档验收清单逐项确认；
- 更新 `docs/`（新项目内）与部署文档；
- 原项目回归构建（桌面版仍可打包）。

## 9. 冲突与并发

- MVP：单写者 + baseRevision；冲突返回 `REVISION_CONFLICT`，前端提示重新读取；
- 文件写入：临时文件 + 原子替换（沿用）；
- 多人协作与合并策略列为后续，不在 MVP。

## 10. 测试策略

- 单测：内核包全部沿用（命令引擎、校验、渲染、需求引擎、project-store）；
- 服务端：接口测试（认证/权限/冲突/导出导入/越权）；
- E2E：网页端注册 → 建项目 → 编辑页面 → 画布标注 → 版本 → 导出分享；
- MCP：真实 HTTP 客户端烟测 + Codex 联调记录；
- 回归：原项目桌面构建与既有 E2E 不受影响。

## 11. 风险与决策

| 风险 | 应对 |
| --- | --- |
| 双项目代码漂移 | 本期接受（独立演进）；如需要再抽公共 packages |
| 服务端文件并发 | 单写者 + 原子写 + revision 检查 |
| 对象存储迁移 | 文件布局与 S3 兼容，空间路径抽象 |
| 账号体系范围 | MVP 邀请码，不建完整 RBAC |
| Codex 远程 MCP 鉴权 | Bearer Token + project_id 白名单，路径不暴露 |

## 12. 执行入口

用户确认本计划后，第一步执行 Phase 0：在 `/Users/nightwf/Desktop/项目/` 下创建 `prototype-studio-web`（复制当前项目为基线），原项目保持不动；之后按 Phase 1–5 逐阶段实现并验证。
