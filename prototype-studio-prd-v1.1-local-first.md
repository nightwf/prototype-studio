# AI 原生需求原型平台 PRD

**项目代号：Prototype Studio**  
**文档版本：V1.1（Local-first MVP）**  
**产品阶段：MVP**  
**产品形态：本地优先桌面应用（Desktop App）+ 本地 Web Preview + Local MCP Server**  
**核心用户：产品经理、业务分析师、研发人员、测试人员**

---

# 1. 项目背景

传统产品需求设计通常采用：

需求沟通 → PRD → Axure/Figma 原型 → UI设计 → 开发实现。

现有流程存在以下问题：

1. PRD 与原型是两个独立资产，容易出现内容不一致。
2. 原型修改依赖产品经理手工拖拽，复杂页面维护成本高。
3. 使用 AI 直接生成 HTML 虽然首次生成快，但后续精细修改困难。
4. AI 修改 HTML 时容易误改其他区域，页面结构逐渐失控。
5. 产品经理向 AI 描述“修改页面哪个位置”比较困难。
6. 原型无法天然成为 AI Coding Agent 的结构化开发输入。
7. UI规范容易随着 AI 多次生成而发生漂移。
8. 需求、页面、交互、研发实现之间缺乏统一结构化数据。
9. 大型系统需求修改后，很难判断影响哪些页面、组件和现有规则。
10. 原型通常是一次性资产，进入开发阶段后便逐渐与生产系统脱节。

因此需要建立一种新的需求表达方式：

**自然语言需求 → AI → 标准 UI DSL → 固定 Renderer → 可交互原型**

产品经理不直接维护 HTML，而是维护一份结构化 UI DSL。

---

# 2. 产品定位

Prototype Studio 是一个：

**AI Native Product Specification & Prototyping Platform**

中文定位：

**AI 原生产品需求与原型表达平台**

平台通过：

- 自然语言
- 需求文档
- 页面点选
- 可视化属性编辑
- 拖拽操作

生成和修改统一的 UI DSL。

UI DSL 再通过确定性的 Renderer 转换成可交互 Web 原型。

核心原则：

> 对话是编辑方式之一，DSL 是原型源文件，HTML/React 是渲染结果。

---

# 3. 核心产品原则

## 3.1 AI 不直接维护 HTML

禁止核心工作流：

用户 → AI → 重写 HTML。

采用：

用户 → AI → DSL Patch → Validator → DSL → Renderer → Preview。

HTML/React 原型属于编译产物，不作为产品经理主要维护对象。

## 3.2 同一 DSL 必须产生确定性 UI

相同：

- DSL
- Renderer版本
- Design System版本

必须得到一致的页面结果。

Renderer 不调用 AI。

## 3.3 AI 负责理解意图

AI主要负责：

- 需求文档理解
- 页面识别
- 组件识别
- 复杂交互理解
- DSL生成
- DSL修改建议
- DSL Patch生成
- 需求影响分析

## 3.4 简单操作不调用 AI

以下操作应直接修改 DSL：

- 修改标题
- 修改 Label
- 设置必填
- 设置默认值
- 修改字段顺序
- 拖动组件
- 删除组件
- Modal 改 Drawer
- 修改组件尺寸
- 修改按钮类型
- 修改页面布局
- 修改基础属性

只有复杂自然语言修改才需要 Agent。

---

# 4. 系统总体架构

```text
                       Prototype Studio
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
       Web Editor          AI Gateway          Open API
          │                   │                   │
          │             Codex / WorkBuddy         │
          │             / Other Agent             │
          │                   │                   │
          └───────────────────┼───────────────────┘
                              │
                        Command Layer
                              │
                       Prototype Engine
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
       DSL Engine          Validator          Versioning
          │
          ↓
      UI DSL Store
          │
          ↓
       Renderer
          │
          ↓
     Design System
          │
          ↓
    Preview Runtime
```

---

# 5. 核心模块

系统第一阶段包含以下模块：

1. 项目管理
2. 需求文档导入
3. AI需求解析
4. 页面管理
5. UI DSL
6. DSL Validator
7. 原型 Renderer
8. Design System
9. 原型编辑器
10. 组件点选
11. 属性编辑器
12. AI修改
13. MCP Server
14. 版本管理
15. 撤销与恢复
16. Preview
17. 原型分享

---

# 6. 用户角色

## 6.1 产品经理

主要权限：

- 创建项目
- 上传需求
- AI生成原型
- 创建页面
- 修改页面
- AI修改
- 发布原型
- 查看版本
- 恢复版本

## 6.2 UI/UX设计人员

主要权限：

- 查看原型
- 编辑设计Token
- 编辑组件
- 调整Design System
- 评论

MVP可暂不实现独立设计师角色。

## 6.3 开发人员

主要权限：

- 查看需求
- 查看 DSL
- 获取页面结构
- 获取原型链接
- 通过 MCP/API读取项目
- 将 DSL 作为 Coding Agent输入

## 6.4 管理员

负责：

- 用户
- 权限
- AI配置
- MCP配置
- Design System
- 系统参数

---

# 7. 核心业务对象

