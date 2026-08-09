# 画布（Board）功能修改计划

## 1. 目标与产品理解

把当前“一次看一个页面”的预览升级为 **Axure 式画布**：渲染出来的整个 HTML 页面是一块可平移、可缩放的画布，上面可以摆放多种对象：

- **页面原型**：引用 `pages/*.ui.yaml`，画布上以可移动的页面帧显示，双击进入页面编辑；
- **标注（Marker）**：编号彩色圆点 + 文字说明，标注在画布的任意位置，配套标注面板；
- **说明（Note）**：自由文本说明卡片；
- **流程图（Flowchart）**：节点 + 连线的结构化流程图；
- **ER 图**：实体 + 字段 + 关系的结构化 ER 图。

所有对象都必须是**结构化、可机器消费、可确定性渲染、可版本化**的数据，而不是图片或手绘像素。这与现有“UI DSL 是唯一事实源”的原则一致：画布是页面之上的**组合层**，不替代页面 DSL。

## 2. 数据模型

### 2.0 对象类型开放机制（已实现）

画布对象类型不是写死的封闭集合，而是一套**注册表机制**：每类内容 = 类型名 + 校验器 + 渲染器。新增内容类型时，在 `dsl-validator` 注册校验器（`defineBoardObjectType`）、在渲染器注册视图（`registerBoardObjectRenderer`）即可，核心画布无需改动。未知类型不会导致画布崩溃：校验给出警告、渲染器按通用卡片展示原始结构化数据，Codex 可以先交付试验性内容、后续再固化为正式类型。当前内置类型：页面、说明、标注、流程图、ER 图。

### 2.1 画布文件：`board.yaml`（项目根级，事实源）

```yaml
id: case-center-board
projectId: case-center-demo
revision: 1
objects:
  - id: page-case-list
    type: page
    pageId: case-list
    x: 120
    y: 80
    width: 960
    height: 640
  - id: note-1
    type: note
    x: 1180
    y: 100
    width: 280
    text: 批量分配上限 500 条，锁定案件不可分配
    source: explicit
  - id: marker-1
    type: marker
    number: 1
    tone: orange
    text: 待确认：分配后是否支持撤回
    source: inferred
    anchor:
      pageObjectId: page-case-list
      componentId: case-list.table
      offsetX: 120
      offsetY: -12
  - id: flow-assign
    type: flowchart
    x: 120
    y: 780
    width: 680
    height: 420
    flowchart:
      nodes:
        - id: start
          label: 勾选案件
        - id: submit
          label: 点击批量分配
      edges:
        - id: e1
          from: start
          to: submit
          label: 最多 500 条
  - id: er-case
    type: er
    x: 900
    y: 780
    width: 560
    height: 420
    er:
      entities:
        - id: case
          name: 案件
          fields:
            - name: caseNo
              type: string
              key: true
        - id: collector
          name: 催收员
          fields:
            - name: id
              type: string
              key: true
      relations:
        - id: r1
          from: case
          fromField: collectorId
          to: collector
          toField: id
          cardinality: many-to-one
```

页面内容仍然保存在 `pages/*.ui.yaml`，画布只通过 `pageId` 引用，避免重复。

### 2.2 对象类型与字段

| 类型 | 公共字段 | 类型专属字段 |
| --- | --- | --- |
| `page` | id / type / x / y / width / height | `pageId`（引用页面） |
| `marker` | id / type / source / z | `number`、`tone`（颜色）、`text`、`anchor`（挂靠的页面对象 + 组件 ID + 偏移） |
| `note` | 同上 | `text` |
| `flowchart` | 同上 | `flowchart.nodes[]`、`flowchart.edges[]` |
| `er` | 同上 | `er.entities[]`、`er.relations[]` |

公共字段统一：`id`（稳定唯一）、`type`、`x`、`y`（画布坐标）、`width`、`height`、`source`（explicit/inferred/default）、`z`（层级，可选）。**标注（marker）例外**：不存画布坐标，挂靠到页面对象内的组件（`anchor.pageObjectId` + `anchor.componentId` + 微调偏移），页面帧移动或缩放时标注跟随组件，避免固定坐标缩放错位。

### 2.3 Codex 交付契约（扩展 ADR-008）

结构化页面模板（YAML/JSON）在 `pages` 之外新增顶层 `board`：

- `board.objects` 可以直接声明页面对象、标注、说明、流程图、ER 图；
- 每个页面模板内的 `markers` 声明，会自动转成画布上的 marker 对象；
- 生成 DSL 时，页面照常生成到 `pages/`，画布对象写入 `board.yaml`。

## 3. 渲染层（Board Renderer）

- 新增 Board Renderer：读取 `board.yaml` + 引用的页面 DSL，渲染整块画布；
- 画布支持平移、缩放、网格辅助；
- 页面对象内嵌现有 Page Renderer（只读原型帧）；
- 标注对象渲染为编号圆点，悬浮显示文字，配套右侧标注面板；
- 流程图 / ER 图按结构化定义渲染为 HTML/SVG，同一输入同一输出（确定性）；
- 组件级错误隔离延续：单个对象渲染失败不拖垮整块画布。

## 4. Studio 交互

