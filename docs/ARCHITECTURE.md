# Prototype Studio 架构

## 1. 分层

| 层 | 负责 | 不负责 |
|---|---|---|
| UI DSL | 页面、组件、Overlay、规则和事件的结构 | 任意 CSS 与生产后端 |
| Board DSL | 独立画布对象、连线、说明与 Revision | 复制页面 DSL |
| Design System | Token、语义尺寸、Variant 与固定组件外观 | 业务意图推断 |
| Renderer | 确定性地把 DSL 显示为 React 原型 | 调用模型或修改 DSL |
| Command Engine | 校验并增量修改 DSL、产生 Revision | 绕过 baseRevision 覆盖页面 |
| Project Store | 本地文件、历史、审计、监听和迁移 | 云端账号与服务端数据库 |

## 1.1 AI 交付链路（Codex / MCP）

```text
需求文档 → Codex 生成 PageDSL 批次
→ prototype_validate_dsl（可选自检）
→ prototype_create_pages（原子校验 + 写入）
→ prototype_place_pages_on_board（默认自动完成：两列铺到默认画布）
→ prototype_get_project 自检 pages_not_on_any_board 是否为空
→ 用户在 Studio 点「同步」看到结果
```

- 页面 = 内容（`pages/*.ui.yaml`）；画布 = 编排（`boards/*.board.yaml`）。AI 交付原型时必须同时产出两者。
- 失败语义：校验错误带 `index/pageId/path/message/suggestion`；revision 冲突带 `currentRevision`；批量操作不留半成品。

- 续跑：`prototype_create_pages` 传 `on_conflict="skip"` 可整批重试而不报错，返回 `skipped_page_ids` 标明已存在的页面。
- 组件级编辑：`prototype_create_overlay` / `prototype_update_overlay` / `prototype_update_component` / `prototype_move_component` / `prototype_delete_component`，均需 `base_revision`。

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

流程图和 ER 图的交互编辑器按需加载 React Flow，仅在全屏草稿中保存临时交互状态。Board DSL 仍是唯一事实源；外层画布、分享和 HTML 导出使用纯 React/SVG 预览，不依赖交互编辑器也不请求第三方服务。

## 4. 本地文件

`project.yaml`、`pages/` 与 `boards/` 是唯一事实源。页面是项目级公共资产，画布只引用 pageId。每个画布的历史写入 `.prototype/revisions/boards/{boardId}/`；缓存和运行时状态可以随时重建。

## 5. AI 边界

简单命令由页面直接操作产生。复杂需求由 Codex 在对话中理解：先展示拟拆分画布、范围、页面与共享页面，得到用户确认后才通过 MCP 写入。Studio 不保存或解析原始需求文档。

## 6. MCP 边界

Local MCP 默认 stdio，由 Desktop App 或 Codex 作为子进程启动。环境变量显式提供 Project Root；所有路径都必须解析并校验仍在该目录内。stdio 的 stdout 只允许 MCP 协议消息，诊断写 stderr。