系统至少包含：

```text
Workspace
 └── Project
      ├── Requirement
      ├── Page
      │    └── Component
      ├── Flow
      ├── Version
      └── Preview
```

---

# 8. 项目 Project

字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | UUID | 是 | 项目ID |
| name | string | 是 | 项目名称 |
| description | string | 否 | 项目说明 |
| status | enum | 是 | active/archived |
| design_system_id | UUID | 是 | UI规范 |
| dsl_version | string | 是 | DSL规范版本 |
| created_by | UUID | 是 | 创建人 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

---

# 9. Requirement 需求

支持：

- 手工输入
- Markdown
- Word
- PDF
- TXT
- API
- 后续支持 TAPD

V1 中需求优先保存为 Markdown 文件，例如：

```text
requirements/REQ-001.md
```

结构化解析结果可保存为：

```text
requirements/REQ-001.requirement.json
```

或写入 `.prototype/index.json` 作为索引。Markdown 需求文件始终是可读、可迁移的需求资产。

---

# 10. 需求导入

入口：

**新建原型 → 从需求创建**

支持：

### A. 上传文件

例如：

`案件批量分配需求.docx`

### B. 粘贴需求

用户直接输入需求描述。

### C. Agent调用

Codex / WorkBuddy 调：

`create_project_from_requirement`

---

# 11. 需求解析

系统调用 AI，将非结构化需求解析成统一 Requirement Model。

结构：

```yaml
requirement:
  title: 案件批量分配

  pages:
    - case-list

  features:
    - batch-selection
    - batch-assign

  business_rules:
    - 最多选择500条
    - 已锁定案件不可分配

  permissions:
    - 主管允许批量分配

  validations:
    - collector required

  interactions:
    - select cases
    - click batch assign
    - open assign modal
    - select collector
    - submit
    - refresh list
```

Requirement Model 与 UI DSL 不同。

Requirement Model 表示：

**业务需求是什么。**

UI DSL 表示：

**页面如何呈现。**

---

# 12. AI解析结果确认

需求解析完成后展示：

```text
AI 已识别：

页面：3
弹窗：2
主要操作：8
业务规则：12
权限规则：3
未明确项：5
```

AI推断的信息必须区分来源：

- Explicit：需求明确说明
- Inferred：AI推断
- Default：系统默认

例如：

```text
批量分配弹层方式：Modal
来源：AI推断
```

避免AI推断被误认为正式需求。

---

# 13. UI DSL

第一阶段使用 YAML 或 JSON 作为存储表示。

内部建议统一 JSON Object。

YAML主要用于：

- 阅读
- Git
- 导出
- Agent上下文

---

# 14. DSL 基本结构

```yaml
dslVersion: "1.0"

page:
  id: case-list
  type: list
  title: 案件管理

layout:
  type: standard

search:
  fields: []

toolbar:
  actions: []

table:
  columns: []

overlays: []

rules: []

events: []
```

---

# 15. 页面类型

MVP支持：

```text
list
detail
form
dashboard
wizard
```

第一阶段重点实现：

```text
list
detail
form
```

---

# 16. 基础组件

MVP必须支持：

### Input

```yaml
id: caseNo
type: input
label: 案件编号
```

### Select

```yaml
id: status
type: select
label: 案件状态
```

### Number

### Date

### DateTime

### Radio

### Checkbox

### Switch

### Textarea

### Button

### Table

### Tabs

### Card

### Description

### Form

### Modal

### Drawer

---

# 17. Overlay模型

弹层统一抽象为 Overlay。

```yaml
overlays:

  - id: batchAssign
    type: modal
    title: 批量分配
    size: medium

    fields:

      - id: collector
        type: select
        label: 催收员
        required: true

      - id: remark
        type: textarea
        label: 备注
```

支持：

```text
modal
drawer
popover
```

修改：

```text
modal → drawer
```

只修改：

```yaml
type: drawer
```

不得重新生成整个页面。

---

# 18. Action模型

统一：

```yaml
actions:

  - id: batchAssign

    text: 批量分配

    type: primary

    event:

      type: open

      target: batchAssign
```

---

# 19. Event模型

MVP支持：

```text
open
close
submit
navigate
refresh
setValue
clear
show
hide
enable
disable
```

---

# 20. Condition模型

例如：

```yaml
visibleWhen:

  field: assignType

  operator: equals

  value: manual
```

必须预定义 operator：

```text
equals
notEquals
contains
in
notIn
greaterThan
lessThan
isEmpty
isNotEmpty
```

---

# 21. Validation模型

例如：

```yaml
validation:

  required: true

  maxLength: 200
```

MVP支持：

```text
required
minLength
maxLength
min
max
pattern
```

---

# 22. 权限模型

DSL允许描述 UI权限：

```yaml
permission:

  visibleFor:
    - supervisor
    - admin
```

需要明确：

Prototype 权限只是产品规格表达。

正式后端安全权限不能依赖前端 DSL。

---

# 23. Design System

DSL不得直接大量写 CSS。

禁止：

```yaml
height: 33px
marginLeft: 17px
color: "#1687ff"
```

