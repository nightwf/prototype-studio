import { z } from "zod";

const identifier = z.string()
  .min(1, "ID 不能为空")
  .max(160, "ID 不能超过 160 个字符")
  .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/, "ID 必须以字母开头，且只能包含字母、数字、点、短横线或下划线");

const pageId = identifier.describe("页面的稳定 pageId，例如 case-list。");
const boardId = identifier.describe("画布的稳定 board_id；先调用 prototype_list_boards 获取。");
const componentId = identifier.describe("组件的全页唯一稳定 componentId，例如 search.status。");
const baseRevision = z.number().int().min(0)
  .describe("命令所基于的当前页面 revision；与最新版本不同时拒绝写入。");
const operator = z.string().min(1).max(120).default("codex")
  .describe("执行者名称，将写入 Revision 审计记录。");

const jsonObject = z.record(z.unknown());
const component = jsonObject.describe("符合 Prototype Studio UIComponent 结构的 JSON 对象。");
const pageDsl = jsonObject.describe("完整的 Prototype Studio PageDSL 1.0 JSON 对象。");

export const emptyInputSchema = z.object({}).strict();

export const listPagesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20)
    .describe("本次最多返回的页面数，1–100，默认 20。"),
  offset: z.number().int().min(0).default(0)
    .describe("分页起始偏移量，默认 0。")
}).strict();

export const pageInputSchema = z.object({ page_id: pageId }).strict();

export const deletePageInputSchema = z.object({
  page_id: pageId,
  base_revision: baseRevision,
  operator
}).strict();

export const listBoardsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0)
}).strict();

export const boardInputSchema = z.object({ board_id: boardId }).strict();

const boardDraftSchema = z.object({
  name: z.string().trim().min(1).max(120).describe("项目内不区分大小写唯一的画布名称。"),
  description: z.string().trim().max(1000).optional(),
  page_ids: z.array(pageId).max(200).default([]).describe("创建时铺入画布的已有公共页面 ID；按两列自动布局。"),
  board_id: boardId.optional()
}).strict();

export const createBoardInputSchema = boardDraftSchema;
export const createBoardsInputSchema = z.object({
  boards: z.array(boardDraftSchema).min(1).max(50).describe("已获用户确认的完整画布清单；服务会先整体校验再创建。")
}).strict();
export const updateBoardInputSchema = z.object({
  board_id: boardId,
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  is_default: z.boolean().optional()
}).strict();
export const deleteBoardInputSchema = z.object({ board_id: boardId }).strict();

export const componentInputSchema = z.object({
  page_id: pageId,
  component_id: componentId
}).strict();

const componentTemplateId = identifier.describe("组件模板的稳定 id，例如 confirm-reversal-modal。");

export const listComponentTemplatesInputSchema = z.object({}).strict();

export const getComponentTemplateInputSchema = z.object({ component_id: componentTemplateId }).strict();

export const createComponentTemplateInputSchema = z.object({
  dsl: jsonObject.describe("完整的 Prototype Studio ComponentTemplateDSL 1.0 JSON 对象（component.type 为 modal/drawer/popover）。")
}).strict();

export const updateComponentTemplateInputSchema = z.object({
  component_id: componentTemplateId,
  dsl: jsonObject.describe("覆盖写入的完整 ComponentTemplateDSL；component.id 必须与 component_id 一致。")
}).strict();

export const deleteComponentTemplateInputSchema = z.object({ component_id: componentTemplateId }).strict();

export const createPageInputSchema = z.object({
  dsl: pageDsl
}).strict();

export const updateComponentInputSchema = z.object({
  page_id: pageId,
  component_id: componentId,
  base_revision: baseRevision,
  changes: jsonObject.describe("要浅合并到组件的属性；不允许修改 id。"),
  operator
}).strict();

