# Findings

## Project inventory

- 项目目录目前只有一份正式输入文档：`prototype-studio-prd-v1.1-local-first.md`。
- 文档约 2993 行、36 KB，版本为 V1.1，明确定位为 Local-first MVP。
- 当前尚无代码、设计稿、DSL Schema 或示例项目；后续实现必须先把 PRD 收敛为工程边界和可验证的垂直切片。

## Requirement analysis

### 一句话产品定义

Prototype Studio 是面向后台管理类 Web 系统的本地优先桌面原型工具：将 PRD/自然语言转成结构化 Requirement Model 与 UI DSL，通过固定 Renderer 得到可交互原型，并允许产品经理、Codex 和其他 Agent 围绕同一份本地 DSL 安全地增量修改。

### 核心价值验证

1. 从需求到第一版原型显著提速。
2. AI 首次生成不准确时，产品经理可以低成本点选并修正。
3. 经多轮人工/AI 修改后，结构仍稳定、可追踪、可撤销。
4. Coding Agent 能直接消费结构化产品规格，减少研发交接损失。

### 四层职责边界

- Requirement Model：业务要做什么。
- UI DSL：页面和交互如何组织，是原型的唯一源文件。
- Design System：界面长什么样，普通 DSL 使用语义属性而不是自由 CSS。
- Renderer：确定性地把 DSL 显示为 React 原型，运行时禁止调用 AI。

AI 只负责理解意图和生成结构化命令；所有人工、AI、MCP 修改最终统一进入 Command Engine。

### MVP 产品形态

- macOS/Windows 本地桌面应用，PRD 推荐 Tauri + React + TypeScript。
- 本地 Preview Runtime，通过 iframe 嵌入 Studio，实现 CSS、运行时与故障隔离。
- 本地项目目录是可复制、压缩、Git 管理和跨机器恢复的完整资产。
- Local MCP Server 优先 stdio，由 Desktop App 管理生命周期，首期支持外部 Codex。
- 不依赖 PostgreSQL、Redis、S3、Docker、云端账号或服务端存储。

### 本地项目结构

新建项目至少生成：

```text
project.yaml
requirements/
pages/
data/
flows/
assets/
.prototype/
```

- `requirements/*.md` 保存人类可读需求，可另存结构化解析结果。
- `pages/*.ui.yaml` 保存页面 DSL，是核心事实源。
- Mock Data 与页面 DSL 分离。
- `.prototype/` 只适合索引、缓存和运行数据；项目恢复不能依赖不可迁移的本机数据库。

### Studio 信息架构

- 顶部：项目/页面上下文、分享、版本入口。
- 左侧：页面树，支持创建、删除、重命名、排序和切换。
- 中间：iframe Preview。
- 右侧：选中组件的属性面板，简单编辑不调用 AI。
- 底部：AI Command 区，自动带项目、页面、组件、DSL 路径、相关规则和最近变更上下文。

### 第一阶段 DSL 覆盖面

- 页面类型重点：list、detail、form；dashboard、wizard 可留在 Schema 或后续。
- 组件：Input、Select、Number、Date、DateTime、Radio、Checkbox、Switch、Textarea、Button、Table、Tabs、Card、Description、Form、Modal、Drawer。
- Overlay 抽象：modal、drawer、popover。
- Event：open、close、submit、navigate、refresh、setValue、clear、show、hide、enable、disable。
- Condition 运算符：equals、notEquals、contains、in、notIn、greaterThan、lessThan、isEmpty、isNotEmpty。
- Validation：required、minLength、maxLength、min、max、pattern。
- UI 权限只表达产品规格，不能替代正式后端鉴权。

### Component ID

- 每个可点选节点有稳定且唯一的 componentId，如 `search.status`、`overlay.batchAssign.collector`。
- ID 不得因 Label 修改而变化。
- Preview 点击后向 Studio 回传 projectId、pageId、componentId；Studio据此解析 DSLPath、父子与兄弟上下文。

### 统一修改链路

```text
Studio 属性编辑 / 拖拽 / AI / MCP / API
→ Command Engine
→ baseRevision 并发检查
→ Command Validation
→ DSL Patch
→ DSL Validation
→ append-only Revision
→ Renderer
→ Preview Refresh
```

- 简单属性和排序直接生成命令，不调用 AI。
- 复杂语义交给 Agent，但 Agent 只能返回结构化 Command，禁止返回或重写完整 HTML/DSL。
- 单节点修改可自动执行；多节点修改先显示 Change Plan、影响范围和确认入口。
- 所有来源都必须支持 Diff、Undo、Redo 和审计。
- Revision 冲突返回 `409 REVISION_CONFLICT`。

### MVP Command 集合

CREATE_PAGE、DELETE_PAGE、ADD_COMPONENT、UPDATE_COMPONENT、MOVE_COMPONENT、DELETE_COMPONENT、CREATE_OVERLAY、UPDATE_OVERLAY、DELETE_OVERLAY、ADD_RULE、UPDATE_RULE、DELETE_RULE、ADD_EVENT、UPDATE_EVENT。