正常业务 DSL 应使用语义属性：

```yaml
size: medium
variant: primary
density: normal
```

---

# 24. Design Token

统一维护：

```yaml
spacing:
  xs: 4
  sm: 8
  md: 16
  lg: 24

radius:
  small: 4
  medium: 8

font:
  body: 14
  title: 20
```

Token属于全局 Design System。

普通产品经理默认不可在需求层修改 Token。

---

# 25. Component Mapping

Renderer建立固定映射：

```text
input      → Input
select     → Select
table      → DataTable
modal      → Modal
drawer     → Drawer
tabs       → Tabs
```

Renderer不能调用AI判断使用什么组件。

---

# 26. Pattern

支持标准页面 Pattern。

例如：

```text
list-page
```

自动组成：

```text
PageHeader
SearchPanel
Toolbar
DataTable
Pagination
```

DSL：

```yaml
page:
  type: list
```

即可应用标准列表页布局。

---

# 27. Renderer

Renderer职责：

```text
DSL
↓
Parse
↓
Validate
↓
Resolve Components
↓
Apply Design System
↓
Render React
```

要求：

同一个 DSL + 同一个 Design System + 同一个 Renderer Version：

必须产生一致页面。

---

# 28. Preview Runtime

Preview作为独立运行环境。

Studio使用 iframe 嵌入 Preview。

架构：

```text
Studio

┌────────────────────────────┐
│                            │
│ iframe                     │
│                            │
│ Preview Runtime            │
│                            │
└────────────────────────────┘
```

优点：

- 页面隔离
- CSS隔离
- Runtime隔离
- 页面异常不影响Studio

---

# 29. Studio主界面

桌面端布局：

```text
┌─────────────────────────────────────────────────┐
│ Project / Page                    Share / Version│
├───────────┬─────────────────────────┬───────────┤
│ Page Tree │                         │ Properties│
│           │                         │           │
│           │       Preview           │           │
│           │                         │           │
│           │                         │           │
├───────────┴─────────────────────────┴───────────┤
│ AI Command                                        │
│ [_____________________________________] [执行]    │
└─────────────────────────────────────────────────┘
```

---

# 30. 页面树

左侧：

```text
案件管理
├── 案件列表
├── 案件详情
└── 批量导入

催收策略
├── 策略列表
└── 策略详情
```

支持：

- 创建
- 删除
- 重命名
- 排序
- 切换页面

---

# 31. 原型点选

Preview中的每个组件必须包含唯一 componentId。

例如：

```text
search.caseNo
search.status
toolbar.batchAssign
table.amount
overlay.batchAssign.collector
```

点击组件后 Preview Runtime向Studio发送：

```json
{
  "event": "component:selected",
  "projectId": "...",
  "pageId": "case-list",
  "componentId": "search.status"
}
```

使用 postMessage 或等价安全通信机制。

---

# 32. Selected Context

选中后Studio记录：

```text
Project
Page
Component
ComponentType
DSLPath
ComponentDSL
Parent
Sibling
```

之后AI命令自动附带这个 Context。

因此用户可以说：

> 把这个改成树形选择。

而不用说：

> 页面上方第二行右边的那个选择框。

---

# 33. 属性面板

基础属性必须无需 AI。

例如 Select：

```text
名称
案件状态

组件类型
Select

必填
☐

Placeholder
请选择

宽度
Medium

禁用
☐
```

保存后直接生成 DSL Patch。

---

# 34. 拖动排序

MVP支持同容器组件排序。

例如：

```text
案件编号
客户姓名
状态
来源
```

拖：

```text
状态
```

到来源之后。

系统执行：

```text
MOVE_COMPONENT
```

不调用 AI。

---

# 35. AI Command 输入区

输入框需要自动携带：

```text
projectId
pageId
selectedComponentIds
currentDSLVersion
relevantDSL
recentChanges
userPrompt
```

---

# 36. AI修改分类

## Level 1

属性修改。

例：

> 改成必填。

优先本地 Parser执行。

## Level 2

结构修改。

例：

> 把状态放到来源后面。

可以本地执行或 Agent。

## Level 3

复杂产品语义。

例：

> 把催收员改成组织树选择器，只能选择叶子节点，而且选择团队之后只显示这个团队下面的人员。

调用 Agent。

---

# 37. AI执行流程

```text
User Prompt
↓
Context Builder
↓
Agent
↓
Structured Commands
↓
Command Validator
↓
Prototype Engine
↓
DSL Patch
↓
DSL Validator
↓
Version
↓
Renderer
↓
Preview
```

---

# 38. AI禁止直接返回完整页面代码

Agent标准输出应该优先为 Command。

例如：

```json
{
  "commands": [
    {
      "type": "UPDATE_COMPONENT",
      "target": "form.collector",
      "changes": {
        "type": "tree-select",
        "leafOnly": true
      }
    }
  ]
}
```

而不是：

```text
返回完整HTML
```

---

# 39. Command类型

MVP至少提供：

