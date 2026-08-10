export const DSL_VERSION = "1.0" as const;
export const RENDERER_VERSION = "0.1.0" as const;
export const DESIGN_SYSTEM_VERSION = "0.1.0" as const;

export const pageTypes = ["list", "detail", "form", "dashboard", "wizard"] as const;
export type PageType = (typeof pageTypes)[number];

export const pageStatuses = ["Draft", "InDesign", "Review", "Approved", "Archived"] as const;
export type PageStatus = (typeof pageStatuses)[number];

export const componentTypes = [
  "input",
  "select",
  "tree-select",
  "number",
  "date",
  "datetime",
  "radio",
  "checkbox",
  "switch",
  "textarea",
  "button",
  "table",
  "table-column",
  "tabs",
  "card",
  "description",
  "form",
  "modal",
  "drawer",
  "popover"
] as const;
export type ComponentType = (typeof componentTypes)[number];

export const eventTypes = [
  "open",
  "close",
  "submit",
  "navigate",
  "refresh",
  "setValue",
  "clear",
  "show",
  "hide",
  "enable",
  "disable"
] as const;
export type EventType = (typeof eventTypes)[number];

export const conditionOperators = [
  "equals",
  "notEquals",
  "contains",
  "in",
  "notIn",
  "greaterThan",
  "lessThan",
  "isEmpty",
  "isNotEmpty"
] as const;
export type ConditionOperator = (typeof conditionOperators)[number];

export type ComponentSize = "small" | "medium" | "large" | "full";
export type ComponentVariant = "default" | "primary" | "secondary" | "danger" | "ghost";
export type ComponentSource = "explicit" | "inferred" | "default";

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface PermissionSpec {
  visibleFor?: string[];
  editableFor?: string[];
}

export interface PrototypeEvent {
  type: EventType;
  target?: string;
  value?: unknown;
  path?: string;
}

export interface ComponentOption {
  label: string;
  value: string | number;
  disabled?: boolean;
  children?: ComponentOption[];
}

export interface TableColumn {
  id: string;
  type: "table-column";
  title: string;
  dataIndex: string;
  width?: ComponentSize;
  format?: "text" | "number" | "currency" | "date" | "datetime" | "status";
}

export interface TabItem {
  id: string;
  label: string;
  children: UIComponent[];
}

export interface UIComponent {
  id: string;
  type: ComponentType;
  label?: string;
  text?: string;
  title?: string;
  description?: string;
  placeholder?: string;
  value?: unknown;
  defaultValue?: unknown;
  visible?: boolean;
  disabled?: boolean;
  multiple?: boolean;
  leafOnly?: boolean;
  size?: ComponentSize;
  variant?: ComponentVariant;
  source?: ComponentSource;
  validation?: ValidationRule;
  visibleWhen?: Condition;
  permission?: PermissionSpec;
  event?: PrototypeEvent;
  options?: ComponentOption[];
  columns?: TableColumn[];
  rows?: Record<string, unknown>[];
  rowKey?: string;
  selectable?: boolean;
  children?: UIComponent[];
  fields?: UIComponent[];
  actions?: UIComponent[];
  tabs?: TabItem[];
  [key: string]: unknown;
}

export interface PageRule {
  id: string;
  description?: string;
  condition: Condition;
  effect: PrototypeEvent;
}

export interface PageEvent {
  id: string;
  trigger: string;
  actions: PrototypeEvent[];
}

export interface PageDSL {
  dslVersion: typeof DSL_VERSION;
  rendererVersion: string;
  designSystemVersion: string;
  revision: number;
  page: {
    id: string;
    type: PageType;
    title: string;
    status: PageStatus;
    description?: string;
  };
  layout: {
    type: "standard" | "compact";
    density?: "compact" | "normal" | "comfortable";
  };
  search?: {
    id: string;
    fields: UIComponent[];
    actions?: UIComponent[];
  };
  toolbar?: {
    id: string;
    actions: UIComponent[];
  };
  table?: UIComponent;
  form?: UIComponent;
  detail?: UIComponent;
  sections?: UIComponent[];
  overlays: UIComponent[];
  rules: PageRule[];
  events: PageEvent[];
  dataSource?: {
    type: "mock";
    ref: string;
  };
  meta?: Record<string, unknown>;
}

export const commandTypes = [
  "CREATE_PAGE",
  "DELETE_PAGE",
  "ADD_COMPONENT",
  "UPDATE_COMPONENT",
  "MOVE_COMPONENT",
  "DELETE_COMPONENT",
  "CREATE_OVERLAY",
  "UPDATE_OVERLAY",
  "DELETE_OVERLAY",
  "ADD_RULE",
  "UPDATE_RULE",
  "DELETE_RULE",
  "ADD_EVENT",
  "UPDATE_EVENT"
] as const;
export type CommandType = (typeof commandTypes)[number];

export type Command =
  | { type: "CREATE_PAGE"; page: PageDSL }
  | { type: "DELETE_PAGE"; pageId: string }
  | { type: "ADD_COMPONENT"; container: string; component: UIComponent; index?: number }
  | { type: "UPDATE_COMPONENT"; target: string; changes: Partial<UIComponent> }
  | { type: "MOVE_COMPONENT"; target: string; container: string; index: number }
  | { type: "DELETE_COMPONENT"; target: string }
  | { type: "CREATE_OVERLAY"; overlay: UIComponent; index?: number }
  | { type: "UPDATE_OVERLAY"; target: string; changes: Partial<UIComponent> }
  | { type: "DELETE_OVERLAY"; target: string }
  | { type: "ADD_RULE"; rule: PageRule }
  | { type: "UPDATE_RULE"; target: string; changes: Partial<PageRule> }
  | { type: "DELETE_RULE"; target: string }
  | { type: "ADD_EVENT"; event: PageEvent }
  | { type: "UPDATE_EVENT"; target: string; changes: Partial<PageEvent> };

