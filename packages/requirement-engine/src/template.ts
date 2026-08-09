import { parse as parseYaml } from "yaml";
import { DSL_VERSION, type BoardDSL, type BoardLink, type BoardObject } from "@prototype-studio/dsl-schema";
import { validateBoard } from "@prototype-studio/dsl-validator";
import type {
  ComponentSource,
  RequirementItem,
  RequirementModel
} from "@prototype-studio/dsl-schema";
import type {
  PageTemplate,
  RequirementTemplates,
  TemplateColumn,
  TemplateField,
  TemplateFieldType,
  TemplateOption,
  TemplateOverlay
} from "./types";
import { stableHash } from "./utils";

export class RequirementTemplateError extends Error {
  readonly code = "INVALID_REQUIREMENT_TEMPLATE" as const;

  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "RequirementTemplateError";
  }
}

const templateFieldTypes = new Set<TemplateFieldType>([
  "input",
  "select",
  "tree-select",
  "number",
  "date",
  "datetime",
  "radio",
  "checkbox",
  "switch",
  "textarea"
]);

const pageTypes = new Set(["list", "detail", "form", "dashboard", "wizard"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, location: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new RequirementTemplateError(`${location}.${key} 必须是非空字符串。`, { location, key });
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown, location: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new RequirementTemplateError(`${location} 必须是字符串数组。`, { location });
  }
  return value
    .map((item, index) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new RequirementTemplateError(`${location}[${index}] 必须是非空字符串。`, { location, index });
      }
      return item.trim();
    });
}

function normalizeOption(value: unknown, location: string): TemplateOption {
  if (!isRecord(value)) throw new RequirementTemplateError(`${location} 必须是对象。`, { location });
  const label = requiredString(value, "label", location);
  const rawValue = value.value;
  if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
    throw new RequirementTemplateError(`${location}.value 必须是字符串、数字或布尔值。`, { location });
  }
  return { label, value: rawValue };
}

function normalizeField(value: unknown, location: string): TemplateField {
  if (!isRecord(value)) throw new RequirementTemplateError(`${location} 必须是对象。`, { location });
  const id = requiredString(value, "id", location);
  const type = requiredString(value, "type", location);
  if (!templateFieldTypes.has(type as TemplateFieldType)) {
    throw new RequirementTemplateError(
      `${location}.type 必须是 input/select/tree-select/number/date/datetime/radio/checkbox/switch/textarea 之一。`,
      { location, type }
    );
  }
  const label = requiredString(value, "label", location);
  const field: TemplateField = {
    id,
    type: type as TemplateFieldType,
    label,
    ...(optionalString(value, "placeholder") ? { placeholder: optionalString(value, "placeholder") } : {}),
    ...(typeof value.required === "boolean" ? { required: value.required } : {}),
    ...(value.defaultValue !== undefined ? { defaultValue: value.defaultValue } : {}),
    ...(typeof value.size === "string" ? { size: value.size as TemplateField["size"] } : {}),
    ...(typeof value.source === "string" ? { source: value.source as ComponentSource } : {})
  };
  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) {
      throw new RequirementTemplateError(`${location}.options 必须是数组。`, { location });
    }
    field.options = value.options.map((option, index) => normalizeOption(option, `${location}.options[${index}]`));
  }
  return field;
}

function normalizeFields(value: unknown, location: string): TemplateField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new RequirementTemplateError(`${location} 必须是数组。`, { location });
  }
  return value.map((field, index) => normalizeField(field, `${location}[${index}]`));
}

function normalizeColumn(value: unknown, location: string): TemplateColumn {
  if (!isRecord(value)) throw new RequirementTemplateError(`${location} 必须是对象。`, { location });
  const column: TemplateColumn = {
    id: requiredString(value, "id", location),
    title: requiredString(value, "title", location),
    dataIndex: requiredString(value, "dataIndex", location)
  };
  if (typeof value.width === "string") column.width = value.width as TemplateColumn["width"];
  if (typeof value.format === "string") column.format = value.format as TemplateColumn["format"];
  return column;
}

function normalizeOverlay(value: unknown, location: string): TemplateOverlay {
  if (!isRecord(value)) throw new RequirementTemplateError(`${location} 必须是对象。`, { location });
  const type = requiredString(value, "type", location);
  if (type !== "modal" && type !== "drawer") {
    throw new RequirementTemplateError(`${location}.type 必须是 modal 或 drawer。`, { location, type });
  }
  return {
    id: requiredString(value, "id", location),
    title: requiredString(value, "title", location),
    type,
    ...(value.fields !== undefined ? { fields: normalizeFields(value.fields, `${location}.fields`) } : {})
  };
}

