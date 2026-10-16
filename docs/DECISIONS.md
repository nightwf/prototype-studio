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

## ADR-010：补齐 AI 编辑能力与续跑体验（已实现）

**背景**：ADR-009 解决了“写得稳”，但仍有四处缺口：云端 MCP 缺少组件级精细编辑工具（只能手写通用命令）；跨多批生成时无法断点续跑；用户回到窗口后看不到 AI 的新产出；页面预览与画布导出的一致性没有回归保护。

**决策**：

1. **组件级工具与桌面端对齐**：云端 MCP 新增 `prototype_create_overlay`、`prototype_update_overlay`、`prototype_update_component`、`prototype_move_component`、`prototype_delete_component`，全部走 Command Engine（revision 校验 + 审计），避免 AI 手写命令结构出错。
2. **断点续跑**：`prototype_create_pages` 新增 `on_conflict`（`fail` 默认 / `skip`）。`skip` 会跳过已存在页面并返回 `skipped_page_ids`，因此整批重试天然幂等，跨多批生成可以安全续跑。
3. **回到窗口自动同步**：Studio 网页端在窗口重新聚焦/可见时静默拉取服务端状态（8 秒节流），AI 在外部生成的内容自动出现；顶栏「同步」按钮保留用于手动强制刷新。
4. **一致性回归**：新增导出一致性测试，覆盖页面、说明、标注、流程图、ER 图、图片、组件七类画布对象 + 页面内嵌渲染，断言不落入通用降级卡片；页面预览与画布导出共用同一份 PageDSL 与 Renderer。

## ADR-011：页面内自建线框页（已实现）

**背景**：已有页面全部由 AI 生成，小需求改一点就要走一轮生成，成本高；用户希望像 Axure 一样自己在系统里画几笔示意（矩形、图标、表格骨架等），但**不希望在画布上画**——画布继续只负责「页面组合 + 备注」。

**决策**：

1. **位置固定**：线框画在**页面**里，新增页面类型 `wireframe`；画布语义不变，线框页只是众多页面类型中的一种。
2. **数据即 DSL**：`PageDSL.wireframe = { width, height, background, elements[] }`，编辑器只读写这份结构化数据，不保存 React Flow 之类的编辑器私有状态，也不引入外部绘图服务。
3. **一次手势一次 Revision**：新增 `SET_WIREFRAME` 命令整块替换线框内容，走同一套 Command Engine（baseRevision 校验 + 审计 + 撤销/重做），刷新与冲突处理与其它页面完全一致。
4. **渲染单一入口**：`PrototypeRenderer` 遇到线框页走 `WireframeRenderer`，因此页面预览、画布内嵌、导出 HTML、分享链接零改动自动支持。
5. **画布摆放自适应**：线框页加入画布时对象尺寸取画板尺寸，避免固定画板在 960 × 640 对象里出现滚动条。
6. **第一版范围**：只做静态绘制（15 种元件、拖动/框选/缩放/对齐/快捷键/检查器/画板尺寸预设），不做运行期交互、不做 Mermaid、不接 diagrams.net。
7. **Codex 可续写**：`prototype_create_page` 支持直接生成线框 DSL 初稿，`prototype_apply_commands` 新增 `SET_WIREFRAME`，让人和 AI 编辑的是同一份数据。

**影响**：小需求可以在 Studio 里几分钟画完，不再必须走 AI 生成；同时线框页与结构化页面共享版本、撤销、导出与分享能力，不产生第二套内容体系。

## ADR-012：线框页图片内嵌与请求体上限（已实现）

**背景**：线框页的图片框需要能直接上传本机图片。图片以 data URL 存进 `wireframe.elements[].src`，而云端 `POST /commands` 走 Fastify 默认 1MB 请求体上限——一张 1600px 的 PNG 就可能超过，保存失败时前端只会看到一句“修改未执行”，用户无法判断是图片的问题。

**决策**：

1. **上传入口**：在画板上双击图片框即可选择本机图片（编辑器的属性面板同时提供“上传/替换/移除”按钮，保证可发现性）。
2. **前端压缩**：长边压到 1600px；PNG 保持 PNG（截图清晰），其它格式转 JPEG 0.86；超过 2.6MB 时提示体积偏大。
3. **失败必须可见**：`SET_WIREFRAME` 提交失败时回滚本地预览，并明确提示“图片保存失败，页面没有写入服务端”，不再让用户面对静默失效。
4. **服务端上限**：Fastify 请求体上限提升到 32MB。页面/画布本来就把图片以 data URL 内嵌，1MB 上限会让大图保存静默失败，这个限制与既有画布图片能力也冲突。
5. **回归保护**：新增用例覆盖“1MB 以上图片可写入并原样读回”与“用 SET_WIREFRAME 给已有线框页补图片”，并验证过把上限改回 1MB 时该用例会失败。

**影响**：图片能力可用且失败可见；代价是页面 YAML 会随图片变大，后续如需进一步优化应改为文件存储 + 引用（不在本期范围）。

