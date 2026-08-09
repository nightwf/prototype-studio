# Prototype Studio 网页端 · 详细需求文档

> 版本：v1.0（待评审）
> 关联：桌面版 PRD（`prototype-studio-prd-v1.1-local-first.md`）、画布增补（第 86 章）、执行文档（`docs/WEB_EXECUTION_PLAN.md`）
> 定位：纯网页端产品，与原桌面版并行。桌面版保留不动，可随时构建使用。

## 1. 产品定位

Prototype Studio 网页端是一个**云托管、多项目、可分享**的需求与原型工作台：产品经理在浏览器中创建项目、编辑页面与画布、与 Codex 协作，并把可交互原型通过链接分享给团队。它与桌面版共享同一套内核（DSL、命令引擎、渲染器、画布模型），差异在“运行环境”：

- 本地文件系统 → 服务端项目空间（文件存储 + 元数据数据库）；
- 本地 MCP → 云端 MCP（HTTP，一次配置）；
- 桌面壳 → 浏览器，全平台零安装。

## 2. 用户与场景

| 角色 | 场景 |
| --- | --- |
| 产品经理 | 浏览器创建项目，粘贴 Codex 整理的需求/模板，生成并编辑原型，画布上做标注、流程图、ER 图，版本回退，导出/分享 |
| Codex（Agent） | 通过云端 MCP 创建项目、读取需求与 DSL、提交结构化命令、获取预览 |
| 开发/评审人 | 通过只读链接查看可交互原型与画布，可评论（后续） |
| 项目维护者 | 管理项目空间、成员、分享链接与数据导出 |

## 3. 账户与项目空间

### 3.1 账户

- MVP 采用**邀请码注册**（服务端生成邀请码，管理员发放），不做开放注册；
- 登录态用于：项目创建、成员授权、审计归属、分享链接管理；
- 会话采用 HttpOnly Cookie + CSRF 防护；对外 API（含 MCP）使用 Bearer Token。

### 3.2 项目空间

- 每个项目一个**独立空间**：文件存储目录 + 元数据记录；
- 项目归属创建者；可添加成员（成员=读写权限，MVP 不区分角色细粒度，后续再加）；
- 项目级隔离：任何接口必须校验调用者对项目的权限，越权返回 403；
- 支持：新建（网页端/Codex）、打开、列表、重命名、删除（软删，可恢复）、整包导出、整包导入恢复。

## 4. 数据模型与存储

### 4.1 原则

- **项目文件按文件存，数据库只存元数据**；禁止把 DSL/画布塞进数据库 JSON 列当事实源；
- 云端空间与本地项目目录**格式兼容**（同一套 project.yaml / pages/ / board.yaml / .prototype/），整包可双向迁移；
- 版本历史是文件（Revision JSON），审计是追加日志。

### 4.2 文件空间布局（每项目）

```text
<project-space>/
  project.yaml
  board.yaml
  requirements/
  pages/*.ui.yaml
  flows/  data/  assets/
  .prototype/
    revisions/<pageId>/
    revisions/board/
    audit.jsonl
    exports/
    trash/
```

### 4.3 元数据数据库（示意）

- `users(id, name, email, invite_code, created_at)`
- `projects(id, owner_id, name, description, status, space_path, created_at, updated_at)`
- `project_members(project_id, user_id, role, joined_at)`
- `share_links(id, project_id, token, mode, created_by, expires_at)`
- `audit_index(project_id, revision_id, object_type, created_at)`（审计正文仍以文件为准，此处仅索引）

## 5. 功能需求

### 5.1 项目生命周期

- 网页端“新建项目”：输入名称/描述 → 服务端创建空间（project.yaml + board.yaml + 空目录）→ 返回项目；
- Codex“创建项目”：云端 MCP `prototype_create_project`（支持 `create_project_from_requirement`：需求/模板 → 生成页面与画布 → 返回项目链接）；
- 打开项目：加载文件空间 → 构建页面树与画布；
- 删除：移入项目级回收站（软删），成员与分享链接同步失效；
- 导出：整包（zip）、Product Package、独立 HTML 画布。

### 5.2 编辑器（复用现有能力）

页面工作台：页面树（新建/切换/排序/重命名/删除）、点选组件属性编辑、组件大纲拖拽排序、命令栏、需求→Page Plan→确认生成、版本历史与撤销/重做。

### 5.3 画布

完整承接桌面版画布（PRD 第 86 章）：

