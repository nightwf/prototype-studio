import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PrototypeService, type ToolOutcome } from "./service.js";
import {
  applyBoardCommandsInputSchema,
  boardInputSchema,
  applyCommandsInputSchema,
  componentInputSchema,
  listComponentTemplatesInputSchema,
  getComponentTemplateInputSchema,
  createComponentTemplateInputSchema,
  updateComponentTemplateInputSchema,
  deleteComponentTemplateInputSchema,
  createBoardInputSchema,
  createBoardsInputSchema,
  createOverlayInputSchema,
  createPageInputSchema,
  deletePageInputSchema,
  deleteComponentInputSchema,
  deleteBoardInputSchema,
  emptyInputSchema,
  listPagesInputSchema,
  listBoardsInputSchema,
  moveComponentInputSchema,
  pageInputSchema,
  updateBoardInputSchema,
  updateComponentInputSchema,
  updateOverlayInputSchema,
  validateDslInputSchema
} from "./schemas.js";

export const SERVER_NAME = "prototype-studio-mcp-server";
export const SERVER_VERSION = "0.1.0";

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;
const createAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;
const updateAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;
const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
} as const;

function response<T>(outcome: ToolOutcome<T>, summary: string) {
  const text = outcome.ok
    ? `${summary}\n\n${JSON.stringify(outcome.data, null, 2)}`
    : `操作失败 [${outcome.error.code}]：${outcome.error.message}\n建议：${outcome.error.suggestion}${outcome.error.details === undefined ? "" : `\n详情：${JSON.stringify(outcome.error.details, null, 2)}`}`;
  return {
    ...(outcome.ok ? {} : { isError: true as const }),
    content: [{ type: "text" as const, text }],
    structuredContent: outcome as unknown as Record<string, unknown>
  };
}

export interface CreateServerOptions {
  projectRoot: string;
  previewBaseUrl?: string;
}

