import {
  deletePage,
  executeBoardCommands,
  executeProjectCommands,
  getManifest,
  getPage,
  listPages,
  readBoard,
  writeBoard,
  writePage
} from "@prototype-studio/project-store";
import { getComponentLocation, validateDSL } from "@prototype-studio/dsl-validator";
import {
  confirmPagePlan,
  createBoardFromTemplates,
  createPagePlanFromTemplates,
  generateConfirmedPageDSLs,
  parseRequirementTemplates
} from "@prototype-studio/requirement-engine";
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

  async createProjectFromRequirement(userId: string, name: string, input: string) {
    const templates = parseRequirementTemplates(input);
    if (!templates) throw new Error("需求无法解析为结构化页面模板。");
    const plan = createPagePlanFromTemplates(templates);
    const generated = generateConfirmedPageDSLs(confirmPagePlan(plan));
    const user = await this.metadata.getUserById(userId);
    if (!user) throw new McpUnauthorizedError();
    const row = await this.spaces.createSpace(user, name ?? templates.title, "由 Codex 从需求创建");
    for (const { dsl } of generated) await writePage(row.spacePath, dsl);
    const board = createBoardFromTemplates(templates);
    if (board) await writeBoard(row.spacePath, { ...board, id: `${row.id}-board`, revision: 1 });
    return { project: row, pages: generated.map((item) => item.dsl.page.id) };
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

  async getRequirement(userId: string, projectId: string, requirementId: string) {
    const result = await this.spaces.requirements(userId, projectId, requirementId);
    return { requirement_id: requirementId, file: result.file, content: result.content, truncated: result.truncated };
  }

  async getBoard(userId: string, projectId: string): Promise<BoardDSL> {
    return readBoard(await this.projectPath(userId, projectId));
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

  async applyBoardCommands(userId: string, projectId: string, baseRevision: number, commands: BoardCommand[], source: string, operator: string) {
    const path = await this.projectPath(userId, projectId);
    const result = await executeBoardCommands(path, { baseRevision, commands, source: source as "manual", operator });
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
