import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import {
  boardLinkTypes,
  componentTypes,
  conditionOperators,
  eventTypes,
  pageDslJsonSchema,
  type BoardDSL,
  type BoardLink,
  type PageDSL,
  type PrototypeEvent,
  type UIComponent
} from "@prototype-studio/dsl-schema";

export type ValidationErrorCode =
  | "SCHEMA_INVALID"
  | "DUPLICATE_COMPONENT_ID"
  | "INVALID_COMPONENT_ID"
  | "INVALID_COMPONENT_TYPE"
  | "INVALID_EVENT_TYPE"
  | "MISSING_EVENT_TARGET"
  | "INVALID_EVENT_TARGET"
  | "INVALID_CONDITION_OPERATOR"
  | "INVALID_CONDITION_FIELD"
  | "INVALID_OVERLAY_TYPE";

export interface DSLValidationIssue {
  code: ValidationErrorCode;
  message: string;
  path: string;
  componentId?: string;
  suggestion?: string;
}

export interface DSLValidationResult {
  valid: boolean;
  errors: DSLValidationIssue[];
  warnings: DSLValidationIssue[];
}

export interface ComponentLocation {
  component: UIComponent;
  path: string;
  parentId?: string;
}

export interface BoardValidationResult {
  valid: boolean;
  errors: DSLValidationIssue[];
  warnings: DSLValidationIssue[];
}

export type BoardObjectValidator = (object: Record<string, unknown>, path: string, issues: { errors: DSLValidationIssue[]; warnings: DSLValidationIssue[] }) => void;

const boardObjectValidators = new Map<string, BoardObjectValidator>();

/** Registers a structured canvas object type so new content kinds can be added without changing the core validator. */
export function defineBoardObjectType(type: string, validator: BoardObjectValidator): void {
  boardObjectValidators.set(type, validator);
}

export const knownBoardObjectTypes: ReadonlySet<string> = new Set(["page", "note", "marker", "flowchart", "er"]);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(pageDslJsonSchema);
const validTypes = new Set<string>(componentTypes);
const validEventTypes = new Set<string>(eventTypes);
const validConditionOperators = new Set<string>(conditionOperators);

function schemaIssue(error: ErrorObject): DSLValidationIssue {
  const path = error.instancePath || "$";
  return {
    code: "SCHEMA_INVALID",
    path,
    message: `DSL 结构不合法：${error.message ?? "未知结构错误"}`,
    suggestion: "请根据 DSL Spec 1.0 补齐必填字段或修正字段类型。"
  };
}

