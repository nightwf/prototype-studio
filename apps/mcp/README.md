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
| `prototype_list_boards` | 分页列出画布、对象/页面数量、Revision 与默认标识 |
| `prototype_get_board` | 按 `board_id` 读取完整画布 |
| `prototype_create_board` | 创建空白画布或从已有公共页面创建画布 |
| `prototype_create_boards` | 用户确认拆分方案后，整体校验并批量创建画布 |
| `prototype_update_board` | 重命名、修改说明或设为默认画布 |
| `prototype_delete_board` | 把画布与 Revision 移入可恢复回收站 |
| `prototype_apply_board_commands` | 按 `board_id` 原子执行画布命令并追加独立 Revision |
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
- 每个画布使用独立的 Revision 基线；处理多需求文档时，Codex 必须先展示拟建画布清单并获得用户确认，再调用批量创建工具。
- Codex 可通过 `prototype_apply_board_commands` 写入结构化 `flowchart` / `er` 对象；坐标可省略，Studio 会使用确定性布局，用户随后可在内置独立编辑器中继续拖动。
- 图形编辑器不使用 diagrams.net iframe 或其他外部图形服务，图数据始终保存在 Board DSL 中。
- 错误响应只返回稳定错误码、可执行建议与安全的校验详情，不返回堆栈或内部异常。
- Preview 工具只声明本地可用性，不会伪造公网分享链接。

## 开发验证

```bash
pnpm --filter @prototype-studio/mcp typecheck
pnpm --filter @prototype-studio/mcp build
pnpm --filter @prototype-studio/mcp test
```

单元测试覆盖 Project Root 必填、分页、组件读取、通过共享 Command Engine 写入 Revision、冲突错误、候选 DSL 校验和 Preview URL；真实 stdio 烟测会验证工具发现与项目读取。
