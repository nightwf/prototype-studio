# Prototype Studio 项目实现 Goal（评审稿）

你是一名兼具产品架构、桌面应用、React/TypeScript、DSL 设计、版本系统和 MCP 集成能力的资深工程负责人。请在当前 `prototype studio` 目录中，依据 `prototype-studio-prd-v1.1-local-first.md`，从零设计并实现一个真正可运行、可验证、可继续迭代的 **Prototype Studio Local-first MVP**。不要只输出方案、静态页面或概念 Demo；目标是交付核心链路真实贯通的本地桌面产品。

## 1. 产品目标

Prototype Studio 是面向产品经理和研发人员的 AI 原生需求与原型表达工具，首期聚焦后台管理类 Web 系统。它要把：

```text
需求文档 / 自然语言
→ Requirement Model
→ Page Plan
→ UI DSL
→ Validator
→ 确定性 Renderer
→ 可交互 Preview
```

串成可工作的产品闭环，并允许用户通过组件点选、属性编辑、拖动排序、Codex/MCP 等方式，对同一份本地 UI DSL 做安全的增量修改。

核心不是“AI 生成 HTML”，而是建立一份机器和人都能消费的 **Executable Product Specification（可执行产品规格）**。

## 2. 不可破坏的原则

1. **UI DSL 是原型唯一事实源**；HTML/React 只是渲染结果，禁止把生成后的页面代码作为主要编辑资产。
2. **AI 与 Renderer 分离**；Renderer 不能调用 AI。同一 DSL、Renderer 版本和 Design System 版本必须得到确定性一致的 UI。
3. **Requirement Model、UI DSL、Design System、Renderer 分层**：分别回答“做什么、如何组织、长什么样、如何显示”。
4. **所有修改统一进入 Command Engine**：属性面板、拖拽、AI、MCP、外部工具不得各自直接改业务状态。
5. **简单操作不调用 AI**：Label、Required、Visible、Size、Variant、默认值、组件顺序、删除、Modal/Drawer 类型等直接产生结构化 Command。
6. **AI 只能返回结构化 Command 或 Change Plan**，禁止用 AI 重写完整 HTML 或完整页面 DSL。多节点修改先展示影响范围，确认后执行。
7. **每次成功修改都产生不可覆盖的追加式 Revision**，支持 Diff、Undo、Redo、来源记录与审计；Undo/Redo 也要保留历史，不能抹除 revision。
8. **Local-first 优先级最高**：本地文件是可迁移事实源。不得引入 PostgreSQL、Redis、S3、Docker、云端账号或服务端项目存储作为 MVP 运行前提。
9. **项目可迁移**：完整目录可以复制、压缩、Git Push、NAS/网盘同步，并能在另一台电脑直接打开；任何索引或缓存都必须可由项目文件重建。
10. **原型不等于生产代码**：本项目负责结构化产品规格和原型，不负责生成正式业务后端或生产数据库。

若 PRD 前后存在冲突，以 V1.1 的 `76. MVP边界` 与 `84A–84G Local-first` 增补章节为最高优先级，并把采用的解释记录在项目文档中。

## 3. MVP 必须交付的核心闭环

### A. 本地项目与桌面体验

- 使用 Tauri + React + TypeScript 构建 macOS/Windows 桌面应用，建议采用 pnpm workspace/monorepo。
- 支持选择 Workspace、创建项目、打开已有项目目录。
- 新项目自动生成 `project.yaml`、`requirements/`、`pages/`、`data/`、`flows/`、`assets/`、`.prototype/`；可选初始化 Git。
- Studio 布局包含顶部项目区、左侧页面树、中部 iframe Preview、右侧属性面板、底部 AI Command 区。
- File Watcher 监听上述业务目录的新增、修改、重命名和删除，做防抖、重读、校验、页面树更新与 Preview 刷新。外部把 DSL 改坏时保留最后一个有效 Preview，并显示精确错误位置。

### B. DSL、校验与确定性渲染