### 校验要求

- JSON Schema 校验 DSL 结构。
- 自定义校验引用是否存在、ID 是否唯一、组件/Event 类型是否合法。
- 外部手工改坏 DSL 时保留最后一个有效 Preview，显示精确错误位置，不让 Studio 整体崩溃。

### Requirement → Prototype 主流程

1. 上传/粘贴 PRD，创建 Requirement。
2. AI 解析为 Requirement Model，并区分 Explicit / Inferred / Default。
3. 先展示页面、Overlay、规则、权限和未明确项的 Page Plan，用户确认。
4. 再分页面生成 UI DSL，执行校验和渲染。
5. 用户通过点选属性、拖拽或自然语言继续编辑。

### File Watcher

- 监听 project.yaml、requirements/、pages/、data/、flows/ 的 create/change/rename/delete。
- 必须防抖，重新读取和校验，然后更新页面树与 Preview。
- Studio、Codex、VS Code 直接编辑共享同一份本地文件，不另设同步数据库。

### MCP 首期必要闭环

- 读取：get_project、list_pages/get_page、get_component、get_dsl、get_requirement。
- 修改：create_project/create_page、add/update/move/delete_component、create/update_overlay、apply_commands、validate_dsl。
- 预览：render_preview、get_preview_url。
- MCP 必须限制在当前 Project Root，并具备本地认证/授权；不默认拥有管理员权限。

### MVP 明确不做

- 云端数据库、SaaS 账号体系、服务端项目存储与多人实时协同。
- Figma/Photoshop 替代、自由画布、像素级自由定位。
- 移动 App 原型、生产代码生成、数据库设计、自动部署。
- 任意第三方 React 组件自动解析。
- Studio 内置模型可视为 V2；V1 优先通过 Local MCP + 外部 Codex 完成 AI 闭环。

### 验收主线

- PRD 能生成包含页面、搜索、表格、按钮、Modal 与基础交互的可运行原型。
- 任意 Renderer 组件可准确点选并定位 componentId/pageId/DSLPath。
- Label、Required、Visible、Size、Variant 本地实时修改，不调用 AI。
- Modal → Drawer 以结构化命令完成，不重写 DSL。
- AI 操作可 Undo，DSL 与 Preview 一致恢复。
- MCP 可读项目/页面/组件、更新组件、校验并返回 Preview URL。
- 同一 DSL + Renderer + Design System 版本重复渲染结果一致。

## Ambiguities and assumptions

1. **架构冲突**：第 81 节仍推荐 PostgreSQL/Redis/S3，但第 76、84A-84G 节明确 MVP 不使用这些服务。Goal 应以 Local-first 增补章节为最高优先级，采用文件系统为事实源，可选嵌入式索引仅作可重建缓存。
2. **分享冲突**：文档要求 AnyoneWithLink，但纯本地应用无法天然生成公网可访问链接。MVP 可先实现本机 Preview URL、导出/打包或局域网临时分享；真正公网链接需要云层，不能假装完成。
3. **需求文件解析范围**：PRD 提到 Markdown/Word/PDF/TXT，但没有指定解析库、OCR、复杂表格和扫描 PDF。Goal 应要求优先实现 Markdown/TXT/粘贴，并为 DOCX/PDF 提供清晰解析状态与失败提示；是否在首个垂直切片完全支持需后续确认。
4. **AI 接入凭据与运行方式**：文档同时提到 Codex/OpenAI，但 V1 又建议外部 Codex + MCP。Goal 应将 Studio 内 AI 设计成可替换接口或占位，不把模型 SDK 嵌进核心引擎。
5. **版本持久化格式未定**：PRD既描述 page_revision 数据表，也强调文件目录。Goal 应采用文件友好的追加式历史方案，并确保可通过当前 DSL + 历史记录恢复；数据库表只作为概念模型。
6. **Undo/Redo 语义**：未说明是移动 revision pointer 还是创建逆向 revision。为了满足“Revision 不可覆盖”和全来源审计，推荐 Undo/Redo 也创建新 revision，记录 revert/reapply 来源。
7. **Preview Mock 行为未完整定义**：submit、refresh、navigate 等事件的模拟数据与页面路由语义不够具体。Goal 应要求做可演示闭环，但不能把 Mock 当正式后端。
8. **权限/管理员/设计师角色**：Local-first 单机 MVP 不应先做完整账号与组织权限。只保留 DSL 权限规格表达及本地 MCP scope。
9. **技术选型默认**：Tauri + React + TypeScript 与 PRD一致；monorepo建议使用 pnpm workspace。具体 UI 组件库未指定，应优先选成熟、可主题化、适合后台系统且不破坏确定性渲染的方案。
10. **实施范围风险**：全文包含八个 Sprint，是完整 MVP 路线而非一次短任务。Goal 必须要求按可运行垂直切片推进，每阶段有测试、示例项目和可见验收，不允许只搭空壳或一次性铺开全部功能。