```text
CREATE_PAGE

DELETE_PAGE

ADD_COMPONENT

UPDATE_COMPONENT

MOVE_COMPONENT

DELETE_COMPONENT

CREATE_OVERLAY

UPDATE_OVERLAY

DELETE_OVERLAY

ADD_RULE

UPDATE_RULE

DELETE_RULE

ADD_EVENT

UPDATE_EVENT
```

---

# 40. AI复杂修改计划

对于影响多个节点的修改，Agent先生成 Change Plan。

例如：

```text
准备修改：

1. collector
   select → tree-select

2. 新增
   leafOnly = true

3. team 与 collector 建立联动

4. 修改 collector 数据源规则

影响：
1个页面
2个组件
1条交互规则
```

用户可：

```text
执行
取消
查看详细修改
```

MVP可以设置：

单节点修改自动执行。

多节点修改显示Plan。

---

# 41. Version机制

任何修改均产生 Revision。

包括：

- 用户属性修改
- 拖拽
- AI修改
- MCP修改
- API修改

Revision：

```text
revision_id
project_id
page_id
source
operator
before_version
patch
after_version
created_at
```

source：

```text
manual
ai
mcp
api
import
```

---

# 42. Undo

必须支持：

```text
Undo
Redo
```

AI修改完成后明显展示：

```text
✓ AI已修改

影响3处

[查看变更] [撤销]
```

---

# 43. Diff

至少支持 DSL Diff。

例如：

```diff
collector:

- type: select
+ type: tree-select

+ leafOnly: true
```

后续支持Visual Diff。

---

# 44. MCP Server

Prototype Studio提供 MCP Server。

目的：

允许：

- Codex
- WorkBuddy
- CodeBuddy
- 其他Agent

读取和修改 Prototype Project。

---

# 45. MCP读取工具

MVP：

```text
list_projects

get_project

list_pages

get_page

get_component

get_dsl

get_requirement
```

---

# 46. MCP修改工具

```text
create_project

create_page

add_component

update_component

move_component

delete_component

create_overlay

update_overlay

apply_commands

validate_dsl
```

---

# 47. MCP预览

提供：

```text
render_preview

get_preview_url
```

返回：

```text
projectId
pageId
previewUrl
revision
```

---

# 48. MCP工具原则

不推荐 Agent：

```text
replace_entire_dsl
```

正常Agent必须使用：

```text
update_component
move_component
add_component
...
```

高级权限才允许：

```text
apply_dsl_patch
```

---

# 49. Codex接入模式

系统支持两种模式。

## 模式 A：Codex 外部调用

```text
Codex
↓
Prototype MCP
↓
Prototype Studio
```

用户在Codex说：

> 根据这个需求生成案件管理原型。

Codex创建项目。

完成后返回：

```text
原型已创建

Open Prototype Studio
```

链接：

```text
/studio/{projectId}/page/{pageId}
```

---

# 50. Codex内置模式

后续可通过 Agent/SDK 集成：

```text
Prototype Studio
↓
AI Gateway
↓
Codex Agent
↓
Prototype MCP / Internal Command API
```

用户无需离开 Studio。

注意：

AI层必须采用 Adapter。

例如：

```text
AgentProvider

runTask()

continueTask()

cancelTask()
```

不得把业务核心直接绑定某一模型SDK。

---

# 51. AI Provider

设计：

```text
AI Gateway

├── CodexAdapter
├── OpenAIAdapter
├── WorkBuddyAdapter
└── FutureAdapter
```

第一版可只实现：

```text
Codex
```

或者：

```text
OpenAI API
```

但接口必须抽象。

---

# 52. Preview模式

存在两种URL。

编辑：

```text
/studio/project/{id}/page/{pageId}
```

评审：

```text
/preview/{shareId}
```

Preview模式：

- 无编辑器
- 无属性栏
- 无DSL
- 仅运行原型

---

# 53. 分享

用户点击：

```text
分享原型
```

生成：

```text
Share Link
```

权限：

```text
Private
Workspace
AnyoneWithLink
```

MVP至少：

```text
Private
AnyoneWithLink
```

---

# 54. 原型运行数据

Prototype使用 Mock Data。

DSL：

```yaml
dataSource:
  type: mock
  ref: case-list-demo
```

Mock Data与页面DSL分离。

例如：

```text
/project
/pages
/data
/requirements
```

---

# 55. 数据模型

建议核心表：

### workspace

```text
id
name
created_at
```

### project

```text
id
workspace_id
name
description
design_system_id
dsl_version
status
created_by
created_at
updated_at
```

### requirement

```text
id
project_id
title
source_type
source_text
source_file
parsed_json
created_at
```

### page

```text
id
project_id
page_key
name
page_type
current_revision_id
created_at
updated_at
```

### page_revision

```text
id
page_id
revision_no
dsl_json
source
operator_id
created_at
```

### operation

```text
id
page_id
revision_id
operation_type
target_component_id
payload
source
created_at
```

### share

```text
id
project_id
token
permission
expires_at
created_at
```

---

# 56. Component ID规则

必须稳定。

格式建议：

```text
区域.业务ID
```

例如：

```text
search.caseNo

search.status

toolbar.batchAssign

table.caseNo

overlay.batchAssign

overlay.batchAssign.collector
```

