# Findings

- 仓库是 pnpm workspace，核心包以源码 `exports` 暴露，TypeScript 配置继承根 `tsconfig.base.json`。
- `@prototype-studio/dsl-schema` 已定义 `RequirementItem`、`RequirementModel`、`PageDSL`、`ComponentSource` 等基础类型；本包应复用而非复制。
- `PageDSL` 最低结构包含版本、revision、page、layout、overlays、rules、events；具体 page type 可按 list/detail/form 生成最小主体。
- `@prototype-studio/dsl-validator` 可作为生成结果的合法性证明，package 依赖应使用 `workspace:*`。
- 本包需保持 AI Provider 隔离：Engine 仅依赖可注入的 parser adapter，缺失或失败时回退到确定性本地解析。
- PRD 的结构化模型字段与现有 `RequirementModel` 完全一致，确认界面必须展示页面、主要操作、业务规则、权限、未明确项以及每项来源。
- V1 输入范围在本子包聚焦粘贴文本、`.md`、`.markdown`、`.txt`；其他扩展名应明确拒绝，不能伪造解析。
- 多页面计划应在 DSL 生成前显式确认；生成器只接受已确认页面，避免一次性生成不可控的大块 DSL。
- JSON Schema 允许最小页面只含公共必填字段，但为了产物可渲染，list/detail/form 仍应各生成一个对应的最小主体组件。