- 内部统一 JSON Object，项目文件优先用易读、可 Git Diff 的 YAML。
- 先完成 DSL Spec 1.0、TypeScript 类型、JSON Schema 和自定义 Validator。
- 首期重点支持 `list`、`detail`、`form` 页面；支持后台系统常见的 Input、Select、Number、Date、DateTime、Radio、Checkbox、Switch、Textarea、Button、Table、Tabs、Card、Description、Form、Modal、Drawer。
- Overlay 统一建模并至少覆盖 modal、drawer、popover；支持 PRD 中规定的 Event、Condition、Validation 与 UI Permission 表达。
- 普通 DSL 使用 size、variant、density 等语义属性，不接受散落的自由 CSS。
- 每个可选节点有稳定、唯一、与 Label 解耦的 componentId，并能映射到精确 DSLPath。
- Renderer 使用固定组件映射和 Design Token；组件局部渲染失败不能拖垮 Studio。
- Preview Runtime 独立运行，通过安全的 iframe/postMessage 协议向 Studio 上报 componentId、pageId 和选中状态，并支持 open/close、navigate、submit、refresh 等可演示 Mock 交互。

### C. 编辑、命令、版本与撤销

- 页面树支持页面创建、删除、重命名、排序、切换。
- 点选 Preview 组件后，属性面板展示类型、DSLPath、父级/兄弟关系及适用属性。
- 修改基础属性实时生成 Command，经校验后更新 DSL 和 Preview，不调用 AI。
- 支持同容器拖动排序，生成 MOVE_COMPONENT。
- 至少实现 PRD 中列出的页面、组件、Overlay、Rule、Event Command，并统一执行：

```text
baseRevision 检查
→ Command 校验
→ DSL Patch
→ DSL 校验
→ 写入文件
→ 追加 Revision
→ Renderer
→ Preview 刷新
```

- revision 不匹配时拒绝覆盖，并返回明确的 `REVISION_CONFLICT`。
- 提供可理解的 DSL Diff、Undo、Redo、修改来源和影响组件列表。

### D. 需求到原型

- 支持粘贴文本、Markdown 和 TXT 需求导入；DOCX/PDF 使用可靠的本地解析方案，无法解析或遇到扫描件时明确提示，不伪造结果。
- 将非结构化需求解析为独立 Requirement Model，至少包括页面、功能、业务规则、权限、校验、交互和未明确项。
- 所有解析项区分 `Explicit`、`Inferred`、`Default`，AI 推断不得伪装成原始需求。
- 多页面需求先展示可确认的 Page Plan，再逐页生成 DSL；不要一次性生成不可控的大块 DSL。
- AI/模型能力通过可替换 Adapter 隔离。V1 主链路优先采用 **Studio + Local MCP + 外部 Codex**；没有可用模型或凭据时，核心编辑、渲染、校验、版本功能仍须完整可用，并提供清晰连接指引。

### E. Local MCP 与开发交接

- 实现由桌面应用管理生命周期、限制在当前 Project Root 的本地 MCP Server，优先 stdio，必要时再支持 localhost HTTP。
- 至少打通：项目/页面/组件/DSL/需求读取，页面与组件增删改移，Overlay 修改，apply_commands，validate_dsl，render_preview，get_preview_url。
- MCP 写操作必须与 Studio 共用 Command Engine、Revision 和 Validator，不能另开后门直接覆盖 DSL。
- 设置中展示 MCP 状态、Project Scope、复制 Codex 配置和测试连接。
- 支持导出 Product Package，包含 requirement、UI DSL、business rules、pages、flows、Design System 引用、acceptance criteria 和可用的本地预览信息。

纯 Local-first MVP 不具备真正公网 `AnyoneWithLink` 的前提。先实现本机预览、可迁移导出或明确标注的局域网临时访问；不要用一个不可访问的假公网链接冒充分享完成。云端分享留作后续 Cloud Sync Layer。

## 4. 交互与视觉质量