ID创建后不得因为 Label 修改而变化。

---

# 57. 内部API

MVP建议：

```text
POST /api/projects

GET /api/projects/:id

POST /api/projects/:id/requirements

POST /api/projects/:id/pages

GET /api/pages/:id

PATCH /api/pages/:id

POST /api/pages/:id/commands

GET /api/pages/:id/dsl

POST /api/pages/:id/validate

POST /api/pages/:id/render

GET /api/pages/:id/revisions

POST /api/pages/:id/undo
```

---

# 58. Command API

无论调用来自 Studio 手工编辑、属性面板、AI、MCP 还是 Codex，最终都必须进入同一个 Command Engine。

逻辑接口：

```text
execute_commands(projectPath, pageId, baseRevision, commands)
```

Request：

```json
{
  "baseRevision": 18,
  "commands": [
    {
      "type": "UPDATE_COMPONENT",
      "target": "search.status",
      "changes": {
        "required": true
      }
    }
  ]
}
```

Response：

```json
{
  "success": true,
  "revision": 19,
  "changedComponents": [
    "search.status"
  ]
}
```

---

# 59. 并发控制

所有修改必须带：

```text
baseRevision
```

如果：

```text
clientRevision != currentRevision
```

返回：

```text
409 REVISION_CONFLICT
```

避免：

AI与用户同时修改导致覆盖。

---

# 60. DSL校验

至少包含：

### Schema Validation

结构是否合法。

### Reference Validation

例如：

```text
open target
```

必须存在。

### ID Validation

ID不能重复。

### Component Validation

组件类型是否合法。

### Event Validation

事件是否合法。

---

# 61. 错误示例

AI生成：

```yaml
type: super-popup
```

Validator：

```text
INVALID_COMPONENT_TYPE

Allowed:

modal
drawer
popover
```

系统可把错误反馈Agent自动修正。

---

# 62. AI上下文控制

不得每次把整个项目DSL发给AI。

Context Builder根据：

```text
当前页面
选中组件
父级
相关Sibling
相关Rule
相关Event
最近Revision
```

构建最小上下文。

目的是：

- 降低Token
- 提高准确度
- 防止误改
- 提升速度

---

# 63. AI操作权限

Agent必须受到Scope约束。

例如用户选：

```text
search.status
```

并说：

> 改成多选。

AI默认Scope：

```text
search.status
```

不得修改：

```text
table
overlay
其他page
```

除非操作需要。

如果需要扩大Scope，必须：

- 在Change Plan说明
- 或明确调用多节点命令

---

# 64. 安全

MCP/API至少使用：

```text
OAuth / API Token
```

权限至少：

```text
project:read
project:write
prototype:read
prototype:write
design-system:read
```

MCP不得默认拥有Workspace管理员权限。

---

# 65. 审计

记录：

```text
谁
什么时候
通过什么方式
修改哪个页面
修改哪些组件
Before
After
```

尤其AI/MCP修改必须可追踪。

---

# 66. 产品核心流程：需求文档生成原型

```text
上传PRD
↓
创建Requirement
↓
AI解析Requirement
↓
Requirement Model
↓
AI生成Page Plan
↓
用户确认
↓
生成UI DSL
↓
Validator
↓
Renderer
↓
Preview
↓
用户编辑
```

---

# 67. 页面规划

当需求包含多个页面时，不应该AI一次生成全部复杂DSL。

先返回：

```text
计划创建：

1. 案件列表
2. 案件详情
3. 批量导入

Overlay：

1. 批量分配
2. 修改标签
```

再执行生成。

---

# 68. 产品核心流程：点选AI修改

```text
用户点击组件
↓
Preview → Studio
↓
selectedComponent
↓
用户输入：
“改成树形选择”
↓
Context Builder
↓
Agent
↓
Command
↓
Validator
↓
Execute
↓
Revision
↓
Preview更新
```

---

# 69. 产品核心流程：手工修改

```text
用户点组件
↓
属性面板
↓
required = true
↓
生成UPDATE_COMPONENT
↓
DSL
↓
Revision
↓
Preview
```

不调用Agent。

---

# 70. 产品核心流程：Codex生成原型

```text
Codex
↓
读取需求
↓
调用 Prototype MCP
↓
create_project
↓
create_page
↓
add_component
↓
validate
↓
render
↓
get_preview_url
↓
返回用户
```

用户点击链接：

```text
Prototype Studio
```

继续编辑同一项目。

---

# 71. 产品核心流程：开发交接

Prototype Approved 后：

生成：

```text
Product Package
```

包含：

```text
requirement
UI DSL
business rules
pages
flows
Design System reference
acceptance criteria
prototype URL
```

Codex读取以后可以：

```text
Product Package
+
Code Repository
↓
开发实现
```

Prototype Studio本身第一版不负责正式生产代码生成。

---

# 72. 页面状态

Page：

```text
Draft

InDesign

Review

Approved

Archived
```

只有：

```text
Approved
```

才作为正式开发输入。

---

# 73. Requirement 与 Page关系

一个 Requirement：

可能：

```text
影响0~N个Page
```

一个 Page：

可能：

