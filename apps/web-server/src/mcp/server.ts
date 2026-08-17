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

  type Outcome<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

  const execute = async <T>(operation: () => Promise<T>): Promise<Outcome<T>> => {
    try {
      return { ok: true, data: await operation() };
    } catch (error) {
      if (error instanceof McpUnauthorizedError) return { ok: false, error: { code: "UNAUTHORIZED", message: error.message } };
      return { ok: false, error: { code: (error as { code?: string }).code ?? "INTERNAL_ERROR", message: error instanceof Error ? error.message : "未知错误" } };
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
    description: "Create a new project space. Optionally deliver pages so the project is immediately usable.",
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      pages: z.array(z.record(z.any())).optional()
    }).strict()
  }, async (input) => respond(async (userId) => {
    const row = await service.createProject(userId, input.name, input.description);
    for (const page of input.pages ?? []) await service.createPage(userId, row.id, page as unknown as import("@prototype-studio/dsl-schema").PageDSL);
    return { project_id: row.id, name: row.name, preview_url: service.previewUrl(row.id) };
  }));

  server.registerTool("prototype_get_project", {
    title: "Get Prototype Studio Project",
    description: "Read project metadata and page list.",
    inputSchema: z.object({ project_id: projectId }).strict()
  }, async (input) => respond(async (userId) => service.project(userId, input.project_id)));

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
    description: "Create a validated page DSL inside a project. For back-office systems, include layout.navigation (title + items with key/label/icon/path/active/children) so the renderer draws a left sidebar shell.",
    inputSchema: z.object({ project_id: projectId, dsl: z.record(z.any()) }).strict()
  }, async (input) => respond(async (userId) => service.createPage(userId, input.project_id, input.dsl as unknown as import("@prototype-studio/dsl-schema").PageDSL)));

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
    description: "Atomically apply page commands through the shared Command Engine.",
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
    description: "Validate a candidate page DSL without writing.",
    inputSchema: z.object({ dsl: z.record(z.any()) }).strict()
  }, async (input) => respond(async () => service.validateDsl(input.dsl)));

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
