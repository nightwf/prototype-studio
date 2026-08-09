# Prototype Studio

Prototype Studio 是面向后台管理类 Web 系统的本地优先需求与原型工作台。需求、页面、交互和版本都保存在可读、可复制、可 Git 管理的项目目录中；UI DSL 是唯一事实源，React 页面只是确定性渲染结果。

> 当前阶段：Local-first MVP 持续实现中。DSL、Validator、Command/Revision、Project Store、Requirement Engine、Renderer、Preview Runtime 与 Studio 编辑闭环已经可运行；桌面与 MCP 集成在同一仓库内继续收口。

> **网页端**：本仓库是纯网页端版本（云托管、多项目空间、浏览器编辑、云端 MCP、只读分享、导出导入）。原桌面项目在 `prototype studio` 目录，保持可构建、随时可用。

## 网页端快速启动

```bash
pnpm install
pnpm --filter @prototype-studio/web-server build
PORT=8787 SPACES_DIR=./data/spaces INVITE_CODES=PROTOTYPE-DEV node apps/web-server/dist/main.cjs
# 另开终端
VITE_WEB_API=http://127.0.0.1:8787 pnpm --filter @prototype-studio/studio dev
```

浏览器打开 vite 输出端口，用邀请码 `PROTOTYPE-DEV` 注册登录。生产部署：`docker compose up -d`（自动迁移 PostgreSQL 元数据，项目文件存数据卷）。验收清单见 `docs/WEB_ACCEPTANCE.md`。

## 现在可以体验什么

- 打开专业桌面工作台和独立 iframe Preview。
- 点击任意受支持组件，准确回传 `componentId` 和 DSL 路径。
- 在属性面板直接修改 Label、Required、Visible、Disabled、Size 等属性，不调用 AI。
- 在左侧组件大纲拖动查询字段，生成 `MOVE_COMPONENT`。
- 输入“改成必填”“改成抽屉”“名称改成…”等命令，得到结构化 Command。
- 每次修改产生 Revision；查看 DSL Diff，并用追加式 Revision 撤销/重做。
- 在 Preview 中运行查询、重置、表格多选、Modal/Drawer、必填校验和提交反馈。
- 创建、打开和迁移本地项目；YAML 页面文件、历史与审计均可独立恢复。
- 接收 Codex 整理后的结构化页面模板（显式页面类型、查询字段、表格列、表单字段与校验规则）或规范需求文本，按声明确定性生成 DSL，并区分 Explicit、Inferred、Default。

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
pnpm build:desktop
python scripts/e2e_studio.py
```

端到端脚本需要 Playwright Chromium，并要求 Studio 已运行在 4173 端口：

```bash
python -m playwright install chromium
```

## 架构

```text
Requirement / Studio / Codex / MCP
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
- `packages/requirement-engine`：需求输入、Adapter、本地 fallback、Page Plan 与 DSL 生成。
- `apps/studio`：Studio 编辑器与独立 Preview 页面。
- `apps/mcp`：Local MCP Server。
- `apps/desktop`：Tauri 桌面壳。

更详细说明见 [架构文档](docs/ARCHITECTURE.md)、[DSL Spec](docs/DSL_SPEC_1.0.md) 和 [架构决策](docs/DECISIONS.md)。

## 本地项目格式

```text
project.yaml
requirements/
pages/
data/
flows/
assets/
.prototype/
  revisions/
  audit.jsonl
  cache/
```

`.prototype/cache/` 只保存可重建缓存。删除缓存不会破坏项目；页面与需求文件始终足以在另一台电脑重新打开项目。

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

## 桌面构建

桌面壳使用 Tauri 2，需要 Rust stable 和平台原生构建工具。`pnpm build:desktop` 会先把 Local MCP 编译为当前平台的独立 sidecar，再生成桌面应用。Web UI 可以在未安装 Rust 时独立开发和测试；正式桌面打包说明见 `apps/desktop/README.md`。

## 已知边界

- 当前目标只覆盖后台管理类 Web 原型，不是 Figma、自由画布或生产代码生成器。
- Local-first 版本提供本机 Preview 与可迁移 Product Package，不伪造公网 `AnyoneWithLink`。
- DOCX、PDF、OCR 等原始文档处理由 Codex 负责；Studio 消费其整理后的结构化页面模板或 Requirement Model，不内置重复的文档解析链路。
- Studio 内部复杂 AI 命令通过 Adapter 预留，V1 推荐外部 Codex + Local MCP。
- DSL 权限只表达产品规格，不替代生产系统的后端鉴权。

## 恢复与可靠性

- 非法外部 DSL 不进入有效页面索引，也不会覆盖最后有效 Preview。
- 每次写入采用临时文件 + 原子替换。
- Revision 文件不可覆盖；Undo/Redo 继续创建新 Revision。
- 删除 `.prototype/cache/` 后可从项目文件重建索引。
- 删除页面默认移动到 `.prototype/trash/`，避免不可恢复删除。
