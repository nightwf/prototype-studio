# Prototype Studio Desktop

`apps/desktop` 是 Prototype Studio 的 Tauri 2 桌面容器。它在开发时连接 `apps/studio` 的 Vite 服务，打包时使用 `apps/studio/dist`。桌面层只负责本地项目授权、受限文件访问、文件变化通知和 Local MCP 进程生命周期；UI DSL 的业务修改仍应进入共享 Command Engine。

## 开发与打包

前置条件：

- Node.js 和 pnpm
- Rust 1.77.2 或更新版本
- macOS 上的 Xcode Command Line Tools，或 Windows 上的 Microsoft C++ Build Tools/WebView2

在仓库根目录安装 workspace 依赖后，运行：

```sh
pnpm --dir apps/desktop dev
```

Tauri 会先在 `http://localhost:4173` 启动 Studio。生成当前平台桌面应用（macOS 为 `.app`）：

```sh
pnpm --dir apps/desktop build
```

macOS DMG 可尝试：

```sh
pnpm --dir apps/desktop build:dmg
```

部分无 Finder 自动化权限的构建环境会在 DMG 美化步骤失败，但 `.app` 已完成。此时可用 `hdiutil create -srcfolder` 将已验证的 `.app` 封装为普通 UDZO DMG。

只检查 Rust 桌面层：

```sh
pnpm --dir apps/desktop check
```

## 前端可调用的命令

命令通过 `@tauri-apps/api/core` 的 `invoke` 调用。参数名使用 camelCase。

| 命令 | 作用 |
| --- | --- |
| `select_project_folder` | 显示系统目录选择器，验证 `project.yaml` 并将目录设为当前 Project Root |
| `open_project_folder` | 打开已知路径；仅用于用户明确选择或桌面端恢复的项目路径 |
| `create_project` | 让用户选择父目录，并创建标准本地项目结构 |
| `close_project` | 停止文件监听和 MCP，清除当前 Project Root |
| `read_project_yaml` | 读取当前 Project Root 下的 `project.yaml` |
| `read_page_yaml` | 按受限 `pageId` 读取 `pages/<pageId>.ui.yaml` |
| `write_page_yaml` | 基础 YAML/身份校验后安全覆盖对应页面文件 |
| `start_project_watcher` | 监听 `project.yaml` 和 `pages/*.ui.yaml` |
| `stop_project_watcher` | 停止当前文件监听器 |
| `start_local_mcp` | 启动打包资源中的固定 `bin/prototype-mcp` sidecar |
| `stop_local_mcp` | 停止由 Desktop 启动的 Local MCP |
| `local_mcp_status` | 返回 `stopped` / `running` 等生命周期状态 |

例如：

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const project = await invoke("select_project_folder");
await invoke("start_project_watcher");

const dispose = await listen("project-file-changed", ({ payload }) => {
  console.log(payload); // { kind: "change", relativePath: "pages/order-list.ui.yaml" }
});
```

`create_project` 参数示例：

```ts
await invoke("create_project", {
  input: {
    name: "订单管理",
    description: "订单域原型",
    directoryName: "order-management"
  }
});
```

## 安全边界

- 项目打开后，清单和页面文件命令不接受任意相对路径，只接受受限的 `pageId`。
- 每次读写都会解析真实路径并阻止越出 Project Root 的符号链接。
- 页面读写有 16 MiB 上限，`project.yaml` 有 1 MiB 上限。
- Tauri capability 只授予主窗口监听/取消监听内部事件的权限。没有 shell 或通用文件系统权限。
- MCP 命令不接受可执行文件、命令、参数或工作目录；它只能启动应用资源中约定的 sidecar，并将当前 Project Root 传给它。
- CSP 中 `script-src` 允许 `'unsafe-eval'`：本地 DSL 校验器（AJV）在加载时编译 JSON Schema，需要在 WebView 内动态执行编译代码。应用只加载打包内的本地内容，不加载远程脚本；禁止引入任何远程内容源。

## Local MCP sidecar

桌面构建会先执行 `apps/mcp` 的 sidecar 构建，把 MCP Server 与 Node 运行时封装成独立可执行文件，再以 `Contents/Resources/bin/prototype-mcp`（macOS）或相应 Windows 资源形式进入应用。最终用户无需单独安装 Node。若资源缺失，`start_local_mcp` 会安全返回 `unavailable` 和期望路径。

macOS arm64 sidecar 通过真实 stdio Client 验证：可以发现 17 个工具，并读取项目与需求。

## 集成边界

`write_page_yaml` 在桌面信任边界做格式、路径和 `page.id` 校验。产品级修改不应从 UI 直接调用它绕过 Command Engine；它是为 Project Store/Command Engine 落盘适配层预留的受限原语。
