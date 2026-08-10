import { randomUUID } from "node:crypto";
import { join, normalize, resolve, sep } from "node:path";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import unzipper from "unzipper";
import {
  buildProductPackage,
  createBoard,
  createBoards,
  createProject,
  deleteBoard,
  executeBoardCommands,
  executeProjectCommands,
  getPage,
  listBoards,
  listTrashedBoards,
  openProject,
  deletePage,
  readBoard,
  restoreBoard,
  persistPageSnapshot,
  writePage,
  updateBoard,
  type BoardSummary,
  type TrashedBoardSummary,
  type CreateBoardInput,
  type UpdateBoardInput,
  type PersistPageSnapshotInput,
  type ExecuteBoardCommandsInput
} from "@prototype-studio/project-store";
import type { ExecuteCommandsInput } from "@prototype-studio/command-engine";
import { validateDSL } from "@prototype-studio/dsl-validator";
import type { BoardDSL, PageDSL } from "@prototype-studio/dsl-schema";
import type { MetadataStore, ProjectRow, User } from "./metadata";
import { MetadataError } from "./metadata";
import { newToken } from "./auth";
import { renderBoardsHtml } from "./export";

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
    return { manifest: opened.manifest, pages: opened.pages, boards: opened.boards, board: opened.board };
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

  async listBoards(userId: string, projectId: string): Promise<BoardSummary[]> {
    const row = await this.requireProject(userId, projectId);
    return listBoards(row.spacePath);
  }

  async getBoard(userId: string, projectId: string, boardId?: string) {
    const row = await this.requireProject(userId, projectId);
    return readBoard(row.spacePath, boardId);
  }

  async createBoard(userId: string, projectId: string, input: CreateBoardInput): Promise<BoardDSL> {
    const row = await this.requireProject(userId, projectId);
    const board = await createBoard(row.spacePath, input);
    await this.touchProject(projectId);
    return board;
  }

  async createBoards(userId: string, projectId: string, inputs: CreateBoardInput[]): Promise<BoardDSL[]> {
    const row = await this.requireProject(userId, projectId);
    const boards = await createBoards(row.spacePath, inputs);
    await this.touchProject(projectId);
    return boards;
  }

  async updateBoard(userId: string, projectId: string, boardId: string, input: UpdateBoardInput): Promise<BoardDSL> {
    const row = await this.requireProject(userId, projectId);
    const board = await updateBoard(row.spacePath, boardId, input);
    await this.touchProject(projectId);
    return board;
  }

  async deleteBoard(userId: string, projectId: string, boardId: string) {
    const row = await this.requireProject(userId, projectId);
    const result = await deleteBoard(row.spacePath, boardId);
    await this.touchProject(projectId);
    return result;
  }

  async listTrashedBoards(userId: string, projectId: string): Promise<TrashedBoardSummary[]> {
    const row = await this.requireProject(userId, projectId);
    return listTrashedBoards(row.spacePath);
  }

  async restoreBoard(userId: string, projectId: string, trashId: string): Promise<BoardDSL> {
    const row = await this.requireProject(userId, projectId);
    const board = await restoreBoard(row.spacePath, trashId);
    await this.touchProject(projectId);
    return board;
  }

  async applyBoardCommands(userId: string, projectId: string, boardId: string, input: ExecuteBoardCommandsInput) {
    const row = await this.requireProject(userId, projectId);
    const result = await executeBoardCommands(row.spacePath, boardId, input);
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
      if (objectDir === "boards") {
        const boardDirs = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        for (const boardId of boardDirs) {
          const files = (await readdir(join(dir, boardId))).filter((file) => file.endsWith(".json")).sort();
          for (const file of files) entries.push({ object: `boards/${boardId}`, revision: Number(file.slice(0, -5)), path: `boards/${boardId}/${file}` });
        }
        continue;
      }
      const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
      for (const file of files) {
        entries.push({ object: objectDir, revision: Number(file.slice(0, -5)), path: `${objectDir}/${file}` });
      }
    }
    entries.sort((a, b) => a.revision - b.revision);
    return entries;
  }

  async productPackage(userId: string, projectId: string) {
    const row = await this.requireProject(userId, projectId);
    return buildProductPackage(row.spacePath, {});
  }

  async exportZip(userId: string, projectId: string): Promise<Buffer> {
    const row = await this.requireProject(userId, projectId);
    const { ZipArchive } = await import("archiver");
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
    const boards = await Promise.all(opened.boards.map((board) => readBoard(row.spacePath, board.id)));
    return {
      project: { id: row.id, name: row.name, description: row.description, defaultBoardId: opened.manifest.defaultBoardId ?? opened.board.id },
      pages,
      boards
    };
  }

  async shareHtml(token: string): Promise<string> {
    const data = await this.shareData(token);
    const row = await this.metadata.getProjectById(data.project.id);
    const pages: Record<string, PageDSL> = {};
    for (const summary of data.pages) {
      pages[summary.id] = await getPage(row!.spacePath, summary.id);
    }
    return renderBoardsHtml(data.boards, pages, data.project.name, data.project.defaultBoardId);
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
    // Remove the scaffold board so an imported default board (including legacy board.yaml) is the only source of truth.
    await rm(resolve(row.spacePath, "boards"), { recursive: true, force: true });
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
