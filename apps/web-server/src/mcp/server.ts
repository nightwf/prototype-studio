import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BoardCommand, Command } from "@prototype-studio/dsl-schema";
import type { MetadataStore } from "../metadata";
import type { ProjectSpaceManager } from "../spaces";
import { CloudMcpService, McpUnauthorizedError } from "./service";

const projectId = z.string().min(1).describe("项目 ID（来自 prototype_list_projects）");
const pageId = z.string().min(1).describe("页面的稳定 pageId");
const boardId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).describe("画布 ID（来自 prototype_list_boards）");
const operator = z.string().default("codex").describe("执行者名称，写入审计");
const boardDraft = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  page_ids: z.array(pageId).max(200).default([]),
  board_id: boardId.optional()
}).strict();

export interface BuildCloudMcpOptions {
  metadata: MetadataStore;
  spaces: ProjectSpaceManager;
  baseUrl: string;
  token: string;
}

export function buildCloudMcpServer(options: BuildCloudMcpOptions): McpServer {
  const service = new CloudMcpService(options.metadata, options.spaces, options.baseUrl);
  const server = new McpServer({ name: "prototype-studio-cloud-mcp", version: "1.0.0" });

  type Outcome<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

  const execute = async <T>(operation: () => Promise<T>): Promise<Outcome<T>> => {
    try {
      return { ok: true, data: await operation() };
    } catch (error) {
      if (error instanceof McpUnauthorizedError) return { ok: false, error: { code: "UNAUTHORIZED", message: error.message } };
      const details = (error as { details?: unknown }).details;
      return {
        ok: false,
        error: {
          code: (error as { code?: string }).code ?? "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "未知错误",
          ...(details === undefined ? {} : { details })
        }
      };
    }
  };

  const respond = <T>(operation: (userId: string) => Promise<T>) => execute(async () => {
    const user = await service.userFor(options.token);
    return operation(user.id);
  }).then((outcome) => ({
    content: [{ type: "text" as const, text: JSON.stringify(outcome) }],
    structuredContent: outcome
  }));

  server.registerTool("prototype_list_projects", {
    title: "List Prototype Studio Projects",
    description: "List projects the current API token can access.",
    inputSchema: z.object({}).strict()
  }, async () => respond(async (userId) => ({ projects: await service.listProjects(userId) })));

  server.registerTool("prototype_create_project", {
    title: "Create Prototype Studio Project",
    description: "Create a new project space. Optionally deliver pages in the same call. Pages are validated as a batch: if any page is invalid nothing is written and the freshly created project is rolled back to trash, so no half-generated project is left behind. By default the delivered pages are laid out on the project's default board so the user immediately sees them on the canvas.",
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      pages: z.array(z.record(z.any())).max(50).optional(),
      place_pages_on_board: z.enum(["none", "default"]).optional()
    }).strict()
  }, async (input) => respond(async (userId) => {
    const row = await service.createProject(userId, input.name, input.description);
    const pages = input.pages ?? [];
    if (!pages.length) return { project_id: row.id, name: row.name, page_count: 0, preview_url: service.previewUrl(row.id) };
    try {
      const batch = await service.createPages(userId, row.id, pages as unknown as import("@prototype-studio/dsl-schema").PageDSL[], {
        placeOnBoard: input.place_pages_on_board ?? "default"
      });
      return { project_id: row.id, name: row.name, page_count: batch.created_count, placement: batch.placement, preview_url: service.previewUrl(row.id) };
    } catch (error) {
      await service.archiveProject(userId, row.id).catch(() => undefined);
      throw error;
    }
  }));

  server.registerTool("prototype_get_project", {
    title: "Get Prototype Studio Project",
    description: "Read project metadata, pages, boards and which pages are placed on which board. pages_not_on_any_board lists pages that exist but are not visible on any canvas; use prototype_place_pages_on_board to fix that.",
    inputSchema: z.object({ project_id: projectId }).strict()
  }, async (input) => respond(async (userId) => service.project(userId, input.project_id)));

  const templateId = z.string().min(1).describe("账号模板 ID（来自 prototype_list_templates）");

  server.registerTool("prototype_list_templates", {
    title: "List Account Template Library",
    description: "List the current account's reusable template library (component and page templates).",
    inputSchema: z.object({}).strict()
  }, async () => respond(async (userId) => ({ templates: await service.listAccountTemplates(userId) })));

  server.registerTool("prototype_get_template", {
    title: "Get Account Template",
    description: "Read one account-level template (component or page) by template_id.",
    inputSchema: z.object({ template_id: templateId }).strict()
  }, async (input) => respond(async (userId) => ({ template: await service.getAccountTemplate(userId, input.template_id) })));

  server.registerTool("prototype_create_template", {
    title: "Create Account Template",
    description: "Save a reusable template to the account library. kind=component stores a ComponentTemplateDSL (type modal/drawer/popover); kind=page stores a PageDSL.",
    inputSchema: z.object({
      kind: z.enum(["component", "page"]),
      name: z.string().min(1).max(120),
      description: z.string().max(1000).optional(),
      type: z.string().min(1).max(80),
      data: z.record(z.any())
    }).strict()
  }, async (input) => respond(async (userId) => service.createAccountTemplate(userId, {
    kind: input.kind,
    name: input.name,
    description: input.description,
    type: input.type,
    data: input.data
  })));

  server.registerTool("prototype_update_template", {
    title: "Update Account Template",
    description: "Update name/description/type/data of an account-level template.",
    inputSchema: z.object({
      template_id: templateId,
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(1000).optional(),
      type: z.string().min(1).max(80).optional(),
      data: z.record(z.any()).optional()
    }).strict()
  }, async (input) => respond(async (userId) => service.updateAccountTemplate(userId, input.template_id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.data !== undefined ? { data: input.data } : {})
  })));

  server.registerTool("prototype_delete_template", {
    title: "Delete Account Template",
    description: "Delete an account-level template from the library.",
    inputSchema: z.object({ template_id: templateId }).strict()
  }, async (input) => respond(async (userId) => service.deleteAccountTemplate(userId, input.template_id)));

  server.registerTool("prototype_list_pages", {
    title: "List Prototype Studio Pages",
    description: "List pages of a project.",
    inputSchema: z.object({ project_id: projectId }).strict()
  }, async (input) => respond(async (userId) => ({ pages: await service.listProjectPages(userId, input.project_id) })));

  server.registerTool("prototype_get_page", {
    title: "Get Prototype Studio Page",
    description: "Read page metadata and revision.",
    inputSchema: z.object({ project_id: projectId, page_id: pageId }).strict()
  }, async (input) => respond(async (userId) => {
    const dsl = await service.getPageDsl(userId, input.project_id, input.page_id);
    return { page: dsl.page, revision: dsl.revision };
  }));

  server.registerTool("prototype_get_dsl", {
    title: "Get Prototype Studio Page DSL",
    description: "Read the complete validated PageDSL.",
    inputSchema: z.object({ project_id: projectId, page_id: pageId }).strict()
  }, async (input) => respond(async (userId) => ({ dsl: await service.getPageDsl(userId, input.project_id, input.page_id) })));

  server.registerTool("prototype_get_component", {
    title: "Get Prototype Studio Component",
    description: "Read one component by componentId with its DSL path.",
    inputSchema: z.object({ project_id: projectId, page_id: pageId, component_id: z.string().min(1) }).strict()
  }, async (input) => respond(async (userId) => service.getComponent(userId, input.project_id, input.page_id, input.component_id)));


  server.registerTool("prototype_list_boards", {
    title: "List Prototype Studio Boards",
    description: "List all independent boards in a project, including the default flag, counts and revision. Use this first to select the correct board_id.",
    inputSchema: z.object({ project_id: projectId }).strict()
  }, async (input) => respond(async (userId) => ({ boards: await service.listBoards(userId, input.project_id) })));

  server.registerTool("prototype_get_board", {
    title: "Get Prototype Studio Board",
    description: "Read one board and its independent revision by board_id.",
    inputSchema: z.object({ project_id: projectId, board_id: boardId }).strict()
  }, async (input) => respond(async (userId) => ({ board: await service.getBoard(userId, input.project_id, input.board_id) })));

  server.registerTool("prototype_create_board", {
    title: "Create Prototype Studio Board",
    description: "Create one board after user approval, optionally laying out existing shared pages in two columns.",
    inputSchema: z.object({ project_id: projectId, board: boardDraft }).strict()
  }, async (input) => respond(async (userId) => ({ board: await service.createBoard(userId, input.project_id, {
    name: input.board.name,
    description: input.board.description,
    pageIds: input.board.page_ids,
    boardId: input.board.board_id
  }) })));

  server.registerTool("prototype_create_boards", {
    title: "Create Prototype Studio Boards",
    description: "Atomically create a confirmed requirement-to-board split. Before calling, show the user every board name, scope, page list and shared pages and wait for confirmation.",
    inputSchema: z.object({ project_id: projectId, boards: z.array(boardDraft).min(1).max(50) }).strict()
  }, async (input) => respond(async (userId) => ({ boards: await service.createBoards(userId, input.project_id, input.boards.map((board) => ({
    name: board.name,
    description: board.description,
    pageIds: board.page_ids,
    boardId: board.board_id
  }))) })));

  server.registerTool("prototype_update_board", {
    title: "Update Prototype Studio Board",
    description: "Rename a board, update its description or make it the default board.",
    inputSchema: z.object({ project_id: projectId, board_id: boardId, name: z.string().trim().min(1).optional(), description: z.string().trim().max(1000).optional(), is_default: z.boolean().optional() }).strict()
  }, async (input) => respond(async (userId) => ({ board: await service.updateBoard(userId, input.project_id, input.board_id, {
    name: input.name,
    description: input.description,
    isDefault: input.is_default
  }) })));

  server.registerTool("prototype_delete_board", {
    title: "Delete Prototype Studio Board",
    description: "Move a board and its revisions to recoverable trash. Shared pages remain and the last board cannot be deleted.",
    inputSchema: z.object({ project_id: projectId, board_id: boardId }).strict()
  }, async (input) => respond(async (userId) => ({ ...(await service.deleteBoard(userId, input.project_id, input.board_id)), recoverable: true })));

  server.registerTool("prototype_create_page", {
    title: "Create Prototype Studio Page",
    description: "Create ONE validated page inside a project. Pages are content; a canvas/board is the arrangement of pages. When the user should see the result under 画布, pass place_on_board=\"default\" so the page is laid out on the default board. Prefer prototype_create_pages when creating several pages. Validation failures return every offending DSL path under error.details and write nothing.",
    inputSchema: z.object({ project_id: projectId, dsl: z.record(z.any()), place_on_board: z.enum(["none", "default"]).optional() }).strict()
  }, async (input) => respond(async (userId) => service.createPage(userId, input.project_id, input.dsl as unknown as import("@prototype-studio/dsl-schema").PageDSL, { placeOnBoard: input.place_on_board ?? "none" })));

  server.registerTool("prototype_create_pages", {
    title: "Create Prototype Studio Pages (batch, atomic)",
    description: "Create MANY pages in one atomic call: every page is validated first (DSL rules, duplicate ids inside the batch, conflicts with existing pages); if anything is wrong nothing is written and error.details lists index/pageId/path per problem. By default the new pages are laid out in two columns on the default board so the user sees the prototype on the canvas; pass place_on_board=\"none\" to skip, or board_id to target a specific board. Use this instead of calling prototype_create_page in a loop.",
    inputSchema: z.object({
      project_id: projectId,
      dsls: z.array(z.record(z.any())).min(1).max(50),
      place_on_board: z.enum(["none", "default"]).optional(),
      board_id: boardId.optional()
    }).strict()
  }, async (input) => respond(async (userId) => service.createPages(
    userId,
    input.project_id,
    input.dsls as unknown as import("@prototype-studio/dsl-schema").PageDSL[],
    { placeOnBoard: input.board_id ?? input.place_on_board ?? "default" }
  )));

  server.registerTool("prototype_place_pages_on_board", {
    title: "Place Prototype Studio Pages On Board",
    description: "Lay existing pages out on a board (two columns, appended below current content) without duplicating pages that are already placed. Pages are content and boards are arrangement: call this whenever the user expects to see pages on 画布, or when prototype_get_project reports pages_not_on_any_board.",
    inputSchema: z.object({ project_id: projectId, board_id: boardId, page_ids: z.array(pageId).min(1).max(200) }).strict()
  }, async (input) => respond(async (userId) => service.placePagesOnBoard(userId, input.project_id, input.board_id, input.page_ids)));

  server.registerTool("prototype_delete_page", {
    title: "Delete Prototype Studio Page",
    description: "Move a page to the project trash.",
    inputSchema: z.object({ project_id: projectId, page_id: pageId }).strict()
  }, async (input) => respond(async (userId) => service.deletePage(userId, input.project_id, input.page_id)));

  server.registerTool("prototype_list_components", {
    title: "List Prototype Studio Component Templates",
    description: "List reusable component templates (modal/drawer/popover) of a project.",
    inputSchema: z.object({ project_id: projectId }).strict()
  }, async (input) => respond(async (userId) => ({ components: await service.listComponents(userId, input.project_id) })));

  server.registerTool("prototype_get_component_template", {
    title: "Get Prototype Studio Component Template",
    description: "Read one reusable component template by component_id.",
    inputSchema: z.object({ project_id: projectId, component_id: z.string().min(1) }).strict()
  }, async (input) => respond(async (userId) => ({ dsl: await service.getComponentTemplate(userId, input.project_id, input.component_id) })));

  server.registerTool("prototype_create_component_template", {
    title: "Create Prototype Studio Component Template",
    description: "Create a reusable component template (type modal/drawer/popover) from a ComponentTemplateDSL. After creation the template can be inserted into pages or boards as a copy.",
    inputSchema: z.object({ project_id: projectId, dsl: z.record(z.any()) }).strict()
  }, async (input) => respond(async (userId) => service.createComponentTemplate(userId, input.project_id, input.dsl as unknown as import("@prototype-studio/dsl-schema").ComponentTemplateDSL)));

  server.registerTool("prototype_update_component_template", {
    title: "Update Prototype Studio Component Template",
    description: "Overwrite a component template with the given ComponentTemplateDSL (component_id must match the URL).",
    inputSchema: z.object({ project_id: projectId, component_id: z.string().min(1), dsl: z.record(z.any()) }).strict()
  }, async (input) => respond(async (userId) => service.updateComponentTemplate(userId, input.project_id, input.component_id, input.dsl as unknown as import("@prototype-studio/dsl-schema").ComponentTemplateDSL)));

  server.registerTool("prototype_delete_component_template", {
    title: "Delete Prototype Studio Component Template",
    description: "Move a component template to the project trash.",
    inputSchema: z.object({ project_id: projectId, component_id: z.string().min(1) }).strict()
  }, async (input) => respond(async (userId) => service.deleteComponentTemplate(userId, input.project_id, input.component_id)));

  server.registerTool("prototype_apply_commands", {
    title: "Apply Prototype Studio Page Commands",
    description: "Atomically apply page commands through the shared Command Engine. Read the page with prototype_get_dsl first and pass that revision as base_revision; a stale revision fails with REVISION_CONFLICT (error.details carries currentRevision). Supported commands: ADD_COMPONENT {container, component, index?}; UPDATE_COMPONENT {target, changes}; MOVE_COMPONENT {target, container, index}; DELETE_COMPONENT {target}; CREATE_OVERLAY {overlay, index?}; UPDATE_OVERLAY {target, changes}; DELETE_OVERLAY {target}; ADD_RULE {rule}; UPDATE_RULE {target, changes}; DELETE_RULE {target}; ADD_EVENT {event}; UPDATE_EVENT {target, changes}. container is one of search.fields, search.actions, toolbar.actions, table.columns, form.fields, detail.children, sections, overlays. target is a stable component id such as search.status.",
    inputSchema: z.object({
      project_id: projectId,
      page_id: pageId,
      base_revision: z.number().int(),
      commands: z.array(z.record(z.any())),
      operator
    }).strict()
  }, async (input) => respond(async (userId) => service.applyPageCommands(userId, input.project_id, input.page_id, input.base_revision, input.commands as unknown as Command[], "mcp", input.operator)));

  server.registerTool("prototype_apply_board_commands", {
    title: "Apply Prototype Studio Board Commands",
    description: "Atomically apply canvas commands through the shared board engine.",
    inputSchema: z.object({
      project_id: projectId,
      board_id: boardId,
      base_revision: z.number().int(),
      commands: z.array(z.record(z.any())),
      operator
    }).strict()
  }, async (input) => respond(async (userId) => service.applyBoardCommands(userId, input.project_id, input.board_id, input.base_revision, input.commands as unknown as BoardCommand[], "mcp", input.operator)));

  server.registerTool("prototype_validate_dsl", {
    title: "Validate Prototype Studio DSL",
    description: "Validate one or many candidate page DSLs without writing. Pass dsl for a single page, or dsls for a batch; each result lists valid plus the exact error paths. Call this before prototype_create_pages when the DSL is large or hand-written.",
    inputSchema: z.object({ dsl: z.record(z.any()).optional(), dsls: z.array(z.record(z.any())).min(1).max(50).optional() }).strict()
  }, async (input) => respond(async () => (input.dsls ? service.validateDslBatch(input.dsls) : service.validateDsl(input.dsl))));

  server.registerTool("prototype_get_preview_url", {
    title: "Get Prototype Studio Preview URL",
    description: "Return the web preview URL for a project (optionally a page).",
    inputSchema: z.object({ project_id: projectId, page_id: pageId.optional() }).strict()
  }, async (input) => respond(async () => ({ preview_url: service.previewUrl(input.project_id, input.page_id) })));

  server.registerTool("prototype_render_preview", {
    title: "Render Prototype Studio Preview",
    description: "Validate a page and return its web preview URL.",
    inputSchema: z.object({ project_id: projectId, page_id: pageId }).strict()
  }, async (input) => respond(async (userId) => {
    await service.getPageDsl(userId, input.project_id, input.page_id);
    return { preview_url: service.previewUrl(input.project_id, input.page_id), ready: true };
  }));

  return server;
}
