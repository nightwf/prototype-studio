import type { ComponentSource, RequirementModel } from "@prototype-studio/dsl-schema";
import type { LoadedRequirement, RequirementParserRequest } from "./types";
import { normalizeSpace } from "./utils";

type RequirementCategory = Exclude<keyof RequirementModel, "id" | "title" | "sourceFile">;

const headingMatchers: Array<[RequirementCategory, RegExp]> = [
  ["pages", /^(?:涉及)?页面|page/i],
  ["features", /^(?:主要)?功能|feature/i],
  ["businessRules", /^业务规则|规则|business\s*rules?/i],
  ["permissions", /^权限|角色|permission/i],
  ["validations", /^校验|验证|validation/i],
  ["interactions", /^交互|流程|操作步骤|interaction|flow/i],
  ["unresolved", /^未明确|待确认|待定|疑问|unresolved|tbd/i]
];

function emptyModel(request: RequirementParserRequest, title: string): RequirementModel {
  return {
    id: request.requirementId,
    title,
    ...(request.sourceFile ? { sourceFile: request.sourceFile } : {}),
    pages: [], features: [], businessRules: [], permissions: [], validations: [], interactions: [], unresolved: []
  };
}

function cleanLine(line: string): string {
  return normalizeSpace(line.replace(/^#{1,6}\s*/, "").replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*|\[[ xX]\]\s*)/, "").replace(/^\s*(?:页面|功能|业务规则|规则|权限|校验|验证|交互|流程|未明确项?|待确认)\s*[：:]\s*/, ""));
}

function sourceFromLine(line: string): { source: ComponentSource; value: string } {
  if (/^(?:AI\s*)?推断[：:]/i.test(line)) return { source: "inferred", value: line.replace(/^(?:AI\s*)?推断[：:]\s*/i, "") };
  if (/^系统默认[：:]|^默认[：:]/.test(line)) return { source: "default", value: line.replace(/^(?:系统)?默认[：:]\s*/, "") };
  return { source: "explicit", value: line };
}

function headingCategory(line: string): RequirementCategory | undefined {
  const heading = cleanLine(line).replace(/[：:]$/, "");
  return headingMatchers.find(([, pattern]) => pattern.test(heading))?.[0];
}

function inferredCategories(value: string): RequirementCategory[] {
  const matched: RequirementCategory[] = [];
  if (/(?:页面|列表页?|详情页?|表单页?|管理后台|看板|仪表盘)/.test(value)) matched.push("pages");
  if (/(?:最多|最少|不得|不能|不可|必须|仅限|只有|当.+时|上限|下限)/.test(value)) matched.push("businessRules");
  if (/(?:权限|角色|主管|管理员|仅.+可|允许.+操作|无权)/.test(value)) matched.push("permissions");
  if (/(?:必填|校验|验证|格式|长度|不能为空|不超过|大于|小于)/.test(value)) matched.push("validations");
  if (/(?:点击|选择|打开|关闭|提交|跳转|刷新|查询|搜索|弹窗|抽屉|进入)/.test(value)) matched.push("interactions");
  if (/(?:待确认|待定|未明确|不确定|TBD|TODO|是否)/i.test(value)) matched.push("unresolved");
  if (/(?:支持|功能|实现|提供|可(?:以)?(?:新增|编辑|删除|导出|分配|查看|查询|搜索|选择))/.test(value)) matched.push("features");
  return [...new Set(matched)];
}

function addItem(model: RequirementModel, category: RequirementCategory, value: string, source: ComponentSource, evidence?: string): void {
  const normalized = normalizeSpace(value.replace(/[；;。]$/, ""));
  if (!normalized) return;
  const list = model[category];
  const existing = list.find((item) => normalizeSpace(item.value).toLowerCase() === normalized.toLowerCase());
  if (existing) {
    if (existing.source !== "explicit" && source === "explicit") { existing.source = source; existing.evidence = evidence; }
    return;
  }
  list.push({ value: normalized, source, ...(evidence ? { evidence } : {}) });
}

function titleFromInput(input: LoadedRequirement): string {
  if (input.title?.trim()) return input.title.trim();
  const markdownTitle = input.text.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  if (markdownTitle) return markdownTitle;
  const namedTitle = input.text.match(/^(?:需求名称|标题)\s*[：:]\s*(.+)$/m)?.[1]?.trim();
  if (namedTitle) return namedTitle;
  return (input.text.split(/\r?\n/).map(cleanLine).find(Boolean) ?? "未命名需求").slice(0, 80);
}

function addFallbackInferences(model: RequirementModel): void {
  if (!model.pages.length) {
    const domain = model.title.replace(/需求|原型|系统/g, "").trim();
    addItem(model, "pages", domain ? `${domain}页面` : "主页面", "default", "输入中未明确页面，创建最小默认页面");
  }
  if (!model.features.length) addItem(model, "features", `展示并维护${model.pages[0]?.value ?? "页面"}信息`, "inferred", "根据页面名称补充最小可演示功能");
  if (model.features.some((item) => /批量/.test(item.value)) && !model.interactions.length) {
    const batchFeature = model.features.find((item) => /批量/.test(item.value))?.value ?? "批量操作";
    addItem(model, "interactions", `选择记录后执行${batchFeature.replace(/^支持/, "")}`, "inferred", "由批量功能推断最小交互链路");
  }
  if (model.pages.some((item) => /表单|新增|编辑/.test(item.value)) && !model.validations.length) addItem(model, "validations", "提交前校验必填字段", "default", "表单页采用系统默认提交校验");
  if (!model.permissions.length) addItem(model, "unresolved", "未说明页面和操作的权限范围", "inferred", "需求中没有识别到权限说明");
}

export function deterministicRequirementParser(request: RequirementParserRequest): RequirementModel {
  const title = titleFromInput(request);
  const model = emptyModel(request, title);
  let activeCategory: RequirementCategory | undefined;
  let insideFence = false;
  for (const rawLine of request.text.split(/\r?\n/)) {
    if (/^\s*```/.test(rawLine)) { insideFence = !insideFence; continue; }
    if (insideFence || !rawLine.trim()) continue;
    const possibleHeading = /^\s*#{1,6}\s+/.test(rawLine) || /[：:]\s*$/.test(rawLine);
    if (possibleHeading) {
      const category = headingCategory(rawLine);
      if (category) { activeCategory = category; continue; }
      if (/^\s*#{1,6}\s+/.test(rawLine)) activeCategory = undefined;
    }
    const cleaned = cleanLine(rawLine);
    if (!cleaned || cleaned === title) continue;
    const sourced = sourceFromLine(cleaned);
    const categories = activeCategory ? [activeCategory] : inferredCategories(sourced.value);
    for (const category of categories) addItem(model, category, sourced.value, sourced.source, normalizeSpace(rawLine));
  }
  addFallbackInferences(model);
  return model;
}