export function createPrototypeStudioServer(options: CreateServerOptions): McpServer {
  const service = new PrototypeService(options);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool("prototype_get_project", {
    title: "Get Prototype Studio Project",
    description: "Read the manifest and page count for the single Prototype Studio project configured by PROTOTYPE_STUDIO_PROJECT_ROOT. Returns project metadata without modifying local files.",
    inputSchema: emptyInputSchema,
    annotations: readAnnotations
  }, async () => response(await service.getProject(), "已读取 Prototype Studio 项目。"));

  server.registerTool("prototype_list_pages", {
    title: "List Prototype Studio Pages",
    description: "List valid pages in the configured project with limit/offset pagination. Invalid external DSL files are excluded by Project Store validation.",
    inputSchema: listPagesInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.listPages(input), "已读取页面列表。"));

  server.registerTool("prototype_get_page", {
    title: "Get Prototype Studio Page",
    description: "Read concise page metadata, versions, layout and structure counts for a page. Use prototype_get_dsl when the complete DSL is required.",
    inputSchema: pageInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.getPage(input), "已读取页面摘要。"));

  server.registerTool("prototype_get_component", {
    title: "Get Prototype Studio Component",
    description: "Read one component by stable componentId, including its DSL path, parent ID and the page revision needed for subsequent writes.",
    inputSchema: componentInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.getComponent(input), "已读取组件。"));

  server.registerTool("prototype_get_dsl", {
    title: "Get Prototype Studio Page DSL",
    description: "Read the complete validated PageDSL for one page. Use its revision as base_revision for all subsequent mutations.",
    inputSchema: pageInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.getDsl(input), "已读取完整页面 DSL。"));

  server.registerTool("prototype_list_component_templates", {
    title: "List Prototype Studio Component Templates",
    description: "List reusable component templates (modal/drawer/popover) in the project.",
    inputSchema: listComponentTemplatesInputSchema,
    annotations: readAnnotations
  }, async () => response(await service.listComponentTemplates(), "已读取组件模板列表。"));

  server.registerTool("prototype_get_component_template", {
    title: "Get Prototype Studio Component Template",
    description: "Read one complete reusable component template DSL by component_id.",
    inputSchema: getComponentTemplateInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.getComponentTemplate(input), "已读取组件模板。"));

  server.registerTool("prototype_create_component_template", {
    title: "Create Prototype Studio Component Template",
    description: "Create a reusable component template (modal/drawer/popover) from a ComponentTemplateDSL. After creation it can be inserted into pages or boards as an independent copy.",
    inputSchema: createComponentTemplateInputSchema,
    annotations: createAnnotations
  }, async (input) => response(await service.createComponentTemplate(input), "组件模板已创建。"));

  server.registerTool("prototype_update_component_template", {
    title: "Update Prototype Studio Component Template",
    description: "Overwrite a component template with the given ComponentTemplateDSL (component.id must match component_id).",
    inputSchema: updateComponentTemplateInputSchema,
    annotations: updateAnnotations
  }, async (input) => response(await service.updateComponentTemplate(input), "组件模板已更新。"));

  server.registerTool("prototype_delete_component_template", {
    title: "Delete Prototype Studio Component Template",
    description: "Move a component template to the project trash.",
    inputSchema: deleteComponentTemplateInputSchema,
    annotations: destructiveAnnotations
  }, async (input) => response(await service.deleteComponentTemplate(input), "组件模板已移入回收站。"));


  server.registerTool("prototype_list_boards", {
    title: "List Prototype Studio Boards",
    description: "List the project's independent boards with pagination, name, description, counts, revision, timestamps and default-board status. Call this before reading or mutating a board to obtain the correct board_id.",
    inputSchema: listBoardsInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.listBoards(input), "已读取画布列表。"));

  server.registerTool("prototype_get_board", {
    title: "Get Prototype Studio Board",
    description: "Read one board by board_id, including shared page frames, notes, markers, diagrams, links and its independent revision. Use the returned revision as base_revision for mutations.",
    inputSchema: boardInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.getBoard(input), "已读取画布。"));

  server.registerTool("prototype_create_board", {
    title: "Create Prototype Studio Board",
    description: "Create one independent board after the user has approved its scope. Optionally place existing project-level pages in a deterministic two-column layout. Names are required and case-insensitively unique.",
    inputSchema: createBoardInputSchema,
    annotations: createAnnotations
  }, async (input) => response(await service.createBoard(input), "画布已创建。"));

  server.registerTool("prototype_create_boards", {
    title: "Create Prototype Studio Boards",
    description: "Atomically create the complete multi-board split only after showing the proposed board names, requirement scopes, page lists and shared pages to the user and receiving confirmation. The whole batch is validated before any board is retained.",
    inputSchema: createBoardsInputSchema,
    annotations: createAnnotations
  }, async (input) => response(await service.createBoards(input), "多画布已批量创建。"));

  server.registerTool("prototype_update_board", {
    title: "Update Prototype Studio Board",
    description: "Rename a board, update its description, or make it the project default. Board names remain case-insensitively unique; board objects and links are unchanged.",
    inputSchema: updateBoardInputSchema,
    annotations: updateAnnotations
  }, async (input) => response(await service.updateBoard(input), "画布信息已更新。"));

  server.registerTool("prototype_delete_board", {
    title: "Delete Prototype Studio Board",
    description: "Move one board and its revision history to the recoverable board trash. Shared pages are retained and the final remaining board cannot be deleted.",
    inputSchema: deleteBoardInputSchema,
    annotations: destructiveAnnotations
  }, async (input) => response(await service.deleteBoard(input), "画布已移入回收站。"));

  server.registerTool("prototype_apply_board_commands", {
    title: "Apply Prototype Studio Board Commands",
    description: "Atomically apply 1-100 structured canvas commands to the specified board_id. Each board has an independent revision baseline and queue, preventing commands from crossing into another board.",
    inputSchema: applyBoardCommandsInputSchema,
    annotations: destructiveAnnotations
  }, async (input) => response(await service.applyBoardCommands(input), "画布命令已原子执行并生成 Revision。"));

  server.registerTool("prototype_create_page", {
    title: "Create Prototype Studio Page",
    description: "Validate and atomically create a new page DSL file inside the configured project. Fails if the page ID already exists; never overwrites an existing page.",
    inputSchema: createPageInputSchema,
    annotations: createAnnotations
  }, async (input) => response(await service.createPage(input), "页面已创建。"));

  server.registerTool("prototype_delete_page", {
    title: "Delete Prototype Studio Page",
    description: "Move one page to the project's recoverable .prototype/trash directory after checking base revision. It never performs an unrecoverable filesystem deletion.",
    inputSchema: deletePageInputSchema,
    annotations: destructiveAnnotations
  }, async (input) => response(await service.deletePage(input), "页面已移动到可恢复回收目录。"));

  server.registerTool("prototype_update_component", {
    title: "Update Prototype Studio Component",
    description: "Shallow-update properties of one stable component through Command Engine. Requires the current base revision, validates the resulting DSL and appends an MCP Revision; component id cannot be changed.",
    inputSchema: updateComponentInputSchema,
    annotations: updateAnnotations
  }, async (input) => response(await service.updateComponent(input), "组件已更新并生成 Revision。"));

  server.registerTool("prototype_move_component", {
    title: "Move Prototype Studio Component",
    description: "Move one component to a supported container and zero-based index through Command Engine. The operation is revision-checked, validated and audited.",
    inputSchema: moveComponentInputSchema,
    annotations: updateAnnotations
  }, async (input) => response(await service.moveComponent(input), "组件已移动并生成 Revision。"));

  server.registerTool("prototype_delete_component", {
    title: "Delete Prototype Studio Component",
    description: "Delete one component through Command Engine after a base-revision check. The resulting DSL is validated and an auditable Revision is appended.",
    inputSchema: deleteComponentInputSchema,
    annotations: destructiveAnnotations
  }, async (input) => response(await service.deleteComponent(input), "组件已删除并生成 Revision。"));

  server.registerTool("prototype_create_overlay", {
    title: "Create Prototype Studio Overlay",
    description: "Create a modal, drawer or popover component in the page overlays collection through Command Engine. The write is revision-checked, validated and audited.",
    inputSchema: createOverlayInputSchema,
    annotations: createAnnotations
  }, async (input) => response(await service.createOverlay(input), "Overlay 已创建并生成 Revision。"));

  server.registerTool("prototype_update_overlay", {
    title: "Update Prototype Studio Overlay",
    description: "Shallow-update an existing overlay by stable componentId through Command Engine. Useful for deterministic changes such as modal-to-drawer conversion; does not replace the whole DSL.",
    inputSchema: updateOverlayInputSchema,
    annotations: updateAnnotations
  }, async (input) => response(await service.updateOverlay(input), "Overlay 已更新并生成 Revision。"));

  server.registerTool("prototype_apply_commands", {
    title: "Apply Prototype Studio Commands",
    description: "Atomically apply 1-100 supported page-level Commands through the shared Command Engine. All commands use one base revision, the final DSL must validate, and a single auditable MCP Revision is appended. CREATE_PAGE and DELETE_PAGE are intentionally excluded.",
    inputSchema: applyCommandsInputSchema,
    annotations: destructiveAnnotations
  }, async (input) => response(await service.applyCommands(input), "命令已原子执行并生成 Revision。"));

  server.registerTool("prototype_validate_dsl", {
    title: "Validate Prototype Studio DSL",
    description: "Validate either one existing page_id or one candidate dsl object without writing files. Exactly one input must be supplied. Returns stable error codes, DSL paths and repair suggestions.",
    inputSchema: validateDslInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.validateDsl(input), "DSL 校验完成。"));

  server.registerTool("prototype_get_preview_url", {
    title: "Get Prototype Studio Preview URL",
    description: "Return the local Preview Runtime URL and current revision for one validated page. The URL is local-only and requires the Studio preview service to be running.",
    inputSchema: pageInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.getPreviewUrl(input), "已生成本地 Preview URL。"));

  server.registerTool("prototype_render_preview", {
    title: "Render Prototype Studio Preview",
    description: "Validate a page and prepare its deterministic local Preview Runtime route, returning renderer/design-system versions, revision and readiness. Does not invoke AI or create a public URL.",
    inputSchema: pageInputSchema,
    annotations: readAnnotations
  }, async (input) => response(await service.renderPreview(input), "页面已校验并准备本地 Preview。"));

  return server;
}
