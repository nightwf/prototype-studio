import type { RequirementModel } from "@prototype-studio/dsl-schema";
import { loadRequirementInput } from "./input";
import { deterministicRequirementParser } from "./deterministic";
import type { ParseRequirementOptions, RequirementInput, RequirementParseResult, RequirementParserRequest } from "./types";
import { stableId } from "./utils";

const categories: Array<Exclude<keyof RequirementModel, "id" | "title" | "sourceFile">> = [
  "pages", "features", "businessRules", "permissions", "validations", "interactions", "unresolved"
];

function assertAdapterModel(model: RequirementModel): RequirementModel {
  if (!model || typeof model.id !== "string" || typeof model.title !== "string") throw new Error("解析适配器返回的 Requirement Model 缺少 id 或 title。");
  for (const category of categories) if (!Array.isArray(model[category])) throw new Error(`解析适配器返回的 Requirement Model 缺少 ${String(category)} 数组。`);
  return model;
}

export { deterministicRequirementParser };

export async function parseRequirement(input: RequirementInput, options: ParseRequirementOptions = {}): Promise<RequirementParseResult> {
  const loaded = await loadRequirementInput(input);
  const requirementId = options.requirementId ?? stableId(`${loaded.title ?? ""}\n${loaded.text}`, "req");
  const request: RequirementParserRequest = { ...loaded, requirementId };
  if (options.adapter) {
    try {
      return { model: assertAdapterModel(await options.adapter.parse(request)), parser: "adapter", adapterId: options.adapter.id, warnings: [] };
    } catch (error) {
      if (options.fallbackOnAdapterError === false) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return { model: deterministicRequirementParser(request), parser: "fallback", adapterId: options.adapter.id, warnings: [`解析适配器“${options.adapter.id}”不可用，已使用本地确定性解析：${message}`] };
    }
  }
  return { model: deterministicRequirementParser(request), parser: "fallback", warnings: [] };
}
