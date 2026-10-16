# 架构决策记录

## ADR-001：Local-first 章节优先

PRD 第 81 节残留 PostgreSQL、Redis、S3 推荐，与第 76、84A–84G 节的 Local-first MVP 冲突。MVP 采用文件系统事实源，不引入这些服务；未来云端能力通过兼容的 Sync Layer 增加。

## ADR-002：Undo/Redo 追加 Revision

为了满足 Revision 不可覆盖和全来源审计，Undo/Redo 不移动或删除历史，而是分别创建 `source=undo` / `source=redo` 的新 Revision，并记录 `revertsRevision` / `reappliesRevision`。

## ADR-003：公开分享不伪实现

纯本地应用没有稳定公网入口。MVP 提供本机 Preview、局域网可选访问和 Product Package；真正 `AnyoneWithLink` 留给 Cloud Sync Layer。

## ADR-004：AI Adapter 不进入 Renderer

V1 推荐外部 Codex + Local MCP。Studio 复杂 AI 命令通过可替换 Adapter 预留；无模型或密钥时，编辑、渲染、校验、版本和本地 Parser 仍完整可用。

## ADR-005：历史保存完整快照

MVP Revision 同时保存 Before/After 与 Command，便于可靠 Diff 和恢复。项目规模增长后可增加 checkpoint + patch 压缩，但不得改变外部 DSL 文件格式或破坏审计语义。

## ADR-006：Vite 5 兼容当前开发环境

当前机器 Node.js 20.2，Vite 7 要求 Node 20.19+。为确保开发与验证真实可运行，Studio 固定使用 Vite 5；升级 Node 后可独立评估 Vite 升级，不影响产品架构。

## ADR-007：原始需求文档由 Codex 处理

根据产品经理确认，DOCX、PDF、扫描件 OCR 等原始文档读取不属于 Prototype Studio 本体。Codex 负责理解和整理输入文档，再通过 Local MCP 或可读的 Markdown/Requirement Model 交给 Studio；Studio 保留需求溯源、Page Plan、DSL 生成与确认能力，但不重复内置文档解析器。

## ADR-008：需求交付升级为结构化页面模板（已实现）

当前确定性生成器只能产出最小页面骨架，页面类型、字段归属依赖关键词启发式，业务准确性有限。产品经理已确认可行方向：将 Codex 交付契约升级为结构化页面模板，显式声明每个页面的类型、查询字段、表格列、表单字段、选项与校验规则；Studio 端按声明确定性生成完整 DSL，消除猜测环节。该方向继续遵守 ADR-004/ADR-007：生成逻辑仍在 Studio 本地、零模型依赖，Codex 只负责把原始文档整理成结构化交付物。

已实现内容：

- `parseRequirementTemplates` 解析 Codex 交付的 YAML/JSON 结构化模板，结构非法时返回带精确位置的稳定错误；
- `createPagePlanFromTemplates` 使用显式页面类型（不再按标题关键词猜测），并保留字段级定义供生成器使用；
- `generatePageDSL` 按模板声明生成查询字段、表格列、表单字段、校验规则与 Modal/Drawer；
- Studio 粘贴入口自动识别结构化模板，Markdown 路径保持不变。

后续迭代：模板变更后的“增量同步”（新旧 DSL diff → 结构化命令 → 按版本链增量应用），避免全量重生成覆盖手动修改。

## ADR-009：页面即内容、画布即编排，AI 交付必须一次成型（已实现）

**背景**：AI（Codex）通过 MCP 生成原型时出现两类稳定性问题——(1) 校验失败只返回一句“页面 DSL 未通过校验”，拿不到出错位置，只能反复试错；(2) 批量生成多页时中途失败会留下半成品项目；(3) 页面生成后不进入任何画布，用户在“画布”里看不到东西，分不清该生成页面还是画布。

**决策**：

1. **语义固定**：`pages/*.ui.yaml` 是内容，`boards/*.board.yaml` 是编排。生成原型 = 建页面 + 把页面铺到画布；不存在“只生成画布就完成原型”的路径。
2. **错误必须可定位**：MCP 错误信封统一携带 `details`；DSL 校验失败返回 `index / pageId / path / message / suggestion` 列表，不再丢诊断。
3. **批量必须原子**：`prototype_create_pages` 先整体校验（DSL 合法性、批次内 ID 重复、与已有页面冲突），全部通过才写入；任一页有问题则整批不写入。`prototype_create_project` 携带 pages 时失败会把刚建的项目回滚进回收站。
4. **默认可见**：批量建页默认把新页面按两列铺到默认画布（`place_on_board="default"`），可用 `"none"` 关闭。
5. **可自检**：`prototype_get_project` 返回 `boards[].placed_page_ids`、`pages_not_on_any_board` 与 `workflow_hint`，AI 能自己发现“页面没上画布”并调用 `prototype_place_pages_on_board` 修正。
6. **人在环可见**：Studio 顶栏提供「同步」按钮（网页端）重新拉取服务端页面与画布；页面树标记「未上画布」，页面菜单提供「放入当前画布」；画布为空但存在页面时给出引导提示。

**影响**：MCP 工具从“能写”升级为“写得稳、错得清、结果可见”。已有单页 `prototype_create_page` 保持兼容，但描述里明确推荐批量工具；`prototype_validate_dsl` 支持 `dsl` 单页与 `dsls` 批量两种入参。
