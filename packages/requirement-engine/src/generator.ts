import {
  DESIGN_SYSTEM_VERSION,
  DSL_VERSION,
  RENDERER_VERSION,
  type PageDSL,
  type UIComponent
} from "@prototype-studio/dsl-schema";
import type { GeneratedPage, PagePlan, PagePlanPage, TemplateField } from "./types";

export class PagePlanNotConfirmedError extends Error {
  readonly code = "PAGE_PLAN_NOT_CONFIRMED" as const;

  constructor(pageId: string) {
    super(`页面“${pageId}”尚未确认，不能生成 UI DSL。`);
    this.name = "PagePlanNotConfirmedError";
  }
}

function templateComponentId(prefix: string, id: string): string {
  return id.startsWith(`${prefix}.`) ? id : `${prefix}.${id}`;
}

function templateFieldToComponent(prefix: string, field: TemplateField): UIComponent {
  return {
    id: templateComponentId(prefix, field.id),
    type: field.type,
    label: field.label,
    source: field.source ?? "explicit",
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.size ? { size: field.size } : {}),
    ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
    ...(field.required ? { validation: { required: true, message: `请填写${field.label}` } } : {}),
    ...(field.options?.length
      ? {
          options: field.options.map((option) => ({
            label: option.label,
            value: typeof option.value === "boolean" ? String(option.value) : option.value
          }))
        }
      : {})
  };
}

function createOverlays(page: PagePlanPage): UIComponent[] {
  const overlays = page.structure?.overlays;
  if (!overlays?.length) return [];
  return overlays.map((overlay) => {
    const id = templateComponentId(page.id, overlay.id);
    return {
      id,
      type: overlay.type,
      title: overlay.title,
      source: "explicit",
      fields: (overlay.fields ?? []).map((field) => templateFieldToComponent(id, field)),
      actions: [
        {
          id: `${id}.cancel`,
          type: "button",
          text: "取消",
          variant: "default",
          source: "default",
          event: { type: "close", target: id }
        },
        {
          id: `${id}.submit`,
          type: "button",
          text: "提交",
          variant: "primary",
          source: "default",
          event: { type: "submit", target: id }
        }
      ]
    };
  });
}

function createListBody(page: PagePlanPage): Pick<PageDSL, "search" | "table"> {
  const structure = page.structure;
  const templateFields = structure?.search?.fields ?? [];
  const templateColumns = structure?.table?.columns ?? [];
  return {
    search: {
      id: `${page.id}.search`,
      fields: templateFields.length
        ? templateFields.map((field) => templateFieldToComponent(`${page.id}.search`, field))
        : [
            {
              id: `${page.id}.search.keyword`,
              type: "input",
              label: "关键词",
              placeholder: `搜索${page.title}`,
              size: "medium",
              source: "default"
            }
          ],
      actions: [
        {
          id: `${page.id}.search.submit`,
          type: "button",
          text: "查询",
          variant: "primary",
          source: "default",
          event: { type: "refresh" }
        },
        ...(templateFields.length
          ? [
              {
                id: `${page.id}.search.reset`,
                type: "button" as const,
                text: "重置",
                variant: "default" as const,
                source: "default" as const,
                event: { type: "clear" as const }
              }
            ]
          : [])
      ]
    },
    table: {
      id: `${page.id}.table`,
      type: "table",
      rowKey: structure?.table?.rowKey ?? "id",
      source: page.source,
      columns: templateColumns.length
        ? templateColumns.map((column) => ({
            id: templateComponentId(`${page.id}.table`, column.id),
            type: "table-column",
            title: column.title,
            dataIndex: column.dataIndex,
            ...(column.width ? { width: column.width } : {}),
            ...(column.format ? { format: column.format } : {})
          }))
        : [
            { id: `${page.id}.table.id`, type: "table-column", title: "编号", dataIndex: "id", width: "medium" },
            { id: `${page.id}.table.name`, type: "table-column", title: "名称", dataIndex: "name", width: "medium" },
            { id: `${page.id}.table.status`, type: "table-column", title: "状态", dataIndex: "status", width: "small", format: "status" }
          ],
      rows: []
    }
  };
}

function createFormBody(page: PagePlanPage): Pick<PageDSL, "form"> {
  const templateFields = page.structure?.form?.fields ?? [];
  return {
    form: {
      id: `${page.id}.form`,
      type: "form",
      title: page.title,
      source: page.source,
      fields: templateFields.length
        ? templateFields.map((field) => templateFieldToComponent(`${page.id}.form`, field))
        : [
            {
              id: `${page.id}.form.name`,
              type: "input",
              label: "名称",
              placeholder: "请输入名称",
              source: "default",
              validation: { required: true, message: "请输入名称" }
            },
            {
              id: `${page.id}.form.remark`,
              type: "textarea",
              label: "备注",
              placeholder: "请输入备注",
              source: "default"
            }
          ],
      actions: [
        {
          id: `${page.id}.form.submit`,
          type: "button",
          text: "提交",
          variant: "primary",
          source: "default",
          event: { type: "submit", target: `${page.id}.form` }
        }
      ]
    }
  };
}

function createDetailBody(page: PagePlanPage): Pick<PageDSL, "detail"> {
  const templateFields = page.structure?.detail?.fields ?? [];
  return {
    detail: {
      id: `${page.id}.detail`,
      type: "description",
      title: page.title,
      description: "详情内容将在数据接入后展示。",
      source: "default",
      ...(templateFields.length
        ? { fields: templateFields.map((field) => templateFieldToComponent(`${page.id}.detail`, field)) }
        : {})
    }
  };
}

function createSectionBody(page: PagePlanPage): Pick<PageDSL, "sections"> {
  const section: UIComponent = {
    id: `${page.id}.section.overview`,
    type: "card",
    title: page.title,
    description: "页面内容待根据确认后的需求继续细化。",
    source: "default"
  };
  return { sections: [section] };
}

function bodyFor(page: PagePlanPage): Partial<PageDSL> {
  if (page.type === "list") return createListBody(page);
  if (page.type === "form") return createFormBody(page);
  if (page.type === "detail") return createDetailBody(page);
  return createSectionBody(page);
}

export function generatePageDSL(plan: PagePlan, pageId: string): PageDSL {
  const page = plan.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`页面计划中不存在“${pageId}”。`);
  if (page.decision !== "confirmed") throw new PagePlanNotConfirmedError(pageId);

  return {
    dslVersion: DSL_VERSION,
    rendererVersion: RENDERER_VERSION,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    revision: 1,
    page: {
      id: page.id,
      type: page.type,
      title: page.title,
      status: "Draft",
      description: `由需求“${plan.title.replace(/ · 页面计划$/, "")}”生成的最小页面。`
    },
    layout: { type: "standard", density: "normal" },
    ...bodyFor(page),
    overlays: [...createOverlays(page)],
    rules: [],
    events: [],
    dataSource: { type: "mock", ref: `${page.id}-mock` },
    meta: {
      requirementId: plan.requirementId,
      pagePlanId: plan.id,
      requirementSource: page.source,
      features: page.features,
      businessRules: page.businessRules,
      permissions: page.permissions,
      validations: page.validations,
      interactions: page.interactions
    }
  };
}

export function generateConfirmedPageDSLs(plan: PagePlan): GeneratedPage[] {
  return plan.pages
    .filter((page) => page.decision === "confirmed")
    .map((page) => ({ planPage: page, dsl: generatePageDSL(plan, page.id) }));
}