```text
被多个Requirement修改
```

因此建立：

```text
requirement_page_relation
```

字段：

```text
requirement_id
page_id
impact_type
```

---

# 74. 后续“现状原型”

长期可以增加：

```text
Baseline Prototype
```

表示：

> 当前正式系统的产品UI结构。

新需求不是每次重新创建页面，而是：

```text
Current DSL
+
Requirement
↓
AI Impact Analysis
↓
DSL Patch
↓
New Version
```

这是第二阶段的重要能力。

---

# 75. 非功能要求

## 性能

普通页面DSL更新到Preview刷新：

目标：

```text
P95 < 500ms
```

不含AI处理时间。

页面打开：

```text
P95 < 2s
```

## 可用性

DSL或某个组件渲染失败：

不得导致整个Studio崩溃。

Preview显示：

```text
Component Render Error
```

并提供错误位置。

## 数据可靠性

Revision一旦创建不得覆盖。

所有修改采用追加Revision。

---

# 76. MVP边界

V1 是单机 Local-first 工具。

第一版明确不做：

- 云端数据库
- SaaS账号体系
- 服务端项目存储
- PostgreSQL / Redis / S3 依赖

- 完整Figma替代
- Photoshop级视觉设计
- 任意自由画布
- Pixel级自由定位
- 正式后端代码生成
- 正式数据库设计
- 移动APP原型
- 大规模多人实时协同
- 任意第三方React组件自动解析
- 自动生产部署

---

# 77. MVP重点场景

只重点解决：

**后台管理类Web系统。**

典型页面：

```text
查询列表

表单

详情

弹窗

抽屉

Tabs

Table
```

这是MVP DSL应该覆盖的80%场景。

---

# 78. MVP用户故事

### US-001

作为产品经理，

我希望上传需求文档，

系统自动生成页面原型，

从而减少手工绘制原型时间。

### US-002

作为产品经理，

我希望点击原型中的组件然后说“修改这个”，

从而无需向AI描述组件位置。

### US-003

作为产品经理，

我希望修改简单属性不调用AI，

从而快速稳定完成调整。

### US-004

作为产品经理，

我希望复杂修改可以通过自然语言完成。

### US-005

作为产品经理，

我希望AI修改错误后可以一键撤销。

### US-006

作为开发人员，

我希望通过Codex读取结构化原型，

从而减少PRD到开发之间的信息损失。

### US-007

作为Agent，

我希望通过MCP读取和修改原型，

从而可以参与产品设计流程。

---

# 79. MVP验收标准

## AC-001

上传一个标准后台系统需求文档。

系统可以识别：

- 页面
- 表格
- 查询条件
- 按钮
- Modal
- 基础交互

并生成可运行原型。

## AC-002

用户可以点击任意Renderer生成的组件。

Studio能够准确获得：

```text
componentId
pageId
DSL path
```

## AC-003

用户修改：

```text
Label
Required
Visible
Size
Variant
```

无需AI。

页面实时刷新。

## AC-004

用户说：

> 把这个Modal改成Drawer。

AI产生结构化Command。

不得重写整个DSL。

## AC-005

AI错误操作可以Undo。

Undo后：

DSL与Preview必须恢复到修改前状态。

## AC-006

MCP客户端可以：

```text
get_project
get_page
get_component
update_component
validate_dsl
get_preview_url
```

## AC-007

同一DSL连续渲染多次视觉结构必须一致。

---

# 80. MVP研发阶段

## Sprint 1：DSL Core

完成：

- DSL Spec 1.0
- JSON Schema
- Validator
- Component ID
- Command Model
- Revision Model

## Sprint 2：Renderer

完成：

- React Renderer
- Design System
- List Page
- Form Page
- Detail Page
- Modal
- Drawer
- Table
- Form Components

## Sprint 3：Studio

完成：

- Project
- Page Tree
- Preview iframe
- Component Selection
- Property Panel
- Page CRUD

## Sprint 4：Version

完成：

- Command执行
- Revision
- Undo
- Redo
- DSL Diff

## Sprint 5：AI

完成：

- AI Gateway
- Context Builder
- Natural Language → Command
- Change Plan
- Agent错误修正

## Sprint 6：Requirement

完成：

- 上传需求
- 文档解析
- Requirement Model
- Requirement → UI DSL
- Multi-page Plan

## Sprint 7：Local MCP

完成：

- Local MCP Server
- Read Tools
- Write Tools
- Project Root Scope
- Local Authentication
- MCP连接测试

## Sprint 8：Desktop Integration

完成：

- Tauri Desktop
- Open Project Folder
- File Watcher
- Git Integration
- Codex 联调
- Deep Link / Preview Window
- Product Package Export

---

# 81. 推荐技术架构

Frontend：

```text
React
TypeScript
```

编辑器：

```text
Studio React App
```

Renderer：

```text
React Component Renderer
```

Preview：

```text
iframe + Preview Runtime
```

DSL：

```text
JSON internally
YAML export
```

Validation：

```text
JSON Schema
+
Custom Business Validator
```

Backend：

```text
Node.js / TypeScript
```

Database：

```text
PostgreSQL
```

