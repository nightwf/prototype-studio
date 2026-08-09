# Requirement Engine 计划

## 目标

在本包内实现可替换 AI 适配器、确定性中文需求解析、可确认页面计划与最小合法 PageDSL 生成，并以单元测试验证。

## 阶段

- [x] 核对 Goal、workspace 规范与现有 DSL 类型
- [x] 定义模型并实现输入读取、适配器和回退解析器
- [x] 实现 PagePlan 与 PageDSL 生成
- [x] 添加测试并完成本包验证

## 约束

- 仅修改 `packages/requirement-engine`。
- 不修改根 `package.json` 或 lockfile。
- 依赖使用 workspace 协议并遵循现有 TypeScript 规范。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| 新增 workspace 包尚无 `node_modules` 链接，TypeScript 无法解析 sibling packages | 1 | 使用 `pnpm install --lockfile=false` 仅建立依赖链接，不修改根 lockfile，再重新验证 |
| 本包目录运行 `vitest run src` 与仓库级 include 的相对路径不匹配，未发现测试 | 1 | 测试脚本显式使用 workspace 根并指定本包测试文件 |
| 批量操作的推断交互规则仅覆盖“批量分配”，泛化用例失败 | 1 | 泛化为任意明确的批量功能在缺少交互时生成标为 `inferred` 的最小操作链路 |
| 本包 lint 发现 2 个未使用的类型导入 | 1 | 删除冗余导入后复跑全部本包质量检查 |