- 对象类型：页面帧、标注、说明、流程图、ER 图、连线；对象类型开放机制（注册表 + 未知类型降级）；
- 标注：双入口（画布工具栏/页面编辑属性面板）、挂靠组件、拖拽微调、颜色与文字编辑；
- 画布工具栏：缩放/平移/添加对象/导出 HTML；
- 画布数据存 `board.yaml`，修改走命令引擎与画布 Revision 流。

### 5.4 需求与 Codex 交付

- 粘贴规范需求 Markdown 或结构化页面模板（YAML/JSON）；
- 模板支持顶层 `board`（页面帧/标注/说明/流程图/ER/连线）；
- Codex 经云端 MCP 交付：读需求 → 生成模板 → 建项目/更新页面与画布 → 返回链接；
- 所有解析项保留 Explicit/Inferred/Default 来源标记。

### 5.5 版本与审计

- 页面与画布各自独立 Revision 流，追加式、不可覆盖；
- 所有写操作统一走 Command Engine：baseRevision 检查 → 校验 → 原子写文件 → 追加 Revision → 审计；
- 冲突策略（MVP）：单写者 + baseRevision 检查，冲突时返回 `REVISION_CONFLICT`，客户端重新读取后再提交。

### 5.6 云端 MCP

- 协议：Streamable HTTP（Codex 原生支持），Bearer Token 鉴权；
- **Codex 只配置一次**（指向服务端 URL），项目通过工具参数 `project_id` 选择；
- 工具清单（已实现）：`prototype_list_projects`、`prototype_create_project`、`prototype_create_project_from_requirement`、`prototype_get_project`、`prototype_list_pages`、`prototype_get_page`、`prototype_get_dsl`、`prototype_get_component`、`prototype_get_requirement`、`prototype_get_board`、`prototype_create_page`、`prototype_delete_page`、`prototype_apply_commands`、`prototype_apply_board_commands`、`prototype_validate_dsl`、`prototype_get_preview_url`、`prototype_render_preview`（组件级便捷工具 update/move/delete_component 与 overlay 系列可由 `apply_commands` 表达，后续按需补充）；
- 安全：路径永不暴露给 Codex；`project_id` 必须属于调用者权限范围；写操作与服务端共用版本链。

### 5.7 分享与预览

- 只读分享链接（MVP）：token 化链接，匿名可看可交互原型与画布，不可编辑；
- 预览：网页端直接渲染（复用同一 Renderer），`get_preview_url` 返回网页端预览地址；
- 可评论分享：后续迭代。

### 5.8 导出

- 独立 HTML 画布导出（标注自动定位）；
- Product Package（含画布）与整包 zip 下载；
- 整包导入：上传 zip 恢复项目空间（格式校验）。

## 6. 非功能需求

- 性能：页面刷新 P95 < 500ms、项目打开 P95 < 2s（不含 AI）；列表与画布对象较多时做分页/懒加载；
- 安全：HTTPS；邀请码注册；项目级权限校验；路径穿越防护；上传大小与类型限制；审计记录不可篡改（追加式）；
- 可用性：网络错误/服务端错误给出可恢复提示；编辑失败不丢本地草稿（草稿区）；组件渲染失败不影响整体（沿用错误隔离）；
- 可迁移：项目整包随时可下载，格式与桌面版兼容，可导回本地桌面版继续编辑；
- 合规：数据存储位置与保留策略在部署文档中明确。

## 7. MVP 边界（本期不做）

- 多人实时在线协作编辑（先单写者 + 版本检查）；
- 组织级权限体系与开放注册（先邀请码）；
- PWA 离线编辑（后续）；
- 可评论分享（后续）；
- 云端计费与用量控制（上线前按需补充）。

## 8. 验收标准

1. 浏览器中可用邀请码注册/登录，创建项目后进入页面工作台；
2. 页面编辑、画布（标注/说明/流程/ER/连线）、版本与撤销与桌面版行为一致；
3. Codex 通过云端 MCP 一次性配置后，可列项目、建项目、读 DSL、提交页面与画布命令、获取预览；
4. `create_project_from_requirement`：Codex 根据需求模板创建项目并生成页面与画布，返回可打开链接；
5. 只读分享链接匿名可查看可交互原型与画布；
6. 导出 HTML、Product Package、整包下载/导入均可用；
7. 项目间权限隔离：A 项目的 token/链接无法访问 B 项目；
8. 全量单测、网页端 E2E、云端 MCP 烟测、构建与部署通过；原桌面项目保持可构建、未改动。
