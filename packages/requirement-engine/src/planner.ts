import type { PageType, RequirementItem, RequirementModel } from "@prototype-studio/dsl-schema";
import type { PagePlan, PagePlanDecisionUpdate, PagePlanPage, PagePlanStatus, RequirementTemplates } from "./types";
import { stableId, uniqueId } from "./utils";

function inferPageType(title: string): PageType {
  if (/详情|查看/.test(title)) return "detail";
  if (/表单|新增|创建|编辑|修改/.test(title)) return "form";
  if (/看板|仪表盘|统计/.test(title)) return "dashboard";
  if (/向导|步骤|流程/.test(title)) return "wizard";
  return "list";
}

function pageKeywords(title: string): string[] {
  return title
    .replace(/页面|列表|详情|表单|新增|创建|编辑|修改|管理|看板|仪表盘|页/g, " ")
    .split(/[\s、，,/-]+/)
    .filter((value) => value.length >= 2);
}

function relevantItems(
  items: RequirementItem<string>[],
  pageTitle: string,
  pageCount: number
): RequirementItem<string>[] {
  if (pageCount === 1) return items.map((item) => ({ ...item }));
  const keywords = pageKeywords(pageTitle);
  const matched = items.filter((item) => keywords.some((keyword) => item.value.includes(keyword)));
  return matched.map((item) => ({ ...item }));
}

function statusFor(pages: PagePlanPage[]): PagePlanStatus {
  const actionable = pages.filter((page) => page.decision !== "rejected");
  const confirmed = actionable.filter((page) => page.decision === "confirmed");
  if (actionable.length > 0 && confirmed.length === actionable.length) return "confirmed";
  if (confirmed.length > 0) return "partially-confirmed";
  return "draft";
}

export function createPagePlan(model: RequirementModel): PagePlan {
  const usedIds = new Set<string>();
  const pages = model.pages.map<PagePlanPage>((page) => {
    const title = page.value.replace(/^(?:页面|page)\s*[：:]\s*/i, "").trim();
    return {
      id: uniqueId(stableId(title, "page"), usedIds),
      title,
      type: inferPageType(title),
      source: page.source,
      ...(page.evidence ? { evidence: page.evidence } : {}),
      decision: "pending",
      features: relevantItems(model.features, title, model.pages.length),
      businessRules: relevantItems(model.businessRules, title, model.pages.length),
      permissions: relevantItems(model.permissions, title, model.pages.length),
      validations: relevantItems(model.validations, title, model.pages.length),
      interactions: relevantItems(model.interactions, title, model.pages.length)
    };
  });

  return {
    id: `${model.id}-page-plan`,
    requirementId: model.id,
    title: `${model.title} · 页面计划`,
    status: "draft",
    pages,
    unresolved: model.unresolved.map((item) => ({ ...item }))
  };
}

/**
 * Creates the Page Plan from a structured page template (ADR-008). The page
 * type comes from the explicit declaration instead of keyword guessing, and
 * the field-level definition is preserved on each page for DSL generation.
 */
export function createPagePlanFromTemplates(templates: RequirementTemplates): PagePlan {
  const usedIds = new Set<string>();
  const pages = templates.pages.map<PagePlanPage>((page) => {
    const title = page.title.trim();
    const id = uniqueId(page.id?.trim() || stableId(title, "page"), usedIds);
    const item = (values: string[] | undefined): RequirementItem<string>[] =>
      (values ?? []).map((value) => ({ value, source: "explicit" }));
    return {
      id,
      title,
      type: page.type,
      source: page.source ?? "explicit",
      decision: "pending",
      features: item(page.features),
      businessRules: item(page.businessRules),
      permissions: item(page.permissions),
      validations: item(page.validations),
      interactions: item(page.interactions),
      structure: page
    };
  });
  return {
    id: `${templates.id}-page-plan`,
    requirementId: templates.id,
    title: `${templates.title} · 页面计划`,
    status: "draft",
    pages,
    unresolved: (templates.unresolved ?? []).map((value) => ({ value, source: "explicit" }))
  };
}

export function updatePagePlanDecisions(plan: PagePlan, updates: PagePlanDecisionUpdate[]): PagePlan {
  const decisions = new Map(updates.map((update) => [update.pageId, update.decision]));
  const unknownIds = [...decisions.keys()].filter((id) => !plan.pages.some((page) => page.id === id));
  if (unknownIds.length > 0) throw new Error(`页面计划中不存在：${unknownIds.join("、")}`);

  const pages = plan.pages.map((page) => ({
    ...page,
    decision: decisions.get(page.id) ?? page.decision
  }));
  return { ...plan, pages, status: statusFor(pages) };
}

export function confirmPagePlan(plan: PagePlan, pageIds?: string[]): PagePlan {
  const selected = new Set(pageIds ?? plan.pages.filter((page) => page.decision !== "rejected").map((page) => page.id));
  return updatePagePlanDecisions(
    plan,
    [...selected].map((pageId) => ({ pageId, decision: "confirmed" }))
  );
}
