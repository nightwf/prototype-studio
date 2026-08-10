# Prototype Studio

Prototype Studio 是面向后台管理类 Web 系统的多画布原型工作台。页面、画布、交互和版本都保存在可读、可复制、可 Git 管理的项目目录中；UI DSL 是唯一事实源，React 页面只是确定性渲染结果。

> 当前阶段：多画布 v2 已实现。DSL、Validator、Command/Revision、Project Store、Renderer、Preview Runtime、Web API 与 MCP 共用同一套存储和版本规则。

> **网页端**：本仓库是纯网页端版本（云托管、多项目空间、浏览器编辑、云端 MCP、只读分享、导出导入）。原桌面项目在 `prototype studio` 目录，保持可构建、随时可用。

## 网页端快速启动

```bash
pnpm install
pnpm --filter @prototype-studio/web-server build
PORT=8787 SPACES_DIR=./data/spaces INVITE_CODES=PROTOTYPE-DEV node apps/web-server/dist/main.cjs
# 另开终端
VITE_WEB_API=http://127.0.0.1:8787 pnpm --filter @prototype-studio/studio dev
```

浏览器打开 vite 输出端口，用邀请码 `PROTOTYPE-DEV` 注册登录。生产部署前先把 `.env.example` 复制为服务器上的 `.env.production` 并填写真实配置，再执行 `bash scripts/deploy.sh`。验收清单见 `docs/WEB_ACCEPTANCE.md`。

## 现在可以体验什么

- 打开专业桌面工作台和独立 iframe Preview。
- 点击任意受支持组件，准确回传 `componentId` 和 DSL 路径。
- 在属性面板直接修改 Label、Required、Visible、Disabled、Size 等属性，不调用 AI。
- 在左侧组件大纲拖动查询字段，生成 `MOVE_COMPONENT`。
- 输入“改成必填”“改成抽屉”“名称改成…”等命令，得到结构化 Command。
- 每次修改产生 Revision；查看 DSL Diff，并用追加式 Revision 撤销/重做。
- 在 Preview 中运行查询、重置、表格多选、Modal/Drawer、必填校验和提交反馈。
- 创建、打开和迁移本地项目；YAML 页面文件、历史与审计均可独立恢复。
- 一个项目创建多个独立画布；页面作为项目级公共资产，可同时出现在多个画布中。
- 从空白或已选页面创建画布，重命名、修改说明、设为默认并移入回收站。
- 导出当前画布或带导航的全部画布 HTML，分享页可只读切换画布。
- 双击流程图或 ER 图进入全屏可视化编辑器，支持拖动、连线、字段级关系、撤销重做和自动布局。

## 快速启动

要求 Node.js 20+ 和 pnpm 10+。

```bash
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:4173`。仓库自带的“案件中台”项目位于 `examples/case-management`。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
python scripts/e2e_studio.py
```

端到端脚本需要 Playwright Chromium，并要求 Studio 已运行在 4173 端口：

```bash
python -m playwright install chromium
```

## 架构

```text
Studio / Codex / MCP
                 │
                 ▼
            Command Engine
                 │
       baseRevision + Validator
                 │
                 ▼
       pages/*.ui.yaml + Revision
                 │
                 ▼
      Deterministic React Renderer
                 │
                 ▼
         iframe Preview Runtime
```

关键包：

- `packages/dsl-schema`：DSL Spec 1.0 类型、JSON Schema 和案件示例。
- `packages/dsl-validator`：Schema、引用、ID、组件、事件和条件校验。
- `packages/command-engine`：结构化 Command、并发检查、Diff、Undo/Redo。
- `packages/project-store`：项目目录、原子 YAML 写入、历史、审计、File Watcher 和 Product Package。
- `packages/design-system`：语义 Token 与 Studio 基础控件。
- `packages/renderer`：固定组件映射和交互式 Preview Runtime。
- `apps/studio`：Studio 编辑器与独立 Preview 页面。
- `apps/mcp`：Local MCP Server。
- `_archive/desktop`：早期 Tauri 桌面壳归档，不属于当前 workspace 构建。

更详细说明见 [架构文档](docs/ARCHITECTURE.md)、[DSL Spec](docs/DSL_SPEC_1.0.md) 和 [架构决策](docs/DECISIONS.md)。

## 本地项目格式

```text
project.yaml
pages/
boards/
  main.board.yaml
data/
flows/
assets/
.prototype/
  revisions/boards/{boardId}/
  trash/boards/
  audit.jsonl
  cache/
```

`project.yaml` 使用 `projectFormatVersion: 2` 和 `defaultBoardId`。`.prototype/cache/` 只保存可重建缓存，删除缓存不会破坏项目。

## MCP / Codex

Local MCP 使用 stdio，Project Root 通过环境变量显式传入。构建 MCP 后，配置结构如下：

```json
{
  "mcpServers": {
    "prototype-studio": {
      "command": "node",
      "args": ["/absolute/path/to/prototype-studio/apps/mcp/dist/index.js"],
      "env": {
        "PROTOTYPE_STUDIO_PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

所有 MCP 写操作与 Studio 共用 Command Engine、Validator 和 Revision，不提供绕过版本链的整页覆盖工具。

## 桌面归档

早期 Tauri 桌面壳保存在 `_archive/desktop`，仅用于历史参考，不属于当前网页端 workspace 和生产构建。当前维护主线为 Studio、Web Server 和 MCP。

## 已知边界

- 当前目标只覆盖后台管理类 Web 原型，不是 Figma、自由画布或生产代码生成器。
- Local-first 版本提供本机 Preview 与可迁移 Product Package，不伪造公网 `AnyoneWithLink`。
- DOCX、PDF、OCR 等文档只在 Codex 对话中读取。Codex 先展示画布拆分方案，用户确认后再通过 MCP 创建或复用公共页面并批量创建画布；Studio 不保存或解析文档。
- Studio 内部复杂 AI 命令通过 Adapter 预留，V1 推荐外部 Codex + Local MCP。
- DSL 权限只表达产品规格，不替代生产系统的后端鉴权。

## 恢复与可靠性

- 非法外部 DSL 不进入有效页面索引，也不会覆盖最后有效 Preview。
- 每次写入采用临时文件 + 原子替换。
- Revision 文件不可覆盖；Undo/Redo 继续创建新 Revision。
- 删除 `.prototype/cache/` 后可从项目文件重建索引。
- 删除页面默认移动到 `.prototype/trash/`，避免不可恢复删除。