export type RevisionSource = "manual" | "ai" | "mcp" | "api" | "import" | "undo" | "redo" | "external";

export interface RevisionRecord {
  id: string;
  pageId: string;
  revision: number;
  source: RevisionSource;
  operator: string;
  baseRevision: number;
  commands: Command[];
  before: PageDSL;
  after: PageDSL;
  changedComponentIds: string[];
  createdAt: string;
  revertsRevision?: number;
  reappliesRevision?: number;
}

// ===== Board (canvas) model =====

export type BoardObjectType = "page" | "note" | "marker" | "flowchart" | "er";
export type MarkerTone = "orange" | "blue" | "green" | "red" | "purple";

export interface BoardObjectBase {
  id: string;
  type: BoardObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  source?: ComponentSource;
  z?: number;
}

export interface BoardPageObject extends BoardObjectBase {
  type: "page";
  pageId: string;
}

export interface BoardNoteObject extends BoardObjectBase {
  type: "note";
  text: string;
}

export interface BoardMarkerObject {
  id: string;
  type: "marker";
  source?: ComponentSource;
  z?: number;
  number: number;
  tone: MarkerTone;
  text: string;
  anchor: {
    pageObjectId: string;
    componentId: string;
    offsetX?: number;
    offsetY?: number;
  };
}

export interface BoardFlowNode {
  id: string;
  label: string;
  kind?: "start" | "end" | "process" | "decision" | "subprocess" | "data" | "lane";
  description?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  laneId?: string;
  color?: string;
  fill?: string;
}

export interface BoardFlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  condition?: string;
  fromHandle?: string;
  toHandle?: string;
  lineType?: "straight" | "curve" | "orthogonal";
  color?: string;
  strokeWidth?: number;
}

export interface BoardFlowchartObject extends BoardObjectBase {
  type: "flowchart";
  flowchart: {
    nodes: BoardFlowNode[];
    edges: BoardFlowEdge[];
  };
}

export interface BoardErField {
  id?: string;
  name: string;
  type: string;
  key?: boolean;
  nullable?: boolean;
}

export interface BoardErEntity {
  id: string;
  name: string;
  fields: BoardErField[];
  position?: { x: number; y: number };
  width?: number;
  color?: string;
}

export interface BoardErRelation {
  id: string;
  from: string;
  fromField: string;
  to: string;
  toField: string;
  cardinality?: string;
  label?: string;
  fromHandle?: string;
  toHandle?: string;
  lineType?: "straight" | "curve" | "orthogonal";
  color?: string;
  strokeWidth?: number;
}

export interface BoardErObject extends BoardObjectBase {
  type: "er";
  er: {
    entities: BoardErEntity[];
    relations: BoardErRelation[];
  };
}

export type BoardObject = BoardPageObject | BoardNoteObject | BoardMarkerObject | BoardFlowchartObject | BoardErObject;

export const boardLinkTypes = ["straight", "curve", "orthogonal"] as const;
export type BoardLinkType = (typeof boardLinkTypes)[number];

export interface BoardLink {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Optional component anchors for links whose endpoint is a page object. */
  fromComponentId?: string;
  toComponentId?: string;
  lineType?: BoardLinkType;
  strokeWidth?: number;
  color?: string;
}

export interface BoardDSL {
  dslVersion: typeof DSL_VERSION;
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  objects: BoardObject[];
  links: BoardLink[];
}

export type BoardCommand =
  | { type: "ADD_BOARD_OBJECT"; object: BoardObject; index?: number }
  | { type: "UPDATE_BOARD_OBJECT"; target: string; changes: Partial<BoardObject> }
  | { type: "MOVE_BOARD_OBJECT"; target: string; x: number; y: number; z?: number }
  | { type: "DELETE_BOARD_OBJECT"; target: string }
  | { type: "ADD_BOARD_LINK"; link: BoardLink; index?: number }
  | { type: "UPDATE_BOARD_LINK"; target: string; changes: Partial<BoardLink> }
  | { type: "DELETE_BOARD_LINK"; target: string };

export interface BoardRevisionRecord {
  id: string;
  boardId: string;
  revision: number;
  source: RevisionSource;
  operator: string;
  baseRevision: number;
  commands: BoardCommand[];
  before: BoardDSL;
  after: BoardDSL;
  changedObjectIds: string[];
  createdAt: string;
}

export interface ProjectManifest {
  id: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  /** Missing only while reading a legacy project that has not been migrated yet. */
  projectFormatVersion?: 1 | 2;
  /** Missing only while reading a legacy project that has not been migrated yet. */
  defaultBoardId?: string;
  dslVersion: string;
  rendererVersion: string;
  designSystemVersion: string;
  createdAt: string;
  updatedAt: string;
}

export const pageDslJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://prototype.studio/schema/page-dsl-1.0.json",
  type: "object",
  required: ["dslVersion", "rendererVersion", "designSystemVersion", "revision", "page", "layout", "overlays", "rules", "events"],
  properties: {
    dslVersion: { const: DSL_VERSION },
    rendererVersion: { type: "string", minLength: 1 },
    designSystemVersion: { type: "string", minLength: 1 },
    revision: { type: "integer", minimum: 0 },
    page: {
      type: "object",
      required: ["id", "type", "title", "status"],
      properties: {
        id: { type: "string", minLength: 1 },
        type: { enum: pageTypes },
        title: { type: "string", minLength: 1 },
        status: { enum: pageStatuses }
      }
    },
    layout: { type: "object", required: ["type"] },
    overlays: { type: "array" },
    rules: { type: "array" },
    events: { type: "array" }
  },
  additionalProperties: true
} as const;