function walkComponents(
  components: UIComponent[],
  basePath: string,
  output: ComponentLocation[],
  parentId?: string
): void {
  components.forEach((component, index) => {
    const path = `${basePath}[${index}]`;
    output.push({ component, path, parentId });
    if (component.fields) walkComponents(component.fields, `${path}.fields`, output, component.id);
    if (component.children) walkComponents(component.children, `${path}.children`, output, component.id);
    if (component.actions) walkComponents(component.actions, `${path}.actions`, output, component.id);
    if (component.columns) walkComponents(component.columns as unknown as UIComponent[], `${path}.columns`, output, component.id);
    component.tabs?.forEach((tab, tabIndex) => {
      walkComponents(tab.children, `${path}.tabs[${tabIndex}].children`, output, component.id);
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boardIssue(code: ValidationErrorCode, message: string, path: string): DSLValidationIssue {
  return { code, message, path };
}

/** Structural validation for the canvas (board.yaml), independent of page content. */
export function validateBoard(value: unknown): BoardValidationResult {
  const errors: DSLValidationIssue[] = [];
  const warnings: DSLValidationIssue[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: [boardIssue("SCHEMA_INVALID", "画布必须是对象。", "$")], warnings };
  }
  const board = value as unknown as BoardDSL;
  if (typeof board.revision !== "number" || board.revision < 1) {
    errors.push(boardIssue("SCHEMA_INVALID", "画布 revision 必须为正整数。", "$.revision"));
  }
  if (!Array.isArray(board.objects)) {
    errors.push(boardIssue("SCHEMA_INVALID", "画布 objects 必须是数组。", "$.objects"));
    return { valid: errors.length === 0, errors, warnings };
  }

  const objectIds = new Set<string>();
  const layoutFields = ["x", "y", "width", "height"];
  board.objects.forEach((object, index) => {
    const path = `$.objects[${index}]`;
    if (!isRecord(object)) {
      errors.push(boardIssue("SCHEMA_INVALID", "画布对象必须是对象。", path));
      return;
    }
    const id = typeof object.id === "string" ? object.id : "";
    if (!id) {
      errors.push(boardIssue("INVALID_COMPONENT_ID", "画布对象缺少有效 id。", path));
    } else if (objectIds.has(id)) {
      errors.push(boardIssue("DUPLICATE_COMPONENT_ID", `画布对象 id 重复：${id}`, `${path}.id`));
    } else {
      objectIds.add(id);
    }
    const type = (object as { type?: unknown }).type;
    if (typeof type !== "string" || !type) {
      errors.push(boardIssue("INVALID_COMPONENT_TYPE", "画布对象缺少 type。", `${path}.type`));
      return;
    }
    const validator = boardObjectValidators.get(type);
    if (!validator) {
      warnings.push(boardIssue("INVALID_COMPONENT_TYPE", `未知画布对象类型“${type}”，将按通用对象渲染；可在渲染器注册表中添加该类型。`, `${path}.type`));
      return;
    }
    validator(object, path, { errors, warnings });
    if (type !== "marker") {
      for (const field of layoutFields) {
        if (typeof object[field] !== "number") {
          errors.push(boardIssue("SCHEMA_INVALID", `画布对象缺少数值字段 ${field}。`, `${path}.${field}`));
        }
      }
    }
  });

  if (!Array.isArray(board.links)) {
    errors.push(boardIssue("SCHEMA_INVALID", "画布 links 必须是数组。", "$.links"));
  } else {
    const linkIds = new Set<string>();
    board.links.forEach((link, index) => {
      const path = `$.links[${index}]`;
      const record = link as BoardLink;
      if (!record.id || linkIds.has(record.id)) {
        errors.push(boardIssue("DUPLICATE_COMPONENT_ID", `连线 id 无效或重复：${String(record.id)}`, `${path}.id`));
      } else {
        linkIds.add(record.id);
      }
      if (!objectIds.has(record.from) || !objectIds.has(record.to)) {
        errors.push(boardIssue("INVALID_EVENT_TARGET", "连线必须连接画布上的两个对象。", path));
      }
      if (record.from === record.to) {
        errors.push(boardIssue("INVALID_EVENT_TARGET", "连线不能连接对象自身。", path));
      }
      if (record.lineType && !boardLinkTypes.includes(record.lineType)) {
        errors.push(boardIssue("SCHEMA_INVALID", `连线类型无效：${record.lineType}`, `${path}.lineType`));
      }
      if (record.strokeWidth !== undefined && (!Number.isFinite(record.strokeWidth) || record.strokeWidth < 1 || record.strokeWidth > 8)) {
        errors.push(boardIssue("SCHEMA_INVALID", "连线粗细必须在 1–8 之间。", `${path}.strokeWidth`));
      }
      if (record.color && !/^#[0-9a-f]{6}$/i.test(record.color)) {
        errors.push(boardIssue("SCHEMA_INVALID", "连线颜色必须是 6 位十六进制颜色。", `${path}.color`));
      }
    });
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function collectComponentLocations(dsl: PageDSL): ComponentLocation[] {
  const output: ComponentLocation[] = [];
  if (dsl.search) {
    walkComponents(dsl.search.fields, "$.search.fields", output, dsl.search.id);
    walkComponents(dsl.search.actions ?? [], "$.search.actions", output, dsl.search.id);
  }
  if (dsl.toolbar) walkComponents(dsl.toolbar.actions, "$.toolbar.actions", output, dsl.toolbar.id);
  if (dsl.table) walkComponents([dsl.table], "$.table", output);
  if (dsl.form) walkComponents([dsl.form], "$.form", output);
  if (dsl.detail) walkComponents([dsl.detail], "$.detail", output);
  walkComponents(dsl.sections ?? [], "$.sections", output);
  walkComponents(dsl.overlays, "$.overlays", output);
  return output;
}

export function getComponentLocation(dsl: PageDSL, componentId: string): ComponentLocation | undefined {
  return collectComponentLocations(dsl).find(({ component }) => component.id === componentId);
}

function validateEvent(
  event: PrototypeEvent,
  path: string,
  componentId: string | undefined,
  knownIds: Set<string>,
  errors: DSLValidationIssue[]
): void {
  if (!validEventTypes.has(event.type)) {
    errors.push({
      code: "INVALID_EVENT_TYPE",
      path: `${path}.type`,
      componentId,
      message: `未知事件类型“${event.type}”。`,
      suggestion: `允许值：${eventTypes.join("、")}`
    });
    return;
  }

  const targetRequired = ["open", "close", "setValue", "show", "hide", "enable", "disable"].includes(event.type);
  if (targetRequired && !event.target) {
    errors.push({
      code: "MISSING_EVENT_TARGET",
      path: `${path}.target`,
      componentId,
      message: `事件“${event.type}”必须指定 target。`,
      suggestion: "使用已存在的稳定 componentId 作为 target。"
    });
  } else if (event.target && event.target !== "search" && !knownIds.has(event.target)) {
    errors.push({
      code: "INVALID_EVENT_TARGET",
      path: `${path}.target`,
      componentId,
      message: `事件目标“${event.target}”不存在。`,
      suggestion: "检查 target 是否使用了现有组件的稳定 componentId。"
    });
  }
}

export function validateDSL(input: unknown): DSLValidationResult {
  const errors: DSLValidationIssue[] = [];
  const warnings: DSLValidationIssue[] = [];
  const schemaValid = validateSchema(input);
  if (!schemaValid) {
    errors.push(...(validateSchema.errors ?? []).map(schemaIssue));
    return { valid: false, errors, warnings };
  }

  const dsl = input as PageDSL;
  const locations = collectComponentLocations(dsl);
  const knownIds = new Set<string>([
    dsl.page.id,
    dsl.search?.id ?? "",
    dsl.toolbar?.id ?? "",
    ...locations.map(({ component }) => component.id)
  ].filter(Boolean));
  const seen = new Map<string, string>();

  for (const { component, path } of locations) {
    if (!component.id || !/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(component.id)) {
      errors.push({
        code: "INVALID_COMPONENT_ID",
        path: `${path}.id`,
        componentId: component.id,
        message: `组件 ID“${component.id || "(空)"}”不符合规则。`,
        suggestion: "ID 应以字母开头，并只包含字母、数字、点、短横线或下划线。"
      });
    }
    const firstPath = seen.get(component.id);
    if (firstPath) {
      errors.push({
        code: "DUPLICATE_COMPONENT_ID",
        path: `${path}.id`,
        componentId: component.id,
        message: `组件 ID“${component.id}”重复，首次出现于 ${firstPath}。`,
        suggestion: "为每个可交互节点分配稳定且全页唯一的 ID。"
      });
    } else {
      seen.set(component.id, path);
    }
    if (!validTypes.has(component.type)) {
      errors.push({
        code: "INVALID_COMPONENT_TYPE",
        path: `${path}.type`,
        componentId: component.id,
        message: `未知组件类型“${component.type}”。`,
        suggestion: `允许值：${componentTypes.join("、")}`
      });
    }
    if (["modal", "drawer", "popover"].includes(component.type) && !path.startsWith("$.overlays")) {
      warnings.push({
        code: "INVALID_OVERLAY_TYPE",
        path,
        componentId: component.id,
        message: "Overlay 组件建议放入页面 overlays 容器。",
        suggestion: "使用 CREATE_OVERLAY 或移动到 $.overlays。"
      });
    }
    if (component.visibleWhen) {
      if (!validConditionOperators.has(component.visibleWhen.operator)) {
        errors.push({
          code: "INVALID_CONDITION_OPERATOR",
          path: `${path}.visibleWhen.operator`,
          componentId: component.id,
          message: `未知条件运算符“${component.visibleWhen.operator}”。`,
          suggestion: `允许值：${conditionOperators.join("、")}`
        });
      }
      if (!knownIds.has(component.visibleWhen.field)) {
        warnings.push({
          code: "INVALID_CONDITION_FIELD",
          path: `${path}.visibleWhen.field`,
          componentId: component.id,
          message: `条件字段“${component.visibleWhen.field}”未找到。`,
          suggestion: "使用已存在字段的 componentId。"
        });
      }
    }
    if (component.event) validateEvent(component.event, `${path}.event`, component.id, knownIds, errors);
  }

  dsl.rules.forEach((rule, index) => {
    if (!validConditionOperators.has(rule.condition.operator)) {
      errors.push({
        code: "INVALID_CONDITION_OPERATOR",
        path: `$.rules[${index}].condition.operator`,
        message: `规则“${rule.id}”使用了未知条件运算符。`
      });
    }
    validateEvent(rule.effect, `$.rules[${index}].effect`, undefined, knownIds, errors);
  });
  dsl.events.forEach((event, eventIndex) => {
    event.actions.forEach((action, actionIndex) => {
      validateEvent(action, `$.events[${eventIndex}].actions[${actionIndex}]`, undefined, knownIds, errors);
    });
  });

  return { valid: errors.length === 0, errors, warnings };
}

defineBoardObjectType("page", (object, path, issues) => {
  if (typeof object.pageId !== "string") issues.errors.push(boardIssue("SCHEMA_INVALID", "页面对象缺少 pageId。", `${path}.pageId`));
});

defineBoardObjectType("note", (object, path, issues) => {
  if (typeof object.text !== "string") issues.errors.push(boardIssue("SCHEMA_INVALID", "说明对象缺少 text。", `${path}.text`));
});

defineBoardObjectType("marker", (object, path, issues) => {
  if (typeof object.number !== "number") issues.errors.push(boardIssue("SCHEMA_INVALID", "标注缺少 number。", `${path}.number`));
  if (!["orange", "blue", "green", "red", "purple"].includes(String(object.tone))) {
    issues.errors.push(boardIssue("SCHEMA_INVALID", "标注 tone 无效。", `${path}.tone`));
  }
  if (typeof object.text !== "string") issues.errors.push(boardIssue("SCHEMA_INVALID", "标注缺少 text。", `${path}.text`));
  const anchor = object.anchor as Record<string, unknown> | undefined;
  if (!anchor || typeof anchor.pageObjectId !== "string" || typeof anchor.componentId !== "string") {
    issues.errors.push(boardIssue("SCHEMA_INVALID", "标注必须挂靠页面对象与组件。", `${path}.anchor`));
  }
});

defineBoardObjectType("flowchart", (object, path, issues) => {
  const flowchart = object.flowchart as Record<string, unknown> | undefined;
  if (!flowchart || !Array.isArray(flowchart.nodes) || !Array.isArray(flowchart.edges)) {
    issues.errors.push(boardIssue("SCHEMA_INVALID", "流程图对象缺少 flowchart.nodes/edges。", `${path}.flowchart`));
  }
});

defineBoardObjectType("er", (object, path, issues) => {
  const er = object.er as Record<string, unknown> | undefined;
  if (!er || !Array.isArray(er.entities) || !Array.isArray(er.relations)) {
    issues.errors.push(boardIssue("SCHEMA_INVALID", "ER 图对象缺少 er.entities/relations。", `${path}.er`));
  }
});
