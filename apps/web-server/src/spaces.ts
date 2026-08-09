import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { ZipArchive } from "archiver";
import {
  buildProductPackage,
  createProject,
  executeBoardCommands,
  executeProjectCommands,
  getPage,
  openProject,
  readBoard,
  writePage,
  type ExecuteBoardCommandsInput
} from "@prototype-studio/project-store";
import type { ExecuteCommandsInput } from "@prototype-studio/command-engine";
import { validateDSL } from "@prototype-studio/dsl-validator";
import type { PageDSL } from "@prototype-studio/dsl-schema";
import type { MetadataStore, ProjectRow, User } from "./metadata";
import { MetadataError } from "./metadata";

export class SpaceError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID_INPUT" | "ARCHIVED",
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "SpaceError";
  }
}

export class ProjectSpaceManager {
  constructor(
    private readonly metadata: MetadataStore,
    private readonly spacesBaseDir: string
  ) {}

  private spacePath(projectId: string): string {
    return resolve(this.spacesBaseDir, projectId);
  }

  private async requireProject(userId: string, projectId: string): Promise<ProjectRow> {
    const row = await this.metadata.getProjectById(projectId);
    if (!row) throw new SpaceError("NOT_FOUND", "项目不存在。");
    if (row.status !== "active") throw new SpaceError("ARCHIVED", "项目已归档。");
    if (row.ownerId !== userId && !(await this.metadata.hasProjectMember(projectId, userId))) {
      throw new SpaceError("FORBIDDEN", "无权访问该项目。");
    }
    return row;
  }

  async createSpace(user: User, name: string, description?: string): Promise<ProjectRow> {
    const id = randomUUID();
    const row: ProjectRow = {
      id,
      ownerId: user.id,
      name,
      description,
      status: "active",
      spacePath: this.spacePath(id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await mkdir(this.spacesBaseDir, { recursive: true });
    await createProject(row.spacePath, { name, description, projectId: id });
    await this.metadata.createProject(row);
    await this.metadata.addProjectMember(id, user.id, "owner");
    return row;
  }

  async listSpaces(userId: string): Promise<ProjectRow[]> {
    return this.metadata.listProjectsByOwner(userId);
  }

  async renameSpace(userId: string, projectId: string, name: string): Promise<ProjectRow> {
    const row = await this.requireProject(userId, projectId);
    await this.metadata.updateProject(projectId, { name });
    return { ...row, name };
  }

  async archiveSpace(userId: string, projectId: string): Promise<void> {
    const row = await this.requireProject(userId, projectId);
    await this.metadata.updateProject(projectId, { status: "archived" });
    const trash = resolve(this.spacesBaseDir, ".trash");
    await mkdir(trash, { recursive: true });
    await rename(row.spacePath, join(trash, projectId)).catch(() => undefined);
  }

  async tree(userId: string, projectId: string) {
    const row = await this.requireProject(userId, projectId);
    const opened = await openProject(row.spacePath);
    return { manifest: opened.manifest, pages: opened.pages, board: opened.board };
  }

  async getPageDsl(userId: string, projectId: string, pageId: string): Promise<PageDSL> {
    const row = await this.requireProject(userId, projectId);
    return getPage(row.spacePath, pageId);
  }

  async createPage(userId: string, projectId: string, dsl: PageDSL): Promise<{ id: string; title: string }> {
    const row = await this.requireProject(userId, projectId);
    const validation = validateDSL(dsl);
    if (!validation.valid) {
      throw new SpaceError("INVALID_INPUT", "页面 DSL 未通过校验。", validation.errors);
    }
    await writePage(row.spacePath, dsl);
    return { id: dsl.page.id, title: dsl.page.title };
  }

  async applyPageCommands(userId: string, projectId: string, pageId: string, input: Omit<ExecuteCommandsInput, "dsl">) {
    const row = await this.requireProject(userId, projectId);
    return executeProjectCommands(row.spacePath, pageId, input);
  }

  async getBoard(userId: string, projectId: string) {
    const row = await this.requireProject(userId, projectId);
    return readBoard(row.spacePath);
  }

  async applyBoardCommands(userId: string, projectId: string, input: ExecuteBoardCommandsInput) {
    const row = await this.requireProject(userId, projectId);
    return executeBoardCommands(row.spacePath, input);
  }

  async revisions(userId: string, projectId: string) {
    const row = await this.requireProject(userId, projectId);
    const revisionsRoot = join(row.spacePath, ".prototype", "revisions");
    const entries: Array<{ object: string; revision: number; path: string }> = [];
    let objectDirs: string[] = [];
    try {
      objectDirs = (await readdir(revisionsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      objectDirs = [];
    }
    for (const objectDir of objectDirs) {
      const dir = join(revisionsRoot, objectDir);
      const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
      for (const file of files) {
        entries.push({ object: objectDir, revision: Number(file.slice(0, -5)), path: `${objectDir}/${file}` });
      }
    }
    entries.sort((a, b) => a.revision - b.revision);
    return entries;
  }

  async requirements(userId: string, projectId: string, fileName: string) {
    const row = await this.requireProject(userId, projectId);
    const requirementsRoot = resolve(row.spacePath, "requirements");
    const target = resolve(requirementsRoot, fileName);
    if (target !== requirementsRoot && !target.startsWith(`${requirementsRoot}${sep}`)) {
      throw new SpaceError("INVALID_INPUT", "需求文件名越界。");
    }
    try {
      const content = await readFile(target, "utf8");
      return { file: fileName, content: content.slice(0, 25_000), truncated: content.length > 25_000 };
    } catch {
      throw new SpaceError("NOT_FOUND", "需求文件不存在。");
    }
  }

  async productPackage(userId: string, projectId: string) {
    const row = await this.requireProject(userId, projectId);
    return buildProductPackage(row.spacePath, {});
  }

  async exportZip(userId: string, projectId: string): Promise<Buffer> {
    const row = await this.requireProject(userId, projectId);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const output = new Promise<Buffer>((resolve, reject) => {
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
    });
    archive.directory(row.spacePath, false);
    await archive.finalize();
    return output;
  }
}

export { MetadataError };
