import type {
  BoardLink,
  BoardObject,
  ComponentSize,
  ComponentSource,
  PageDSL,
  PageType,
  RequirementItem,
  RequirementModel,
  TableColumn
} from "@prototype-studio/dsl-schema";

export type RequirementInput =
  | { kind: "text"; text: string; title?: string }
  | { kind: "file"; path: string; title?: string };

export interface LoadedRequirement {
  text: string;
  title?: string;
  sourceFile?: string;
}

export interface RequirementParserRequest extends LoadedRequirement {
  requirementId: string;
}

/** Implement this interface to connect Codex, a local model, or another AI provider. */
export interface RequirementParserAdapter {
  readonly id: string;
  parse(request: RequirementParserRequest): Promise<RequirementModel>;
}

export interface ParseRequirementOptions {
  adapter?: RequirementParserAdapter;
  fallbackOnAdapterError?: boolean;
  requirementId?: string;
}

export interface RequirementParseResult {
  model: RequirementModel;
  parser: "adapter" | "fallback";
  adapterId?: string;
  warnings: string[];
}

export type PagePlanDecision = "pending" | "confirmed" | "rejected";
export type PagePlanStatus = "draft" | "partially-confirmed" | "confirmed";

export interface PagePlanPage {
  id: string;
  title: string;
  type: PageType;
  source: ComponentSource;
  evidence?: string;
  decision: PagePlanDecision;
  features: RequirementItem<string>[];
  businessRules: RequirementItem<string>[];
  permissions: RequirementItem<string>[];
  validations: RequirementItem<string>[];
  interactions: RequirementItem<string>[];
  /** Structured field-level definition delivered by Codex (ADR-008). */
  structure?: PageTemplate;
}

export interface PagePlan {
  id: string;
  requirementId: string;
  title: string;
  status: PagePlanStatus;
  pages: PagePlanPage[];
  unresolved: RequirementItem<string>[];
}

export interface PagePlanDecisionUpdate {
  pageId: string;
  decision: PagePlanDecision;
}

export interface GeneratedPage {
  planPage: PagePlanPage;
  dsl: PageDSL;
}

export type TemplateFieldType =
  | "input"
  | "select"
  | "tree-select"
  | "number"
  | "date"
  | "datetime"
  | "radio"
  | "checkbox"
  | "switch"
  | "textarea";

export interface TemplateOption {
  label: string;
  value: string | number | boolean;
}

export interface TemplateField {
  id: string;
  type: TemplateFieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: TemplateOption[];
  defaultValue?: unknown;
  size?: ComponentSize;
  source?: ComponentSource;
}

export interface TemplateColumn {
  id: string;
  title: string;
  dataIndex: string;
  width?: ComponentSize;
  format?: TableColumn["format"];
}

export interface TemplateOverlay {
  id: string;
  title: string;
  type: "modal" | "drawer";
  fields?: TemplateField[];
}

/** Field-level page definition delivered by Codex (ADR-008). */
export interface PageTemplate {
  id?: string;
  title: string;
  type: PageType;
  source?: ComponentSource;
  search?: {
    fields: TemplateField[];
  };
  table?: {
    columns: TemplateColumn[];
    rowKey?: string;
  };
  form?: {
    fields: TemplateField[];
  };
  detail?: {
    fields: TemplateField[];
  };
  overlays?: TemplateOverlay[];
  features?: string[];
  businessRules?: string[];
  permissions?: string[];
  validations?: string[];
  interactions?: string[];
  unresolved?: string[];
}

export interface RequirementTemplates {
  id: string;
  title: string;
  pages: PageTemplate[];
  unresolved?: string[];
  board?: {
    objects: BoardObject[];
    links?: BoardLink[];
  };
}
