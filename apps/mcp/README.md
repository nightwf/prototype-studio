# Prototype Studio Local MCP Server

`prototype-studio-mcp-server` 是 Prototype Studio 的本地 stdio MCP 服务。它只能访问启动时由 `PROTOTYPE_STUDIO_PROJECT_ROOT` 指定的单个项目；客户端不能在工具参数中切换或逃离该目录。

## 运行

要求 Node.js 20+ 和包含 `project.yaml` 的 Prototype Studio 项目目录。

```bash
pnpm --filter @prototype-studio/mcp build
PROTOTYPE_STUDIO_PROJECT_ROOT="/absolute/path/to/project" \
  node apps/mcp/dist/index.js
```

可选用 `PROTOTYPE_STUDIO_PREVIEW_URL` 指定已运行的 Studio 地址，默认为 `http://127.0.0.1:4173`。MCP 使用 stdio 通信，不会向 stdout 写日志；启动错误只写入 stderr。

Codex MCP 配置示例：

```toml
[mcp_servers.prototype_studio]
command = "node"
args = ["/absolute/path/to/prototype-studio/apps/mcp/dist/index.js"]
env = { PROTOTYPE_STUDIO_PROJECT_ROOT = "/absolute/path/to/project", PROTOTYPE_STUDIO_PREVIEW_URL = "http://127.0.0.1:4173" }
```

## 工具

| 工具 | 作用 |
| --- | --- |
| `prototype_get_project` | 读取项目 manifest 和页面数 |
| `prototype_list_pages` | 按 `limit` / `offset` 分页列出有效页面 |
| `prototype_get_page` | 读取页面摘要与当前 revision |
| `prototype_get_component` | 读取组件、DSL path 和父节点 |
| `prototype_get_dsl` | 读取完整页面 DSL |
| `prototype_get_requirement` | 读取 Markdown/TXT/结构化需求资产，超长内容安全截断 |
| `prototype_get_board` | 读取画布（board.yaml）：全部画布对象、连线与当前 revision |
| `prototype_apply_board_commands` | 原子执行画布命令（对象增删改移、连线增删改），共享版本链并追加画布 Revision |
| `prototype_create_page` | 校验并原子创建页面，不覆盖已有页面 |
| `prototype_delete_page` | revision 检查后移动页面到可恢复回收目录 |
| `prototype_update_component` | 通过 Command Engine 增量更新组件 |
| `prototype_move_component` | 通过 Command Engine 移动组件 |
| `prototype_delete_component` | 通过 Command Engine 删除组件 |
| `prototype_create_overlay` | 创建 modal / drawer / popover |
| `prototype_update_overlay` | 增量更新 Overlay，例如 modal 转 drawer |
| `prototype_apply_commands` | 原子执行多条页面内 Command |
| `prototype_validate_dsl` | 只读校验已有页面或候选 DSL |
| `prototype_get_preview_url` | 返回本地 Preview URL 和 revision |
| `prototype_render_preview` | 校验页面并准备确定性的本地 Preview 路由 |

所有工具都同时返回人类可读的 `text` content 与机器可读的 `structuredContent`。列表响应包含 `total_count` / `has_more` / `next_offset`。

## 安全与一致性

- 工具不接受文件路径，所有读写都被限制在配置的 Project Root。
- 所有输入使用 strict Zod schema，未声明的顶层参数会被拒绝。
- 写操作与 Studio 共用 Project Store、Command Engine 和 Validator。成功写入会进行 `base_revision` 冲突检查、原子写文件、追加 Revision 与审计。
- 错误响应只返回稳定错误码、可执行建议与安全的校验详情，不返回堆栈或内部异常。
- Preview 工具只声明本地可用性，不会伪造公网分享链接。

## 开发验证

```bash
pnpm --filter @prototype-studio/mcp typecheck
pnpm --filter @prototype-studio/mcp build
pnpm --filter @prototype-studio/mcp test
```

单元测试覆盖 Project Root 必填、分页、组件读取、通过共享 Command Engine 写入 Revision、冲突错误、候选 DSL 校验和 Preview URL；真实 stdio 烟测会验证工具发现与项目读取。
