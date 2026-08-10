import {
  deletePage,
  executeProjectCommands,
  getManifest,
  getPage,
  listPages,
  writePage
} from "@prototype-studio/project-store";
import { getComponentLocation, validateDSL } from "@prototype-studio/dsl-validator";
import type { BoardCommand, BoardDSL, Command, PageDSL } from "@prototype-studio/dsl-schema";
import type { MetadataStore } from "../metadata";
import type { ProjectSpaceManager } from "../spaces";

export class McpUnauthorizedError extends Error {
  constructor() {
    super("未授权：请提供有效的 Bearer Token。");
    this.name = "McpUnauthorizedError";
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

  async createProject(userId: string, name: string, description?: string) {
    const user = await this.metadata.getUserById(userId);
    if (!user) throw new McpUnauthorizedError();
    return this.spaces.createSpace(user, name, description);
  }

  async project(userId: string, projectId: string) {
    const path = await this.projectPath(userId, projectId);
    const manifest = await getManifest(path);
    const pages = await listPages(path);
    return { project: { id: projectId, name: manifest.name, description: manifest.description }, pages };
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

  async createPage(userId: string, projectId: string, dsl: PageDSL) {
    const path = await this.projectPath(userId, projectId);
    const validation = validateDSL(dsl);
    if (!validation.valid) throw new Error("页面 DSL 未通过校验。");
    await writePage(path, dsl);
    return { page_id: dsl.page.id, title: dsl.page.title };
  }

  async deletePage(userId: string, projectId: string, pageId: string) {
    await deletePage(await this.projectPath(userId, projectId), pageId);
    return { page_id: pageId, deleted: true, recoverable: true };
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
    return { valid: validateDSL(dsl).valid, errors: validateDSL(dsl).errors };
  }

  previewUrl(projectId: string, pageId?: string) {
    return pageId
      ? `${this.baseUrl}/?project=${projectId}&page=${pageId}`
      : `${this.baseUrl}/?project=${projectId}`;
  }
}
