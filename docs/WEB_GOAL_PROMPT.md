# Prototype Studio 网页端 Goal 提示词

> 用途：交给 Codex / 执行代理开始网页端项目。开始前先完整阅读 `docs/WEB_REQUIREMENTS.md`、`docs/WEB_EXECUTION_PLAN.md` 以及原项目代码结构，再动手。

## 目标

在 `/Users/nightwf/Desktop/项目/` 下**新建独立项目 `prototype-studio-web`**，按照 `docs/WEB_REQUIREMENTS.md` 与 `docs/WEB_EXECUTION_PLAN.md` 实现纯网页端 Prototype Studio：云托管、多项目空间、浏览器编辑页面与画布、与 Codex 通过云端 MCP 协作、只读分享、导出与导入。**原项目 `prototype studio` 保持不动（只读基线，禁止任何修改），桌面版随时可构建使用。**

## 不可破坏的原则

1. 原项目不改：只允许在原项目目录做只读操作和“复制基线”，网页端一切改动都在 `prototype-studio-web` 内完成。
2. 复用内核，不重写：`dsl-schema`、`dsl-validator`、`command-engine`、`requirement-engine`、`renderer`、`design-system`、`project-store` 全部沿用；业务规则（命令、校验、渲染、需求解析）只允许在内核实现，服务端不得复制实现。
3. 文件是事实源：每个项目一个文件空间（`project.yaml`、`board.yaml`、`pages/`、`requirements/`、`.prototype/`），云端格式与本地项目格式兼容；数据库只存元数据（用户、项目、成员、分享、审计索引），禁止把 DSL/画布塞进数据库 JSON 列。
4. 所有写操作统一进版本链：页面与画布各自独立 Revision 流，追加式、不可覆盖；执行 baseRevision 检查 → 命令校验 → 原子写文件 → 追加 Revision → 审计；冲突返回 `REVISION_CONFLICT`。
5. 云端 MCP：Streamable HTTP + Bearer Token，Codex 只配置一次；项目通过工具参数 `project_id` 选择；路径永不暴露给 Codex；越权请求一律拒绝。
6. 前端存储适配层：Studio 通过 `ProjectStoreAdapter` 访问后端（ServerAdapter 生产、LocalAdapter 开发对照）；组件层不感知后端差异，移除桌面 IPC 依赖。
7. 安全底线：邀请码注册、项目级权限校验、分享 token 化、路径穿越防护、上传限制、原子写入、审计追加式。
8. 可迁移：整包导出格式与本地项目兼容，可下载后导回原桌面版继续编辑。
9. MVP 边界不扩大：不做多人实时协作、不做开放注册/完整 RBAC、不做 PWA 离线编辑、不做可评论分享（均列为后续）。

## 必须交付的闭环（按阶段推进，每阶段可运行可验证）

### Phase 0：基线复制
- 复制当前项目到 `prototype-studio-web`，原项目打只读基线标记；
- 剥离/隔离桌面专属（Tauri、Rust sidecar、桌面 IPC），保留 packages 与 studio 前端；
- 建立 `apps/web-server`、`apps/mcp`（HTTP）骨架；全量单测保持绿色。

### Phase 1：服务端项目空间
- 邀请码注册/登录（HttpOnly Cookie + CSRF），Bearer Token 供 API/MCP；
- 项目空间 CRUD（创建/列表/打开/重命名/软删）+ 文件布局 + 原子写；
- 元数据数据库迁移与连接；
- 项目空间 API：页面读写、画布读写、页面命令、画布命令、版本索引、需求读取、导出（zip/Product Package/HTML）、导入恢复；
- 单元与接口测试（含越权、冲突、路径穿越）。

### Phase 2：前端适配
- 存储适配层落地，ServerAdapter 替换桌面 IPC 分支；
- 登录/项目列表/新建/打开流程；
- 页面编辑与画布（标注挂靠组件、拖拽、流程图/ER、连线）在浏览器全流程可用；
- 网页端 E2E：注册 → 建项目 → 编辑页面 → 画布标注与拖拽 → 版本与撤销 → 导出。

### Phase 3：云端 MCP
- HTTP MCP 服务 + Token 鉴权 + `project_id` 解析（白名单 + 权限校验）；
- 新增 `prototype_list_projects`、`prototype_create_project`（含 `create_project_from_requirement`：需求/模板 → 创建项目并生成页面与画布 → 返回项目链接）；
- 现有工具全部支持 `project_id`；Codex 一次配置即可操作多项目；
- 真实 HTTP MCP 客户端烟测 + 权限隔离验证。

### Phase 4：分享与导出
- 只读分享链接（token 化、匿名可看、可失效）；
- 独立 HTML 画布导出、Product Package、整包下载与导入恢复；
- 分享/导出权限与失效逻辑测试。

### Phase 5：验收与上线
- 全量单测、网页端 E2E、云端 MCP 烟测、构建与 Docker Compose 部署验证；
- 对照 `docs/WEB_REQUIREMENTS.md` 第 8 节验收清单逐项确认；
- 新项目内文档与部署说明更新；原项目桌面构建回归验证通过。

## 技术约束

- Node.js 20+、pnpm、TypeScript；服务端用 Fastify 或 Express（选定后保持一致）；
- 存储：磁盘目录作为项目空间（路径抽象，便于后续换 S3 兼容对象存储）；PostgreSQL 只存元数据；
- MCP：`@modelcontextprotocol/sdk` 的 HTTP transport；
- 前端：沿用原项目 Vite 5 + React（当前机器 Node 20.2，参照原项目锁定版本）；
- 部署：Docker Compose（server + db + 数据卷）单机 MVP。

## 工程质量要求

- 内核单测全部沿用且保持绿色；新增服务端测试（认证、权限隔离、冲突、越权、导出导入）；
- 网页端 E2E 覆盖核心用户链路；云端 MCP 有真实客户端烟测；
- `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build` 全绿；
- 原项目桌面构建（`pnpm --dir apps/desktop build`）回归通过；
- 不提交密钥、依赖目录、缓存与临时文件。

## 验收标准（对应需求文档）

1. 浏览器中可用邀请码注册/登录，创建项目后进入页面工作台；
2. 页面编辑、画布（标注/说明/流程/ER/连线）、版本与撤销与桌面版行为一致；
3. Codex 经云端 MCP 一次性配置后，可列项目、建项目、读 DSL、提交页面与画布命令、获取预览；
4. `create_project_from_requirement` 可创建项目并生成页面与画布，返回可打开链接；
5. 只读分享链接匿名可查看可交互原型与画布；
6. 导出 HTML、Product Package、整包下载/导入均可用；
7. 项目间权限隔离：A 项目的 token/链接无法访问 B 项目；
8. 全量单测、网页端 E2E、云端 MCP 烟测、构建与部署通过；原桌面项目保持可构建、未改动。

## 汇报方式

每个阶段以“用户能完成什么 + 如何验证”汇报；需求文档与执行文档已定的事项不要自行扩大边界；只有遇到无法从文档推断且会显著影响方向的问题才暂停询问产品经理。持续推进直到第 8 节验收标准全部满足。
