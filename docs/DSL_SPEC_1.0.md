# UI DSL Spec 1.0

## 页面根结构

必填字段：

```yaml
dslVersion: "1.0"
rendererVersion: "0.1.0"
designSystemVersion: "0.1.0"
revision: 1
page:
  id: case-list
  type: list
  title: 案件管理
  status: InDesign
layout:
  type: standard
overlays: []
rules: []
events: []
```

MVP 主页面类型为 `list`、`detail`、`form`；Schema 同时保留 `dashboard` 与 `wizard` 的演进空间。

## 组件

支持：`input`、`select`、`tree-select`、`number`、`date`、`datetime`、`radio`、`checkbox`、`switch`、`textarea`、`button`、`table`、`tabs`、`card`、`description`、`form`、`modal`、`drawer`、`popover`。

每个组件必须有全页唯一、稳定且与 Label 解耦的 ID：

```text
search.caseNo
toolbar.batchAssign
table.caseNo
overlay.batchAssign.collector
```

普通 `UPDATE_COMPONENT` 禁止修改 ID。确实需要换 ID 时应删除并重新创建，同时更新引用。

## 语义外观

业务 DSL 不写自由 CSS。允许语义值：

- `size`: small / medium / large / full
- `variant`: default / primary / secondary / danger / ghost
- `layout.density`: compact / normal / comfortable

## Event

支持 `open`、`close`、`submit`、`navigate`、`refresh`、`setValue`、`clear`、`show`、`hide`、`enable`、`disable`。需要目标的事件必须引用现有 componentId。

## Condition

支持 `equals`、`notEquals`、`contains`、`in`、`notIn`、`greaterThan`、`lessThan`、`isEmpty`、`isNotEmpty`。

## Validation

支持 `required`、`minLength`、`maxLength`、`min`、`max`、`pattern` 与错误 `message`。

## Permission

`visibleFor` / `editableFor` 只表达原型规格。它们不能替代正式后端权限检查。

## 确定性

同一 DSL + Renderer Version + Design System Version 必须得到一致结构和视觉。Mock 表单输入、当前 Overlay、选择行等运行态不写回 DSL，除非用户通过 Command 明确修改规格。