export const moveComponentInputSchema = z.object({
  page_id: pageId,
  component_id: componentId,
  base_revision: baseRevision,
  container: z.string().min(1).max(200)
    .describe("目标容器，如 search.fields、toolbar.actions、sections、overlays 或组件 ID。"),
  index: z.number().int().min(0).max(10_000)
    .describe("组件在目标容器中的零基位置。"),
  operator
}).strict();

export const deleteComponentInputSchema = z.object({
  page_id: pageId,
  component_id: componentId,
  base_revision: baseRevision,
  operator
}).strict();

export const createOverlayInputSchema = z.object({
  page_id: pageId,
  base_revision: baseRevision,
  overlay: component.describe("要创建的 modal、drawer 或 popover UIComponent。"),
  index: z.number().int().min(0).max(10_000).optional()
    .describe("可选的零基插入位置；不填则追加。"),
  operator
}).strict();

export const updateOverlayInputSchema = z.object({
  page_id: pageId,
  component_id: componentId.describe("要更新的 Overlay componentId。"),
  base_revision: baseRevision,
  changes: jsonObject.describe("要浅合并到 Overlay 的属性；不允许修改 id。"),
  operator
}).strict();

const addComponentCommand = z.object({
  type: z.literal("ADD_COMPONENT"),
  container: z.string().min(1).max(200),
  component,
  index: z.number().int().min(0).max(10_000).optional()
}).strict();
const updateComponentCommand = z.object({
  type: z.literal("UPDATE_COMPONENT"),
  target: identifier,
  changes: jsonObject
}).strict();
const moveComponentCommand = z.object({
  type: z.literal("MOVE_COMPONENT"),
  target: identifier,
  container: z.string().min(1).max(200),
  index: z.number().int().min(0).max(10_000)
}).strict();
const deleteComponentCommand = z.object({
  type: z.literal("DELETE_COMPONENT"),
  target: identifier
}).strict();
const createOverlayCommand = z.object({
  type: z.literal("CREATE_OVERLAY"),
  overlay: component,
  index: z.number().int().min(0).max(10_000).optional()
}).strict();
const updateOverlayCommand = z.object({
  type: z.literal("UPDATE_OVERLAY"),
  target: identifier,
  changes: jsonObject
}).strict();
const deleteOverlayCommand = z.object({
  type: z.literal("DELETE_OVERLAY"),
  target: identifier
}).strict();
const addRuleCommand = z.object({ type: z.literal("ADD_RULE"), rule: jsonObject }).strict();
const updateRuleCommand = z.object({ type: z.literal("UPDATE_RULE"), target: identifier, changes: jsonObject }).strict();
const deleteRuleCommand = z.object({ type: z.literal("DELETE_RULE"), target: identifier }).strict();
const addEventCommand = z.object({ type: z.literal("ADD_EVENT"), event: jsonObject }).strict();
const updateEventCommand = z.object({ type: z.literal("UPDATE_EVENT"), target: identifier, changes: jsonObject }).strict();

export const commandSchema = z.discriminatedUnion("type", [
  addComponentCommand,
  updateComponentCommand,
  moveComponentCommand,
  deleteComponentCommand,
  createOverlayCommand,
  updateOverlayCommand,
  deleteOverlayCommand,
  addRuleCommand,
  updateRuleCommand,
  deleteRuleCommand,
  addEventCommand,
  updateEventCommand
]);

export const applyCommandsInputSchema = z.object({
  page_id: pageId,
  base_revision: baseRevision,
  commands: z.array(commandSchema).min(1).max(100)
    .describe("顺序执行的 1–100 条页面内结构化 Command。"),
  operator
}).strict();

export const validateDslInputSchema = z.object({
  page_id: pageId.optional()
    .describe("要校验的已存在页面 ID；与 dsl 二选一。"),
  dsl: pageDsl.optional()
    .describe("要校验但不写入的 DSL；与 page_id 二选一。")
}).strict();

