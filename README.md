# Prototype Studio

> AI 生成原型只完成了 30%——剩下的标注、说明、流程图、ER 图，以及"改原型"这件麻烦事，Prototype Studio 用一个专门的工作台帮你补齐，最终沉淀成一份可评审、可交接的需求方案。

Prototype Studio 是面向后台管理类 Web 系统的**多画布原型工作台**。它把「AI 生成原型」和「人工完善需求方案」打通：AI 负责把需求变成第一版页面，你在这个工作台里补充标注、说明、页面关系、流程图、ER 图，并随时精确修改原型。所有内容（页面、画布、标注、版本）都保存在可读、可复制、可 Git 管理的项目中；UI DSL 是唯一事实源，React 页面只是确定性的渲染结果。

## 为什么做这个项目

用 AI 生成 HTML 原型很快，但真正用起来有两个绕不开的痛点：

- **改起来麻烦**——让 AI 改一个按钮，它常常把整个页面重画一遍；对话里说不清"改哪里"。
- **标注麻烦**——后台原型的每个按钮、字段、状态、交互都需要说明；高保真原型也演不出"为什么"，最后产品经理还是回到截图 + 标注。

Prototype Studio 的思路：**AI 出第一版，工作台补全剩余部分。**

## ✨ 核心特性

- **AI 出第一版，工作台补全**：页面原型生成后，在画布上直接补充标注（可挂靠到具体组件）、说明、页面关系。
- **流程图 / ER 图 / 页面连线**：同一个画布里完成页面关系、业务流程、数据模型；连线支持拖动拐点调整形状。
- **改原型不靠重新生成**：点选组件直接改属性；框选对象生成精确指令交给 Codex 修改；每次修改留版本，可 Diff、可回退。
- **多画布 + 页面公共资产**：一个项目多个画布，页面可同时出现在不同画布，画页面关系图不用切工具。
- **可交互 Preview**：查询、重置、表格多选、弹窗抽屉、必填校验和提交反馈都能真跑，不是静态图。
- **导出与分享**：导出单文件 HTML（可含标注汇总）；发布只读分享链接，可设有效期。
- **Codex / MCP 无缝接入**：本地或云端 MCP，框选对象自动生成精确修改指令，AI 改原型定位准确不瞎猜。

## 🚀 快速开始

### 在线体验

无需安装，浏览器打开：

- 体验地址：<http://49.234.4.212:8787/>
- 注册邀请码：`PROTOTYPE-PUBLIC`

### 本地开发

要求 Node.js 20+ 和 pnpm 10+。

```bash
pnpm install
pnpm dev
```

浏览器打开 <http://localhost:4173>。仓库自带「案件中台」示例项目，位于 `examples/case-management`。

### 验证

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## 🧠 核心理念

1. **UI DSL 是唯一事实源**：页面、画布、标注都是结构化 DSL；React 只是渲染结果，AI 只能生成结构化命令，不能重写整页。
2. **AI 与渲染器分离**：同一份 DSL 永远渲染出同一页面，可复现、可回归。
3. **所有修改统一进 Command Engine**：点选、拖拽、AI、MCP 都走同一链路——baseRevision 并发检查 → 校验 → 原子写入 → 追加 Revision。
4. **本地优先、项目可迁移**：完整项目目录可复制、压缩、Git 管理；缓存可重建，不依赖云端。

## 🏗️ 架构

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

- `packages/dsl-schema`：DSL Spec 类型、JSON Schema 和示例。
- `packages/dsl-validator`：结构、引用、ID、事件和条件校验。
- `packages/command-engine`：结构化命令、并发检查、Diff、撤销重做。
- `packages/project-store`：项目目录、原子写入、历史、审计、File Watcher。
- `packages/design-system`：语义 Token 与基础控件。
- `packages/renderer`：确定性渲染器与交互式 Preview。
- `apps/studio`：Studio 编辑器与独立 Preview 页面。
- `apps/mcp`：Local MCP Server。
- `apps/web-server`：网页端服务（多项目空间、云端 MCP、分享、导出）。

## 📦 本地项目格式

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

## 🤖 MCP / Codex 接入

### 本地项目（stdio）

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

### 云端项目（HTTP）

在网页端设置页复制 Codex / WorkBuddy 连接提示词，粘贴给对应 AI 即可自动配置（Bearer Token 认证）。

## 📚 文档

- [架构文档](docs/ARCHITECTURE.md)
- [DSL Spec](docs/DSL_SPEC_1.0.md)
- [部署指南](docs/DEPLOY.md)
- [使用指南](docs/USER_GUIDE.md)
- [架构决策](docs/DECISIONS.md)

## 🤝 参与贡献

欢迎通过 Issue 反馈问题、提建议，或提交 Pull Request。开发前请先运行 `pnpm typecheck && pnpm lint && pnpm test` 保证质量。

## 📄 License

[MIT](LICENSE)