- 目标用户是产品经理，不要求其理解代码、Schema 或命令行；关键操作要有空状态、进行中、成功、错误、撤销与恢复反馈。
- 整体是专业、克制、高信息密度的桌面生产力工具，优先可读性、稳定性与编辑效率，不做花哨营销页风格。
- 初次启动必须能引导用户在数分钟内创建/打开项目并看到一个可操作示例。
- 选中组件、保存状态、外部文件变化、校验失败、Revision 冲突、MCP 连接状态都要有明确可见反馈。
- 提供一个“案件管理/批量分配”示例项目，覆盖列表、搜索、表格、多选、Modal→Drawer、表单校验、Mock 数据和基础交互，作为端到端验收样例。

## 5. 实施方式

先阅读完整 PRD 和现有目录，建立需求覆盖矩阵与架构决策记录，再开始编码。按“可运行垂直切片”推进，而不是先铺大量空壳：

1. 项目目录 + DSL/Schema/Validator + 示例 DSL。
2. Design System + Renderer + 独立 Preview。
3. Studio 页面树 + 点选 + 属性编辑 + 文件写回。
4. Command Engine + Revision + Diff + Undo/Redo + 冲突处理。
5. File Watcher + 外部编辑容错。
6. Requirement 导入/解析 + Page Plan + DSL 生成适配层。
7. Local MCP + Codex 联调。
8. Tauri 打包、首次启动、示例项目、Product Package 与端到端收尾。

每完成一个切片，都要实际运行、测试并留下可重复的验证方式；发现 PRD 未定义之处时，优先做不扩大产品边界的合理假设，将假设写入决策记录后继续。不要因为可以搭 Mock UI 就跳过核心数据链路，也不要为了“完成全部功能”而牺牲基本可用性。

## 6. 工程质量要求

- 核心 DSL、Validator、Command Engine、Revision 和 Renderer 必须有单元测试；关键用户链路有集成或端到端测试。
- 对 schema/reference/duplicate ID/unknown component/event target 等错误提供稳定错误码和定位信息。
- 普通 DSL 写入到 Preview 刷新目标 P95 < 500ms；普通页面打开目标 P95 < 2s，不含 AI 处理。
- 避免超大组件和跨层耦合；核心包可独立测试和复用，AI Provider 不得渗入 Engine/Renderer。
- 保持类型安全、格式化、lint、构建和测试通过；不要提交密钥、临时文件、大型缓存或依赖目录。
- 在 README 中说明安装、开发、测试、打包、示例项目、Codex/MCP 接入、文件格式、已知限制和恢复方式。

## 7. 最终验收标准（Definition of Done）

只有同时满足以下条件，才可宣告 MVP 完成：

1. 全新用户可以安装/启动桌面应用，创建或打开一个完全本地的项目目录。
2. 示例需求可以形成 Requirement Model、Page Plan 和至少一个可运行后台页面原型。
3. 同一 DSL 在相同版本下重复渲染，页面结构和视觉结果一致。
4. Preview 任意受支持组件可点选，并准确回传 componentId、pageId、DSLPath。
5. Label、Required、Visible、Size、Variant 修改无需 AI，能实时写回 DSL 并刷新 Preview。
6. Modal → Drawer 通过结构化 Command 完成，不重写整个页面 DSL。
7. 错误修改可以 Undo，Undo 后 DSL 与 Preview 一致恢复；Redo、Diff 和审计记录可用。
8. 外部编辑合法 DSL 会自动刷新；非法 DSL 不覆盖最后有效预览，并给出可定位错误。
9. MCP 客户端可以读取项目/页面/组件，更新组件、校验 DSL 并取得可用 Preview URL；所有写入共享同一版本链。
10. 项目复制到另一目录或另一台机器后，无需原机器数据库即可重新打开。
11. 核心测试、lint、构建和至少一个桌面平台的打包验证通过，关键流程有证据可复现。
12. 所有未完成项、降级实现和已知限制被明确记录，不以静态 UI、假数据接口或占位按钮冒充完成。

请持续推进直到上述核心闭环真实可用。每个阶段都以“用户能完成什么”和“如何验证”为汇报重点；只有遇到会显著改变产品方向、需要外部账号/密钥、或无法从 PRD 合理推断的关键决策时，才暂停请求产品经理确认。
