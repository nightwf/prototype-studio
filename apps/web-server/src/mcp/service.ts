import {
  createComponentTemplate,
  deleteComponentTemplate,
  deletePage,
  executeProjectCommands,
  getComponentTemplate,
  getManifest,
  getPage,
  listBoards,
  listComponentTemplates,
  listPages,
  readBoard,
  writeComponentTemplate,
  writePage
} from "@prototype-studio/project-store";
import { getComponentLocation, validateDSL } from "@prototype-studio/dsl-validator";
import type { BoardCommand, BoardDSL, BoardPageObject, Command, ComponentTemplateDSL, PageDSL } from "@prototype-studio/dsl-schema";
import type { MetadataStore } from "../metadata";
import type { ProjectSpaceManager } from "../spaces";

export class McpUnauthorizedError extends Error {
  constructor() {
    super("未授权：请提供有效的 Bearer Token。");
    this.name = "McpUnauthorizedError";
  }
}

export class CloudMcpValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "CloudMcpValidationError";
  }
}

export class CloudMcpService {
  constructor(
    private readonly metadata: MetadataStore,
    private readonly spaces: ProjectSpaceManager,
    private readonly baseUrl: string
  ) {}

  async userFor(token: string | undefined) {
    const user = token ? await this.metadata.getUserByApiToken(token) : undefined;
    if (!user) throw new McpUnauthorizedError();
    return user;
  }

  async projectPath(userId: string, projectId: string): Promise<string> {
    const row = await this.spaces.requireProject(userId, projectId);
    return row.spacePath;
  }

  async listProjects(userId: string) {
    return this.spaces.listSpaces(userId);
  }

  async listAccountTemplates(userId: string) {
    return this.metadata.listAccountTemplates(userId);
  }

  async getAccountTemplate(userId: string, templateId: string) {
    const template = await this.metadata.getAccountTemplate(userId, templateId);
    if (!template) throw new Error(`账号模板“${templateId}”不存在。`);
    return template;
  }

