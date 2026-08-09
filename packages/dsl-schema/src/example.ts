import {
  DESIGN_SYSTEM_VERSION,
  DSL_VERSION,
  RENDERER_VERSION,
  type PageDSL
} from "./index";

export const caseListExample: PageDSL = {
  dslVersion: DSL_VERSION,
  rendererVersion: RENDERER_VERSION,
  designSystemVersion: DESIGN_SYSTEM_VERSION,
  revision: 1,
  page: {
    id: "case-list",
    type: "list",
    title: "案件管理",
    status: "InDesign",
    description: "批量分配与案件状态跟进"
  },
  layout: { type: "standard", density: "normal" },
  search: {
    id: "search",
    fields: [
      { id: "search.caseNo", type: "input", label: "案件编号", placeholder: "输入案件编号", size: "medium", source: "explicit" },
      { id: "search.customer", type: "input", label: "客户姓名", placeholder: "输入客户姓名", size: "medium", source: "inferred" },
      {
        id: "search.status",
        type: "select",
        label: "案件状态",
        placeholder: "全部状态",
        size: "medium",
        source: "explicit",
        options: [
          { label: "待分配", value: "pending" },
          { label: "跟进中", value: "active" },
          { label: "已完成", value: "done" }
        ]
      }
    ],
    actions: [
      { id: "search.submit", type: "button", text: "查询", variant: "primary", event: { type: "refresh" } },
      { id: "search.reset", type: "button", text: "重置", variant: "ghost", event: { type: "clear", target: "search" } }
    ]
  },
  toolbar: {
    id: "toolbar",
    actions: [
      {
        id: "toolbar.batchAssign",
        type: "button",
        text: "批量分配",
        variant: "primary",
        event: { type: "open", target: "overlay.batchAssign" }
      },
      { id: "toolbar.export", type: "button", text: "导出", variant: "secondary" }
    ]
  },
  table: {
    id: "table.caseList",
    type: "table",
    rowKey: "id",
    selectable: true,
    columns: [
      { id: "table.caseNo", type: "table-column", title: "案件编号", dataIndex: "caseNo", width: "medium" },
      { id: "table.customer", type: "table-column", title: "客户姓名", dataIndex: "customer", width: "small" },
      { id: "table.amount", type: "table-column", title: "待还金额", dataIndex: "amount", format: "currency", width: "small" },
      { id: "table.status", type: "table-column", title: "状态", dataIndex: "status", format: "status", width: "small" },
      { id: "table.owner", type: "table-column", title: "催收员", dataIndex: "owner", width: "small" },
      { id: "table.updatedAt", type: "table-column", title: "更新时间", dataIndex: "updatedAt", format: "datetime", width: "medium" }
    ],
    rows: [
      { id: "C-1042", caseNo: "CA202607180042", customer: "周颖", amount: 128400, status: "待分配", owner: "—", updatedAt: "2026-08-07 09:42" },
      { id: "C-1041", caseNo: "CA202607180041", customer: "林川", amount: 76200, status: "跟进中", owner: "陈骁", updatedAt: "2026-08-07 09:18" },
      { id: "C-1038", caseNo: "CA202607180038", customer: "沈念", amount: 45900, status: "待分配", owner: "—", updatedAt: "2026-08-06 17:55" },
      { id: "C-1036", caseNo: "CA202607180036", customer: "唐婕", amount: 231000, status: "已完成", owner: "李意", updatedAt: "2026-08-06 16:21" }
    ]
  },
  overlays: [
    {
      id: "overlay.batchAssign",
      type: "modal",
      title: "批量分配",
      description: "已选择 2 个案件",
      size: "medium",
      fields: [
        {
          id: "overlay.batchAssign.collector",
          type: "select",
          label: "催收员",
          placeholder: "请选择催收员",
          options: [
            { label: "陈骁 · 华东一组", value: "chen-xiao" },
            { label: "李意 · 华东二组", value: "li-yi" }
          ],
          validation: { required: true, message: "请选择催收员" }
        },
        { id: "overlay.batchAssign.remark", type: "textarea", label: "备注", placeholder: "可填写分配说明", validation: { maxLength: 200 } }
      ],
      actions: [
        { id: "overlay.batchAssign.cancel", type: "button", text: "取消", variant: "ghost", event: { type: "close", target: "overlay.batchAssign" } },
        { id: "overlay.batchAssign.submit", type: "button", text: "确认分配", variant: "primary", event: { type: "submit", target: "overlay.batchAssign" } }
      ]
    }
  ],
  rules: [],
  events: [],
  dataSource: { type: "mock", ref: "case-list-demo" }
};