const addBoardObjectCommand = z.object({
  type: z.literal("ADD_BOARD_OBJECT"),
  object: jsonObject.describe("符合 BoardObject 结构的 JSON 对象。"),
  index: z.number().int().min(0).max(10_000).optional()
}).strict();
const updateBoardObjectCommand = z.object({
  type: z.literal("UPDATE_BOARD_OBJECT"),
  target: identifier,
  changes: jsonObject
}).strict();
const moveBoardObjectCommand = z.object({
  type: z.literal("MOVE_BOARD_OBJECT"),
  target: identifier,
  x: z.number(),
  y: z.number(),
  z: z.number().optional()
}).strict();
const deleteBoardObjectCommand = z.object({
  type: z.literal("DELETE_BOARD_OBJECT"),
  target: identifier
}).strict();
const addBoardLinkCommand = z.object({
  type: z.literal("ADD_BOARD_LINK"),
  link: jsonObject.describe("符合 BoardLink 结构的 JSON 对象。"),
  index: z.number().int().min(0).max(10_000).optional()
}).strict();
const updateBoardLinkCommand = z.object({
  type: z.literal("UPDATE_BOARD_LINK"),
  target: identifier,
  changes: jsonObject
}).strict();
const deleteBoardLinkCommand = z.object({
  type: z.literal("DELETE_BOARD_LINK"),
  target: identifier
}).strict();

export const boardCommandSchema = z.discriminatedUnion("type", [
  addBoardObjectCommand,
  updateBoardObjectCommand,
  moveBoardObjectCommand,
  deleteBoardObjectCommand,
  addBoardLinkCommand,
  updateBoardLinkCommand,
  deleteBoardLinkCommand
]);

export const applyBoardCommandsInputSchema = z.object({
  board_id: boardId,
  base_revision: baseRevision,
  commands: z.array(boardCommandSchema).min(1).max(100)
    .describe("画布结构化命令（对象增删改移、连线增删改），同一 base_revision 原子执行。"),
  operator
}).strict();

export type ListPagesInput = z.infer<typeof listPagesInputSchema>;
export type PageInput = z.infer<typeof pageInputSchema>;
export type DeletePageInput = z.infer<typeof deletePageInputSchema>;
export type ListBoardsInput = z.infer<typeof listBoardsInputSchema>;
export type BoardInput = z.infer<typeof boardInputSchema>;
export type CreateBoardInput = z.infer<typeof createBoardInputSchema>;
export type CreateBoardsInput = z.infer<typeof createBoardsInputSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardInputSchema>;
export type DeleteBoardInput = z.infer<typeof deleteBoardInputSchema>;
export type ComponentInput = z.infer<typeof componentInputSchema>;
export type ListComponentTemplatesInput = z.infer<typeof listComponentTemplatesInputSchema>;
export type GetComponentTemplateInput = z.infer<typeof getComponentTemplateInputSchema>;
export type CreateComponentTemplateInput = z.infer<typeof createComponentTemplateInputSchema>;
export type UpdateComponentTemplateInput = z.infer<typeof updateComponentTemplateInputSchema>;
export type DeleteComponentTemplateInput = z.infer<typeof deleteComponentTemplateInputSchema>;
export type CreatePageInput = z.infer<typeof createPageInputSchema>;
export type UpdateComponentInput = z.infer<typeof updateComponentInputSchema>;
export type MoveComponentInput = z.infer<typeof moveComponentInputSchema>;
export type DeleteComponentInput = z.infer<typeof deleteComponentInputSchema>;
export type CreateOverlayInput = z.infer<typeof createOverlayInputSchema>;
export type UpdateOverlayInput = z.infer<typeof updateOverlayInputSchema>;
export type ApplyCommandsInput = z.infer<typeof applyCommandsInputSchema>;
export type ValidateDslInput = z.infer<typeof validateDslInputSchema>;
export type ApplyBoardCommandsInput = z.infer<typeof applyBoardCommandsInputSchema>;