  async createAccountTemplate(userId: string, input: { kind: "component" | "page"; name: string; description?: string; type: string; data: Record<string, unknown> }) {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      ownerId: userId,
      kind: input.kind,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      type: input.type.trim(),
      data: input.data,
      createdAt: now,
      updatedAt: now
    };
    await this.metadata.createAccountTemplate(row);
    return { template_id: row.id, kind: row.kind, name: row.name, type: row.type };
  }

  async updateAccountTemplate(userId: string, templateId: string, patch: { name?: string; description?: string; type?: string; data?: Record<string, unknown> }) {
    await this.getAccountTemplate(userId, templateId);
    await this.metadata.updateAccountTemplate(userId, templateId, patch);
    return { template_id: templateId, updated: true };
  }

  async deleteAccountTemplate(userId: string, templateId: string) {
    await this.getAccountTemplate(userId, templateId);
    await this.metadata.deleteAccountTemplate(userId, templateId);
    return { template_id: templateId, deleted: true };
  }

  async createProject(userId: string, name: string, description?: string) {
    const user = await this.metadata.getUserById(userId);
    if (!user) throw new McpUnauthorizedError();
    return this.spaces.createSpace(user, name, description);
  }

  async project(userId: string, projectId: string) {
    const path = await this.projectPath(userId, projectId);
    const manifest = await getManifest(path);
    const pages = await listPages(path);
    const boards = await listBoards(path);
    const placedAnywhere = new Set<string>();
    const boardSummaries = [];
    for (const summary of boards) {
      const board = await readBoard(path, summary.id);
      const placedPageIds = board.objects
        .filter((object): object is BoardPageObject => object.type === "page")
        .map((object) => object.pageId);
      for (const pageId of placedPageIds) placedAnywhere.add(pageId);
      boardSummaries.push({
        id: board.id,
        name: board.name,
        is_default: board.id === (manifest.defaultBoardId ?? "main"),
        revision: board.revision,
        object_count: board.objects.length,
        placed_page_ids: [...new Set(placedPageIds)]
      });
    }
    const unplaced = pages.filter((page) => !placedAnywhere.has(page.id)).map((page) => page.id);
    return {
      project: { id: projectId, name: manifest.name, description: manifest.description },
      pages,
      boards: boardSummaries,
      default_board_id: manifest.defaultBoardId ?? "main",
      pages_not_on_any_board: unplaced,
      workflow_hint: unplaced.length
        ? `有 ${unplaced.length} 个页面还没放到任何画布。页面是内容、画布是编排；若要用户在“画布”中看到原型，请调用 prototype_place_pages_on_board 把它们铺到画布上。`
        : "所有页面都已经放到画布上。"
    };
  }

  /** 回滚：把刚创建但内容未交付成功的项目移入回收站（可恢复）。 */
  async archiveProject(userId: string, projectId: string) {
    await this.spaces.archiveSpace(userId, projectId);
    return { project_id: projectId, archived: true };
  }

  async listProjectPages(userId: string, projectId: string) {
    return listPages(await this.projectPath(userId, projectId));
  }

  async getPageDsl(userId: string, projectId: string, pageId: string): Promise<PageDSL> {
    return getPage(await this.projectPath(userId, projectId), pageId);
  }

  async getComponent(userId: string, projectId: string, pageId: string, componentId: string) {
    const dsl = await this.getPageDsl(userId, projectId, pageId);
    const location = getComponentLocation(dsl, componentId);
    if (!location) throw new Error(`找不到组件“${componentId}”。`);
    return { component: location.component, dsl_path: location.path, parent_id: location.parentId, revision: dsl.revision };
  }

  async listBoards(userId: string, projectId: string) {
    return this.spaces.listBoards(userId, projectId);
  }

  async getBoard(userId: string, projectId: string, boardId: string): Promise<BoardDSL> {
    return this.spaces.getBoard(userId, projectId, boardId);
  }

  async createBoard(userId: string, projectId: string, input: { name: string; description?: string; pageIds?: string[]; boardId?: string }) {
    return this.spaces.createBoard(userId, projectId, input);
  }

  async createBoards(userId: string, projectId: string, inputs: Array<{ name: string; description?: string; pageIds?: string[]; boardId?: string }>) {
    return this.spaces.createBoards(userId, projectId, inputs);
  }

  async updateBoard(userId: string, projectId: string, boardId: string, input: { name?: string; description?: string; isDefault?: boolean }) {
    return this.spaces.updateBoard(userId, projectId, boardId, input);
  }

  async deleteBoard(userId: string, projectId: string, boardId: string) {
    return this.spaces.deleteBoard(userId, projectId, boardId);
  }

  async createPage(userId: string, projectId: string, dsl: PageDSL, options: { placeOnBoard?: "none" | "default" | string } = {}) {
    const path = await this.projectPath(userId, projectId);
    const validation = validateDSL(dsl);
    if (!validation.valid) {
      throw new CloudMcpValidationError(
        "INVALID_INPUT",
        `页面 DSL 未通过校验（${validation.errors.length} 处问题），未写入任何文件。请按 details 中的 path 逐条修正后重试。`,
        validation.errors
      );
    }
    await writePage(path, dsl);
    const mode = options.placeOnBoard ?? "none";
    const placement = mode === "none"
      ? undefined
      : await this.spaces.placePagesOnBoard(userId, projectId, await this.resolveBoardId(path, mode), [dsl.page.id], { source: "mcp", operator: "codex" });
    return { page_id: dsl.page.id, title: dsl.page.title, revision: dsl.revision, placement };
  }

  private async resolveBoardId(path: string, mode: "default" | string): Promise<string> {
    if (mode !== "default") return mode;
    const manifest = await getManifest(path);
    return manifest.defaultBoardId ?? "main";
  }

  /** 原子批量建页；默认把新页面按两列铺到默认画布，确保用户在画布中能看到原型。 */
  async createPages(userId: string, projectId: string, dsls: PageDSL[], options: { placeOnBoard?: "none" | "default" | string } = {}) {
    const created = await this.spaces.createPages(userId, projectId, dsls);
    const mode = options.placeOnBoard ?? "default";
    const placement = mode === "none" || !created.length
      ? undefined
      : await this.spaces.placePagesOnBoard(userId, projectId, await this.resolveBoardId(await this.projectPath(userId, projectId), mode), created.map((page) => page.id), { source: "mcp", operator: "codex" });
    return {
      created_count: created.length,
      pages: created.map((page) => ({ page_id: page.id, title: page.title, revision: page.revision })),
      placement
    };
  }

  async placePagesOnBoard(userId: string, projectId: string, boardId: string, pageIds: string[]) {
    return this.spaces.placePagesOnBoard(userId, projectId, boardId, pageIds, { source: "mcp", operator: "codex" });
  }

  async deletePage(userId: string, projectId: string, pageId: string) {
    await deletePage(await this.projectPath(userId, projectId), pageId);
    return { page_id: pageId, deleted: true, recoverable: true };
  }

  async listComponents(userId: string, projectId: string) {
    return listComponentTemplates(await this.projectPath(userId, projectId));
  }

  async getComponentTemplate(userId: string, projectId: string, componentId: string): Promise<ComponentTemplateDSL> {
    return getComponentTemplate(await this.projectPath(userId, projectId), componentId);
  }

  async createComponentTemplate(userId: string, projectId: string, dsl: ComponentTemplateDSL) {
    await createComponentTemplate(await this.projectPath(userId, projectId), dsl);
    return { component_id: dsl.component.id, name: dsl.component.name, type: dsl.component.type, revision: dsl.revision };
  }

  async updateComponentTemplate(userId: string, projectId: string, componentId: string, dsl: ComponentTemplateDSL) {
    if (dsl.component.id !== componentId) throw new Error(`组件 ID“${dsl.component.id}”与目标不一致。`);
    await writeComponentTemplate(await this.projectPath(userId, projectId), dsl, { overwrite: true });
    return { component_id: dsl.component.id, name: dsl.component.name, revision: dsl.revision };
  }

  async deleteComponentTemplate(userId: string, projectId: string, componentId: string) {
    await deleteComponentTemplate(await this.projectPath(userId, projectId), componentId);
    return { component_id: componentId, deleted: true, recoverable: true };
  }

  async applyPageCommands(userId: string, projectId: string, pageId: string, baseRevision: number, commands: Command[], source: string, operator: string) {
    const path = await this.projectPath(userId, projectId);
    const result = await executeProjectCommands(path, pageId, {
      baseRevision,
      commands,
      source: source as "manual",
      operator
    });
    return { revision: result.revision.revision, changed_component_ids: result.revision.changedComponentIds };
  }

  async applyBoardCommands(userId: string, projectId: string, boardId: string, baseRevision: number, commands: BoardCommand[], source: string, operator: string) {
    const result = await this.spaces.applyBoardCommands(userId, projectId, boardId, { baseRevision, commands, source: source as "manual", operator });
    return { revision: result.revision.revision, changed_object_ids: result.revision.changedObjectIds };
  }

  validateDsl(dsl: unknown) {
    const validation = validateDSL(dsl);
    return { valid: validation.valid, errors: validation.errors, warnings: validation.warnings };
  }

  /** 批量校验：一次返回每一页的校验结果，便于提交前自检。 */
  validateDslBatch(dsls: unknown[]) {
    const results = dsls.map((dsl, index) => {
      const validation = validateDSL(dsl);
      return { index, valid: validation.valid, errors: validation.errors, warnings: validation.warnings };
    });
    return { valid: results.every((item) => item.valid), results };
  }

  previewUrl(projectId: string, pageId?: string) {
    return pageId
      ? `${this.baseUrl}/?project=${projectId}&page=${pageId}`
      : `${this.baseUrl}/?project=${projectId}`;
  }
}