缓存：

```text
Redis
```

文件：

```text
S3 compatible object storage
```

Agent integration：

```text
AI Gateway
```

External agent：

```text
MCP Server
```

---

# 82. 推荐代码仓库结构

```text
prototype-studio/

apps/

  studio/
      Web编辑器

  preview/
      Preview Runtime

  api/
      Backend API

  mcp/
      MCP Server

packages/

  dsl-schema/
      UI DSL类型定义

  dsl-validator/
      DSL校验

  command-engine/
      DSL Command执行

  renderer/
      DSL → React

  design-system/
      UI组件

  agent-context/
      AI Context Builder

  agent-adapter/
      Codex/OpenAI/其他Agent

  shared/
      通用代码
```

---

# 83. 最重要的技术边界

必须保持：

```text
AI
≠
Renderer
```

以及：

```text
Prototype
≠
Production Code
```

以及：

```text
UI DSL
≠
CSS
```

以及：

```text
Requirement
≠
UI DSL
```

四层分别负责：

```text
Requirement
做什么

UI DSL
怎么组织

Design System
长什么样

Renderer
怎么显示
```

Agent：

```text
负责理解和修改。
```

---

# 84. 产品最终目标

Prototype Studio最终不是一个：

**AI生成HTML工具。**

而应该成为：

```text
                Product Intent
                      │
                   AI Agent
                      │
                      ↓
               Product Model
                      │
                      ↓
                   UI DSL
                      │
          ┌───────────┴───────────┐
          │                       │
      Prototype                Coding Agent
          │                       │
      产品评审                  Production
```

最终形成一份机器可以直接消费的：

**Executable Product Specification。**

中文可理解为：

**可执行产品规格。**

产品经理描述需求后：

系统不仅知道页面长什么样，

还知道：

- 页面有哪些组件
- 组件之间是什么关系
- 哪个按钮打开哪个弹窗
- 字段如何校验
- 哪些组件有权限限制
- 页面有哪些状态
- 需求修改影响哪些UI节点
- Agent应该修改哪个DSL节点

从而让：

**产品设计 → 原型 → AI开发**

真正形成结构化链路。

---


# 84A. Local-first 核心工作流

## 84A.1 打开本地项目

```text
文件 → 打开项目目录
↓
扫描 project.yaml
↓
读取 pages/ 与 requirements/
↓
建立本地索引
↓
展示页面树
```

## 84A.2 Studio 修改原型

```text
用户点选组件
↓
修改属性 / 拖拽
↓
Command Engine
↓
修改 pages/*.ui.yaml
↓
Preview自动刷新
```

## 84A.3 Codex 修改原型

```text
Codex
↓
Local MCP
↓
Prototype Command Engine
↓
修改 pages/*.ui.yaml
↓
File Watcher检测变化
↓
Studio重新加载
↓
Preview自动刷新
```

Studio 与 Codex 使用同一份本地文件，不存在额外同步。

## 84A.4 外部手工修改 DSL

如果用户使用 VS Code 等工具直接修改 `pages/*.ui.yaml`，File Watcher 检测变化后重新校验和渲染。校验失败时不得覆盖最后一个有效 Preview。

---

# 84B. File Watcher

Studio 必须监听：

```text
project.yaml
requirements/
pages/
data/
flows/
```

检测 create / change / rename / delete，并进行防抖、重新读取、Validator、页面树更新和 Preview 刷新。

---

# 84C. MCP 与 Codex 集成

## 84C.1 MCP运行模式

优先 stdio MCP，备选 localhost HTTP MCP。

MCP Server 由 Desktop App 自动启动和停止。

设置页面：

```text
设置 → Agent Integration → Codex
```

显示 MCP 状态、Project Scope、复制配置和测试连接。

## 84C.2 Codex第一阶段使用方式

用户可在 Codex 中说：

```text
根据 requirements/REQ-001.md 生成对应原型。
```

Codex 读取需求并通过 MCP 创建/修改 DSL，Studio 通过 File Watcher 自动刷新。

## 84C.3 Studio内部 AI

V1 可先采用：Studio + Local MCP + 外部 Codex。

V2 再增加：Studio AI Command → Agent Adapter → Codex SDK / Model API → Command Engine。

Agent 必须可替换，Prototype Engine 不依赖具体模型。

---

# 84D. 安装与首次启动

## 84D.1 Windows

发行 `PrototypeStudio-Setup.exe`。

普通用户无需安装 PostgreSQL、Redis、S3、Docker 或手工启动后端。

## 84D.2 macOS

发行 `PrototypeStudio.dmg`。

## 84D.3 首次启动流程

```text
启动 Prototype Studio
↓
选择 Workspace Directory
↓
创建项目 / 打开项目
↓
可选：初始化 Git
↓
可选：连接 Codex
↓
开始工作
```

---

# 84E. 项目创建

新建项目时填写项目名称、保存目录和 Design System。

系统自动创建：

```text
project.yaml
requirements/
pages/
data/
flows/
assets/
.prototype/
```

如果选择初始化 Git，同时创建 `.git/` 和 `.gitignore`。

