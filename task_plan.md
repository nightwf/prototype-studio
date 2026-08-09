# Task Plan

## Goal
深入理解本项目需求文档，形成一份可用于后续完整实现项目的高质量 Goal 提示词，先提交给 jojo 审阅。

## Phases
- [complete] 1. 盘点项目目录、约束与需求文档
- [complete] 2. 提取产品目标、角色、流程、功能、数据与非功能约束
- [complete] 3. 识别歧义、风险和合理默认假设
- [complete] 4. 编写可执行、可验收的 Goal 提示词
- [complete] 5. 复核需求覆盖度并交付审阅

## Decisions
- 当前只做需求理解与 Goal 提示词，不开始项目实现。
- Goal 提示词应面向后续开发代理，覆盖产品、交互、工程和验收要求。
- Local-first 增补章节优先于前文遗留的云端 PostgreSQL/Redis/S3 推荐。
- 第一版 Goal 以完整 MVP 为目标，但强制按端到端垂直切片分阶段交付。
- V1 AI 主链路采用外部 Codex + Local MCP；核心引擎不得依赖具体模型。

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| 无 | - | - |
| pnpm 首次安装遇到 registry `ECONNRESET`，未生成 node_modules | 1 | 改用 append-only 输出并重新安装，完成后再执行测试 |
| Validator 测试使用未导出的包内深层路径 | 1 | 改为 schema 包显式导出的 `@prototype-studio/dsl-schema/example` 子路径 |
| Preview 消息对象同时声明了协议 `type` 与运行事件 `type` | 1 | 改为 `{ type: runtime:event, payload }` 分层结构，避免字段覆盖 |
| E2E 开发服务器未在 60 秒内监听；Node 20.2 低于 Vite 7 的 20.19 要求 | 1 | 将 Vite 与 React 插件固定到兼容 Node 20.2 的 Vite 5 系列后重试 |
| 测试辅助器通过 localhost 探测不到仅绑定 127.0.0.1 的 Vite；Playwright Chromium 尚未安装 | 2 | Vite 改为监听 0.0.0.0，并安装 Playwright Chromium 后继续 E2E |
| E2E 文本定位“案件管理”同时命中 breadcrumb 与 h1，strict selector 失败 | 1 | 改用 heading role + exact name 的语义定位 |
| Studio 引用 Requirement Engine 总入口时把 Node 文件读取模块带入浏览器构建 | 1 | 拆出纯浏览器 `requirement-engine/browser` 入口，Node 文件导入仍保留在桌面入口 |
| Tauri 首次 cargo check 缺少 icons/icon.png | 1 | 新增确定性品牌 SVG，并用 Tauri icon 生成全平台图标后通过 cargo check |
| `pnpm --dir apps/desktop tauri` 参数位置错误 | 1 | 在 apps/desktop 工作目录直接执行 `pnpm tauri` |
| Tauri 默认 DMG 美化脚本失败，但 release binary 与 .app 已成功 | 1 | 使用 `--bundles app` 完成可验证 App，并将其读写镜像转换为 UDZO DMG 后通过 hdiutil 校验 |
| @yao-pkg/pkg 6.22 在 Node 20.2 中 CommonJS 加载 into-stream ESM 失败 | 1 | 固定兼容版本 6.6.0 后重试 standalone sidecar 打包 |
| standalone MCP bundle 因 source shebang 与 tsup banner 重复导致 pkg 无法解析入口 | 1 | 移除额外 banner，保留单个 source shebang 后重建 |
| 根目录 smoke 脚本无法解析只声明在 apps/mcp 的 MCP SDK | 1 | 将 smoke 脚本移入 apps/mcp，让 Node 按 workspace 包边界解析依赖 |
| standalone sidecar 首次真实调用 prototype_get_project 返回失败 | 1 | 扩充 smoke 诊断输出，检查打包运行时的项目文件依赖 |
| pkg 运行时不支持 Project Store 的动态 import callback | 1 | 将 fs/readdir 与 child_process/spawn 改为静态 Node imports，保持 sidecar 单文件可执行 |
| 全仓库 lint 扫描了生成的 dist-sidecar，并发现 3 个源码风格问题 | 1 | 忽略生成目录，修正正则转义、checkbox 分支和 smoke 输出后重跑 |
| README 批量 patch 因桌面文档原句在同一行导致上下文未匹配 | 1 | 拆分为精确的小范围 patch 后更新成功 |
| 更新 MCP README 时 patch 上下文有空格差异 | 1 | 缩小 patch 上下文后成功更新 |

## Result

- 已交付 `GOAL_PROMPT.md` 评审稿。
- 已覆盖 PRD 中的 Local-first、DSL/Renderer、Studio、Command/Revision、Requirement、MCP、桌面集成、非功能和验收要求。