- 画布成为主工作区：平移/缩放、框选或点选对象、拖拽移动、对象右键菜单；
- 双击页面对象 → 进入该页面的组件编辑（现有编辑能力不变），返回画布；
- 右侧属性面板按对象类型显示可编辑内容（位置、尺寸、文字、颜色、页面引用、流程节点、ER 字段）；
- 新增对象：工具栏“添加”菜单（页面/标注/说明/流程图/ER 图）；
- 标注面板：点击圆点定位说明，点击说明高亮圆点，可增删改；
- 所有对象修改走 Command Engine，可撤销、有 Revision 和审计。

## 5. 命令与版本

- 新增板级命令：`ADD_BOARD_OBJECT`、`UPDATE_BOARD_OBJECT`、`MOVE_BOARD_OBJECT`、`DELETE_BOARD_OBJECT`；
- 画布拥有独立版本流：`.prototype/revisions/board/`，与页面版本流并列；
- 所有修改统一执行：baseRevision 检查 → 命令校验 → 写 `board.yaml` → 追加 Revision → 刷新画布；
- 旧项目兼容：打开没有 `board.yaml` 的项目时，自动生成默认画布，把现有页面按顺序平铺上去。

## 6. MCP 与 Codex

- 新增工具：`prototype_get_board`（读画布）、`prototype_update_board`（命令式写画布，走共享版本链）；
- 现有 `prototype_apply_commands` 扩展支持板级命令；
- Codex 交付内容从“页面模板”扩展为“页面模板 + 画布布局 + 标注 + 流程图 + ER 图”。

## 7. Product Package 与导出

- Product Package 增加画布内容（board + 对象 + 引用的页面）；
- 渲染预览即画布（iframe），满足“整个 HTML 页面是画布”；
- 独立的“导出单文件 HTML”列为后续增强（可选），不阻塞画布功能。

## 8. 分期实施计划

> 当前进度：全部阶段（Phase 0–5）已完成并通过验证：画布数据层、渲染与交互、标注/说明/连线、流程图/ER 编辑器、对象类型开放机制、画布 Revision 历史、MCP 画布工具、Product Package 含画布、Codex 模板交付画布、独立 HTML 导出。

### Phase 0：画布数据层（先做）
- `board.yaml` 读写、Board DSL Schema、校验器；
- 默认画布生成（旧项目自动平铺页面）；
- 单元测试 + 示例画布（2 个页面 + 标注 + 说明）。

> ✅ 已完成：BoardDSL Schema、validateBoard、board.yaml 读写与默认画布生成、applyBoardCommands 命令引擎及单测。

### Phase 1：画布渲染与基础交互
- Board Renderer（对象定位、平移缩放、页面帧）；
- Studio 画布视图 + 对象选择/拖拽/工具栏；
- E2E：创建页面后在画布上移动对象、缩放、进入页面编辑。

> ✅ 已完成：BoardRenderer（页面帧/说明/标注/连线/流程图/ER 渲染）、Studio 画布视图（缩放/平移/拖拽/选择/添加页面/说明/标注/连线）与 E2E。

### Phase 2：标注与说明
- marker / note 对象渲染（编号圆点 + 标注面板）；
- Studio 增删改；Codex 模板 markers → 画布对象；
- 命令与版本接入；E2E + 撤销验证。

> ✅ 已完成：标注挂靠组件（anchor=页面对象+组件ID+偏移）、标注面板、颜色与文字编辑、画布/页面编辑双入口、圆点拖拽微调偏移。

### Phase 3：流程图
- flowchart DSL + 渲染 + 编辑器（节点/连线增删改）；
- Codex 模板支持流程图。

> ✅ 已完成：流程图对象编辑器（节点/连线增删改）。

### Phase 4：ER 图
- er DSL + 渲染 + 编辑器（实体/字段/关系）；
- Codex 模板支持 ER 图。

> ✅ 已完成：ER 图对象编辑器（实体/字段/主键/关系增删改）。

### Phase 5：收口
- MCP 工具、Product Package 含画布、迁移与性能验证；
- 可选独立 HTML 导出；
- 全量测试 + 桌面打包验证。

> ✅ 已完成：MCP 画布工具（prototype_get_board / prototype_apply_board_commands，19 个工具烟测通过）、Product Package 含画布、画布 Revision 历史文件（Node 与桌面端落盘 + 审计）、Codex 模板 board 交付（parseRequirementTemplates + createBoardFromTemplates）、独立 HTML 画布导出（工具栏“导出 HTML”，E2E 覆盖下载）。

## 9. 风险与边界

- **坐标换算**：画布缩放/平移时对象坐标与鼠标位置的换算需要统一模型；
- **编辑器深度**：流程图 / ER 图 MVP 先做“结构化列表编辑 + 画布渲染”，自由拖拽连线列为增强；
- **性能**：对象数量大时需虚拟化或分层渲染，列为后续优化；
- **兼容**：所有新增能力对旧项目向后兼容，页面 DSL 与现有流程不被破坏。

## 10. 需要确认的关键点

1. 画布文件采用项目根级 `board.yaml` 单文件（推荐），还是每个对象一个文件？
2. 流程图 / ER 图采用结构化定义（推荐，可 diff、可版本化、Codex 可生成），确认？
3. 画布对象的移动编辑：MVP 支持拖拽移动 + 属性面板改尺寸；对象间连线（如页面跳转关系）是否本期需要？
4. ~~标注位置：固定画布坐标，还是挂靠组件？~~ **已确认：挂靠组件**（`anchor` = 页面对象 + 组件 ID + 偏移），页面缩放/移动时标注跟随组件不错位。
