import { randomUUID } from "node:crypto";
import { join, normalize, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { ZipArchive } from "archiver";
import unzipper from "unzipper";
import {
  buildProductPackage,
  createProject,
  executeBoardCommands,
  executeProjectCommands,
  getPage,
  openProject,
  deletePage,
  readBoard,
  persistPageSnapshot,
  writePage,
  type PersistPageSnapshotInput,
  type ExecuteBoardCommandsInput
} from "@prototype-studio/project-store";
import type { ExecuteCommandsInput } from "@prototype-studio/command-engine";
import { validateDSL } from "@prototype-studio/dsl-validator";
import type { PageDSL } from "@prototype-studio/dsl-schema";
import type { MetadataStore, ProjectRow, User } from "./metadata";
import { MetadataError } from "./metadata";
import { newToken } from "./auth";
import { renderBoardHtml } from "./export";

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

  private async touchProject(projectId: string): Promise<void> {
    await this.metadata.updateProject(projectId, {});
  }

  async requireProject(userId: string, projectId: string): Promise<ProjectRow> {
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
    await this.touchProject(projectId);
    return { id: dsl.page.id, title: dsl.page.title };
  }

  async applyPageCommands(userId: string, projectId: string, pageId: string, input: Omit<ExecuteCommandsInput, "dsl">) {
    const row = await this.requireProject(userId, projectId);
    const result = await executeProjectCommands(row.spacePath, pageId, input);
    await this.touchProject(projectId);
    return result;
  }

  async putPageSnapshot(userId: string, projectId: string, pageId: string, dsl: PageDSL, input: PersistPageSnapshotInput) {
    const row = await this.requireProject(userId, projectId);
    if (dsl.page.id !== pageId) throw new SpaceError("INVALID_INPUT", "page.id 与 URL 不一致。");
    const result = await persistPageSnapshot(row.spacePath, dsl, input);
    await this.touchProject(projectId);
    return result;
  }

  async deletePage(userId: string, projectId: string, pageId: string): Promise<void> {
    const row = await this.requireProject(userId, projectId);
    await deletePage(row.spacePath, pageId);
    await this.touchProject(projectId);
  }

  async getBoard(userId: string, projectId: string) {
    const row = await this.requireProject(userId, projectId);
    return readBoard(row.spacePath);
  }

  async applyBoardCommands(userId: string, projectId: string, input: ExecuteBoardCommandsInput) {
    const row = await this.requireProject(userId, projectId);
    const result = await executeBoardCommands(row.spacePath, input);
    await this.touchProject(projectId);
    return result;
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

  async requirements(userId: string, projectId: string, idOrFile: string) {
    const row = await this.requireProject(userId, projectId);
    const requirementsRoot = resolve(row.spacePath, "requirements");
    const candidates = idOrFile.includes(".") ? [idOrFile] : [`${idOrFile}.md`, `${idOrFile}.txt`, `${idOrFile}.requirement.json`];
    for (const candidate of candidates) {
      const target = resolve(requirementsRoot, candidate);
      if (target === requirementsRoot || !target.startsWith(`${requirementsRoot}${sep}`)) {
        throw new SpaceError("INVALID_INPUT", "需求文件名越界。");
      }
      try {
        const content = await readFile(target, "utf8");
        return { file: candidate, content: content.slice(0, 25_000), truncated: content.length > 25_000 };
      } catch {
        // try next candidate
      }
    }
    throw new SpaceError("NOT_FOUND", "需求文件不存在。");
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

  async createShare(userId: string, projectId: string, baseUrl: string, expiresInSeconds?: number) {
    await this.requireProject(userId, projectId);
    const token = newToken();
    await this.metadata.createShareLink({
      id: randomUUID(),
      projectId,
      token,
      mode: "read",
      createdBy: userId,
      ...(expiresInSeconds ? { expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString() } : {}),
      createdAt: new Date().toISOString()
    });
    return { token, url: `${baseUrl}/share/${token}` };
  }

  async revokeShare(userId: string, projectId: string, token: string): Promise<void> {
    await this.requireProject(userId, projectId);
    await this.metadata.deleteShareLink(token);
  }

  async shareData(token: string) {
    const link = await this.metadata.getShareLinkByToken(token);
    if (!link) throw new SpaceError("NOT_FOUND", "分享链接不存在。");
    if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) {
      throw new SpaceError("NOT_FOUND", "分享链接已过期。");
    }
    const row = await this.metadata.getProjectById(link.projectId);
    if (!row || row.status !== "active") throw new SpaceError("NOT_FOUND", "项目不可访问。");
    const opened = await openProject(row.spacePath);
    const pages: Array<{ id: string; title: string }> = [];
    for (const summary of opened.pages) {
      pages.push({ id: summary.id, title: summary.title });
    }
    return { project: { id: row.id, name: row.name, description: row.description }, pages, board: opened.board };
  }

  async shareHtml(token: string): Promise<string> {
    const data = await this.shareData(token);
    const row = await this.metadata.getProjectById(data.project.id);
    const pages: Record<string, PageDSL> = {};
    for (const summary of data.pages) {
      pages[summary.id] = await getPage(row!.spacePath, summary.id);
    }
    return renderBoardHtml(data.board, pages, data.project.name);
  }

  async importZip(userId: string, name: string, zipBase64: string): Promise<ProjectRow> {
    const user = await this.metadata.getUserById(userId);
    if (!user) throw new SpaceError("FORBIDDEN", "用户不存在。");
    const buffer = Buffer.from(zipBase64, "base64");
    if (buffer.length > 64 * 1024 * 1024) throw new SpaceError("INVALID_INPUT", "导入包超过 64 MiB 限制。");
    const directory = await unzipper.Open.buffer(buffer);
    const files: Array<{ path: string; buffer: Buffer }> = [];
    for (const entry of directory.files) {
      if (entry.type === "Directory") continue;
      const normalized = normalize(entry.path).replace(/\\/g, "/");
      if (normalized.startsWith("../") || normalized.includes("/../") || normalized.startsWith("/") || normalized.match(/^[a-zA-Z]:/)) {
        throw new SpaceError("INVALID_INPUT", "导入包包含不安全路径。");
      }
      files.push({ path: normalized, buffer: await entry.buffer() });
    }
    if (!files.some((file) => file.path === "project.yaml")) {
      throw new SpaceError("INVALID_INPUT", "导入包缺少 project.yaml，不是有效项目。");
    }
    const row = await this.createSpace(user, name, "从项目整包导入恢复");
    for (const file of files) {
      const target = resolve(row.spacePath, file.path);
      if (target === row.spacePath || !target.startsWith(`${row.spacePath}${sep}`)) continue;
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, file.buffer);
    }
    await openProject(row.spacePath);
    return row;
  }
}

export { MetadataError };