function normalizePage(value: unknown, index: number): PageTemplate {
  const location = `pages[${index}]`;
  if (!isRecord(value)) throw new RequirementTemplateError(`${location} 必须是对象。`, { location });
  const type = requiredString(value, "type", location);
  if (!pageTypes.has(type)) {
    throw new RequirementTemplateError(`${location}.type 必须是 list/detail/form/dashboard/wizard 之一。`, { location, type });
  }
  const page: PageTemplate = {
    ...(optionalString(value, "id") ? { id: optionalString(value, "id") } : {}),
    title: requiredString(value, "title", location),
    type: type as PageTemplate["type"],
    ...(typeof value.source === "string" ? { source: value.source as ComponentSource } : {})
  };
  if (isRecord(value.search)) page.search = { fields: normalizeFields(value.search.fields, `${location}.search.fields`) };
  if (isRecord(value.table)) {
    page.table = {
      columns: (() => {
        if (!Array.isArray(value.table!.columns)) {
          throw new RequirementTemplateError(`${location}.table.columns 必须是数组。`, { location: `${location}.table.columns` });
        }
        return value.table!.columns.map((column, columnIndex) => normalizeColumn(column, `${location}.table.columns[${columnIndex}]`));
      })(),
      ...(typeof value.table.rowKey === "string" ? { rowKey: value.table.rowKey } : {})
    };
  }
  if (isRecord(value.form)) page.form = { fields: normalizeFields(value.form.fields, `${location}.form.fields`) };
  if (isRecord(value.detail)) page.detail = { fields: normalizeFields(value.detail.fields, `${location}.detail.fields`) };
  if (value.overlays !== undefined) {
    if (!Array.isArray(value.overlays)) {
      throw new RequirementTemplateError(`${location}.overlays 必须是数组。`, { location: `${location}.overlays` });
    }
    page.overlays = value.overlays.map((overlay, overlayIndex) => normalizeOverlay(overlay, `${location}.overlays[${overlayIndex}]`));
  }
  for (const key of ["features", "businessRules", "permissions", "validations", "interactions", "unresolved"] as const) {
    if (value[key] !== undefined) page[key] = asStringArray(value[key], `${location}.${key}`);
  }
  return page;
}

/**
 * Parses the structured page-template deliverable produced by Codex (ADR-008).
 * Returns null when the input is not structured (for example plain Markdown),
 * and throws RequirementTemplateError with a precise location when the input
 * looks structured but violates the contract. Deterministic, no model involved.
 */
export function parseRequirementTemplates(input: string): RequirementTemplates | null {
  let raw: unknown;
  try {
    raw = parseYaml(input);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.pages) || raw.pages.length === 0) return null;

  const title = optionalString(raw, "title") ?? "未命名需求";
  const id = optionalString(raw, "id") ?? `tpl-${stableHash(title)}`;
  const templates: RequirementTemplates = {
    id,
    title,
    pages: raw.pages.map((page, index) => normalizePage(page, index)),
    ...(raw.unresolved !== undefined ? { unresolved: asStringArray(raw.unresolved, "unresolved") } : {})
  };
  if (raw.board !== undefined) {
    if (!isRecord(raw.board) || !Array.isArray(raw.board.objects)) {
      throw new RequirementTemplateError("board 必须是包含 objects 数组的对象。", { location: "board" });
    }
    const board: BoardDSL = {
      dslVersion: DSL_VERSION,
      id: `${id}-board`,
      revision: 1,
      objects: raw.board.objects as BoardObject[],
      links: Array.isArray(raw.board.links) ? raw.board.links as BoardLink[] : []
    };
    const validation = validateBoard(board);
    if (!validation.valid) {
      throw new RequirementTemplateError("board 未通过画布校验。", validation.errors);
    }
    templates.board = { objects: board.objects, links: board.links };
  }
  return templates;
}

/** Builds the canvas (board.yaml) from structured templates; null when no board was delivered. */
export function createBoardFromTemplates(templates: RequirementTemplates): BoardDSL | null {
  if (!templates.board) return null;
  const board: BoardDSL = {
    dslVersion: DSL_VERSION,
    id: `${templates.id}-board`,
    revision: 1,
    objects: templates.board.objects,
    links: templates.board.links ?? []
  };
  const validation = validateBoard(board);
  if (!validation.valid) {
    throw new RequirementTemplateError("board 未通过画布校验。", validation.errors);
  }
  return board;
}

function items(values: string[], source: ComponentSource = "explicit"): RequirementItem<string>[] {
  return values.map((value) => ({ value, source }));
}

/** Builds the business Requirement Model shown in the Studio inspector. */
export function requirementModelFromTemplates(templates: RequirementTemplates): RequirementModel {
  const collect = (key: "features" | "businessRules" | "permissions" | "validations" | "interactions"): RequirementItem<string>[] =>
    items(templates.pages.flatMap((page) => page[key] ?? []));
  return {
    id: templates.id,
    title: templates.title,
    pages: items(templates.pages.map((page) => page.title)),
    features: collect("features"),
    businessRules: collect("businessRules"),
    permissions: collect("permissions"),
    validations: collect("validations"),
    interactions: collect("interactions"),
    unresolved: items(templates.unresolved ?? [])
  };
}