建议默认忽略：

```text
.prototype/cache/
*.tmp
```

---

# 84F. 项目可迁移性

完整项目目录必须能够复制、压缩、Git Push、NAS同步、网盘同步，并在另一台电脑直接 Open Project Folder 恢复。

不得因为本机 SQLite 丢失导致项目无法打开。

---

# 84G. Local-first 后续云端升级

V2 如需要多人协作、组织权限、在线分享、云端备份和多设备同步，则增加 Cloud Sync Layer，而不是替换本地项目格式。

```text
Local Project Folder
        ↕
    Sync Engine
        ↕
    Cloud Service
```

项目文件格式保持兼容。

---

# 85. MVP成功标准

第一阶段不以：

“生成页面有多漂亮”

作为首要指标。

而重点验证四件事情：

### 1.

产品经理从需求生成第一版原型的效率是否明显高于传统原型工具。

### 2.

AI第一次生成错误后，产品经理是否能够非常容易地修正。

### 3.

多轮修改之后，原型是否仍然保持结构稳定。

### 4.

Codex等Coding Agent能否直接消费DSL，比只阅读传统PRD更准确地理解页面和交互。

如果这四点成立，

这个项目就具备继续独立发展的基础。

---

# 86. 画布（Board）需求增补

> 本节为产品经理确认后的需求增补（对应实现见 `docs/BOARD_PLAN.md`），与 V1.1 正文冲突时以本节为准。

## 86.1 产品形态：Axure 式大画布

最终渲染输出的 HTML 是一整块可缩放、可平移的大画布，而不是单个页面。画布上可以摆放多种对象：

- 页面原型：引用 `pages/*.ui.yaml` 的可移动页面帧，双击进入页面编辑；
- 标注：编号彩色圆点 + 文字说明；
- 说明：自由文本卡片；
- 流程图：节点 + 连线的结构化流程图；
- ER 图：实体 + 字段 + 关系的结构化 ER 图；
- 对象连线：画布对象之间的有向连线（可带说明）。

内容类型不局限于以上五种：**对象类型开放机制**允许持续扩展（图表、图片、时间线等），新增类型只需注册校验器与渲染器；未知类型不导致画布崩溃，按通用对象展示原始结构化数据。

## 86.2 画布数据模型

- 画布保存在项目根目录 `board.yaml`（单文件事实源），页面内容仍留在 `pages/`，画布只通过 `pageId` 引用；
- 对象公共字段：`id`、`type`、`x`、`y`、`width`、`height`、`source`、`z`；
- **标注（marker）不存画布坐标，挂靠组件**（`anchor.pageObjectId` + `anchor.componentId` + `offsetX/offsetY`），页面帧移动或缩放时标注跟随组件，避免固定坐标缩放错位；圆点可在画布上拖拽微调偏移；
- 流程图/ER 图均为结构化定义（节点/连线、实体/字段/关系），可 diff、可版本化、Codex 可生成。

## 86.3 标注功能

- 手动添加：画布工具栏“标注”（选择挂靠页面与组件）；或页面编辑模式选中组件后，属性面板“添加标注（挂靠此组件）”；
- 编辑：圆点可拖拽微调位置；标注面板/属性面板可改文字、颜色（橙/蓝/绿/红/紫）、删除；
- 标注修改走 Command Engine，写回 `board.yaml` 并追加 Revision。

## 86.4 Codex 交付契约

Codex 交付的结构化模板（YAML/JSON）在 `pages` 之外支持顶层 `board`，可直接声明页面帧、标注（含组件挂靠）、说明、流程图、ER 图与连线；解析、校验后生成画布，与页面生成共用确认流程。

## 86.5 命令、版本与审计

- 新增画布命令：`ADD_BOARD_OBJECT`、`UPDATE_BOARD_OBJECT`、`MOVE_BOARD_OBJECT`、`DELETE_BOARD_OBJECT`、`ADD_BOARD_LINK`、`UPDATE_BOARD_LINK`、`DELETE_BOARD_LINK`；
- 画布拥有独立版本流（`.prototype/revisions/board/`）与审计记录；所有画布修改遵循 baseRevision 检查、校验、原子写文件、追加 Revision。

## 86.6 MCP

- 新增 `prototype_get_board`（读画布）与 `prototype_apply_board_commands`（命令式写画布，共享版本链）；
- 画布与页面共用同一安全边界（Project Root 限定）。

## 86.7 导出

- 工具栏“导出 HTML”：把整块画布导出为独立 HTML 文件（内联样式，标注圆点自动定位到组件）；
- Product Package 包含画布内容（对象、连线、版本）。

## 86.8 验收要点

1. 新建/打开项目后可进入画布，页面帧、标注、说明、流程图、ER 图与连线均可添加、选择、拖拽、编辑；
2. 标注挂靠组件：页面帧移动或缩放后圆点跟随组件不错位，且可拖拽微调；
3. Codex 模板携带 `board` 时，确认页面计划后画布自动生成；
4. 画布修改产生独立 Revision 并可撤销，MCP 读写画布共享版本链；
5. 导出 HTML 打开后画布完整可见，标注定位正确。
