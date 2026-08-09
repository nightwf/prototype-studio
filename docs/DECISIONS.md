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
