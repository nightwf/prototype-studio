# Prototype Studio 架构

## 1. 分层

| 层 | 负责 | 不负责 |
|---|---|---|
| Requirement Model | 页面、功能、规则、权限、校验、交互和未明确项 | 具体组件布局 |
| UI DSL | 页面、组件、Overlay、规则和事件的结构 | 任意 CSS 与生产后端 |
| Design System | Token、语义尺寸、Variant 与固定组件外观 | 业务意图推断 |
| Renderer | 确定性地把 DSL 显示为 React 原型 | 调用模型或修改 DSL |
| Command Engine | 校验并增量修改 DSL、产生 Revision | 绕过 baseRevision 覆盖页面 |
| Project Store | 本地文件、历史、审计、监听和迁移 | 云端账号与服务端数据库 |

## 2. 修改链路

所有来源使用同一入口：

```text
属性面板 / 拖动 / AI / MCP / API
→ Command[]
→ baseRevision 检查
→ 执行到内存副本
→ DSL Validator
→ 原子写 pages/*.ui.yaml
→ 追加 .prototype/revisions/{page}/{revision}.json
→ audit.jsonl
→ Renderer / Preview
```

任何一步失败都不修改现有页面文件。`REVISION_CONFLICT` 要求调用方重新读取页面并基于最新 revision 生成命令。

## 3. Preview 隔离

Studio 用 iframe 加载 `/preview-runtime/:pageId`。父窗口只通过同源 `postMessage` 发送 DSL 和选中状态；Preview 回传组件选择与运行事件。Preview 的 CSS、表单状态、Overlay 和 Mock 交互不会污染 Studio。

## 4. 本地文件

`project.yaml` 与业务目录是唯一事实源。`.prototype/index.json`、缓存和运行时状态可以随时重建。历史记录保留完整 Before/After，以换取 MVP 阶段直观、可靠的恢复能力；后续可以在保持格式兼容的前提下压缩历史。

## 5. AI 边界

简单命令由本地 Parser 直接产生。复杂命令通过 `RequirementParserAdapter` / Agent Adapter 输出 Command 或 Change Plan。AI 无权直接返回页面 HTML、改写完整 DSL 或扩大选中 Scope 而不解释影响。

## 6. MCP 边界

Local MCP 默认 stdio，由 Desktop App 或 Codex 作为子进程启动。环境变量显式提供 Project Root；所有路径都必须解析并校验仍在该目录内。stdio 的 stdout 只允许 MCP 协议消息，诊断写 stderr。
