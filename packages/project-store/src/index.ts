import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import chokidar, { type FSWatcher } from "chokidar";
import { parse, stringify } from "yaml";
import { createReapplyRevision, createRevertRevision, executeCommands, type ExecuteCommandsInput } from "@prototype-studio/command-engine";
import { applyBoardCommands, type ApplyBoardCommandsInput } from "@prototype-studio/command-engine";
import {
  DESIGN_SYSTEM_VERSION,
  DSL_VERSION,
  RENDERER_VERSION,
  type BoardDSL,
  type BoardRevisionRecord,
  type Command,
  type ComponentTemplateDSL,
  type PageDSL,
  type ProjectManifest,
  type RevisionRecord,
  type RevisionSource
} from "@prototype-studio/dsl-schema";
import { validateBoard, validateComponentTemplate, validateDSL, type DSLValidationResult } from "@prototype-studio/dsl-validator";

export class ProjectStoreError extends Error {
  constructor(
    public readonly code:
      | "PROJECT_NOT_FOUND"
      | "INVALID_PROJECT"
      | "PAGE_NOT_FOUND"
      | "PAGE_EXISTS"
      | "COMPONENT_NOT_FOUND"
      | "COMPONENT_EXISTS"
      | "PATH_OUTSIDE_PROJECT"
      | "INVALID_DSL_FILE"
      | "REVISION_NOT_FOUND"
      | "BOARD_NOT_FOUND"
      | "BOARD_EXISTS"
      | "LAST_BOARD",
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ProjectStoreError";
  }
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  projectId?: string;
  now?: string;
}

export interface ProjectPageSummary {
  id: string;
  title: string;
  type: PageDSL["page"]["type"];
  status: PageDSL["page"]["status"];
  revision: number;
  file: string;
}

export interface OpenedProject {
  root: string;
  manifest: ProjectManifest;
  pages: ProjectPageSummary[];
  boards: BoardSummary[];
  board: BoardDSL;
}

export interface BoardSummary {
  id: string;
  name: string;
  description?: string;
  revision: number;
  pageCount: number;
  objectCount: number;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
}

export interface TrashedBoardSummary {
  trashId: string;
  boardId: string;
  name: string;
  description?: string;
  deletedAt: string;
}

export interface CreateBoardInput {
  name: string;
  description?: string;
  pageIds?: string[];
  boardId?: string;
  now?: string;
}

export interface UpdateBoardInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  now?: string;
}

export interface ExternalFileEvent {
  kind: "add" | "change" | "unlink";
  relativePath: string;
  validation?: DSLValidationResult;
  pageId?: string;
}

const requiredDirectories = ["pages", "components", "boards", "data", "flows", "assets", ".prototype", ".prototype/revisions", ".prototype/revisions/boards", ".prototype/trash/boards", ".prototype/cache"];

function projectPath(root: string, relative: string): string {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, relative);
  if (resolved !== absoluteRoot && !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new ProjectStoreError("PATH_OUTSIDE_PROJECT", `路径“${relative}”超出当前 Project Root。`);
  }
  return resolved;
}

function pageRelativePath(pageId: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(pageId)) {
    throw new ProjectStoreError("INVALID_PROJECT", `页面 ID“${pageId}”不符合文件命名规则。`);
  }
  return `pages/${pageId}.ui.yaml`;
}

function componentTemplateRelativePath(componentId: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(componentId)) {
    throw new ProjectStoreError("INVALID_PROJECT", `组件 ID“${componentId}”不符合文件命名规则。`);
  }
  return `components/${componentId}.ui-component.yaml`;
}

function assertBoardId(boardId: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(boardId)) {
    throw new ProjectStoreError("INVALID_PROJECT", `画布 ID“${boardId}”不符合文件命名规则。`);
  }
  return boardId;
}

function boardRelativePath(boardId: string): string {
  return `boards/${assertBoardId(boardId)}.board.yaml`;
}

function normalizedBoard(raw: Partial<BoardDSL>, options: { id: string; name: string; projectId?: string; now: string }): BoardDSL {
  return {
    dslVersion: DSL_VERSION,
    id: options.id,
    projectId: raw.projectId ?? options.projectId,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : options.name,
    description: raw.description,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : options.now,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : options.now,
    revision: typeof raw.revision === "number" && raw.revision > 0 ? raw.revision : 1,
    objects: Array.isArray(raw.objects) ? raw.objects : [],
    links: Array.isArray(raw.links) ? raw.links : []
  };
}

function slugifyBoardId(name: string): string {
  const ascii = name.trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(ascii) ? ascii : `board-${ascii || randomUUID().slice(0, 8)}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

async function appendAudit(root: string, revision: RevisionRecord): Promise<void> {
  const auditFile = projectPath(root, ".prototype/audit.jsonl");
  await appendFile(auditFile, `${JSON.stringify({
    revisionId: revision.id,
    pageId: revision.pageId,
    revision: revision.revision,
    source: revision.source,
    operator: revision.operator,
    changedComponentIds: revision.changedComponentIds,
    createdAt: revision.createdAt,
    revertsRevision: revision.revertsRevision,
    reappliesRevision: revision.reappliesRevision
  })}\n`, "utf8");
}

async function appendBoardAudit(root: string, revision: BoardRevisionRecord): Promise<void> {
  const auditFile = projectPath(root, ".prototype/audit.jsonl");
  await appendFile(auditFile, `${JSON.stringify({
    revisionId: revision.id,
    boardId: revision.boardId,
    revision: revision.revision,
    source: revision.source,
    operator: revision.operator,
    changedObjectIds: revision.changedObjectIds,
    createdAt: revision.createdAt
  })}\n`, "utf8");
}

export async function createProject(root: string, input: CreateProjectInput): Promise<OpenedProject> {
  const absoluteRoot = path.resolve(root);
  await mkdir(absoluteRoot, { recursive: true });
  const manifestPath = projectPath(absoluteRoot, "project.yaml");
  if (await pathExists(manifestPath)) {
    throw new ProjectStoreError("INVALID_PROJECT", "目标目录已经包含 project.yaml，请使用“打开项目”。");
  }
  await Promise.all(requiredDirectories.map((directory) => mkdir(projectPath(absoluteRoot, directory), { recursive: true })));
  const now = input.now ?? new Date().toISOString();
  const manifest: ProjectManifest = {
    id: input.projectId ?? randomUUID(),
    name: input.name,
    description: input.description,
    status: "active",
    projectFormatVersion: 2,
    defaultBoardId: "main",
    dslVersion: DSL_VERSION,
    rendererVersion: RENDERER_VERSION,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    createdAt: now,
    updatedAt: now
  };
  await atomicWrite(manifestPath, stringify(manifest, { lineWidth: 0 }));
  const board: BoardDSL = {
    dslVersion: DSL_VERSION,
    id: "main",
    projectId: manifest.id,
    name: "主画布",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    objects: [],
    links: []
  };
  await writeBoard(absoluteRoot, board);
  await atomicWrite(projectPath(absoluteRoot, ".gitignore"), ".prototype/cache/\n*.tmp\n");
  await atomicWrite(projectPath(absoluteRoot, ".prototype/index.json"), JSON.stringify({ version: 1, generatedAt: now, pages: [] }, null, 2));
  return { root: absoluteRoot, manifest, pages: [], boards: [toBoardSummary(board, "main")], board };
}

export async function getManifest(root: string): Promise<ProjectManifest> {
  const manifestPath = projectPath(root, "project.yaml");
  if (!(await pathExists(manifestPath))) {
    throw new ProjectStoreError("PROJECT_NOT_FOUND", `目录“${path.resolve(root)}”不是 Prototype Studio 项目。`);
  }
  try {
    const manifest = parse(await readFile(manifestPath, "utf8")) as ProjectManifest;
    if (!manifest.id || !manifest.name || !manifest.dslVersion) throw new Error("missing required fields");
    if (manifest.projectFormatVersion !== 2 || !manifest.defaultBoardId) {
      return migrateProjectToV2(root, manifest);
    }
    return manifest;
  } catch (error) {
    throw new ProjectStoreError("INVALID_PROJECT", "project.yaml 无法读取或缺少必填字段。", error);
  }
}

async function migrateProjectToV2(root: string, legacyManifest: ProjectManifest): Promise<ProjectManifest> {
  await Promise.all(requiredDirectories.map((directory) => mkdir(projectPath(root, directory), { recursive: true })));
  const now = new Date().toISOString();
  const targetId = "main";
  const targetPath = projectPath(root, boardRelativePath(targetId));
  let board: BoardDSL;

  if (await pathExists(targetPath)) {
    const raw = parse(await readFile(targetPath, "utf8")) as Partial<BoardDSL>;
    board = normalizedBoard(raw, { id: targetId, name: "主画布", projectId: legacyManifest.id, now });
  } else if (await pathExists(projectPath(root, "board.yaml"))) {
    const raw = parse(await readFile(projectPath(root, "board.yaml"), "utf8")) as Partial<BoardDSL>;
    board = normalizedBoard(raw, { id: targetId, name: "主画布", projectId: legacyManifest.id, now });
  } else {
    const pages = await listPages(root);
    board = normalizedBoard({ objects: tilePages(pages.map((page) => page.id)), links: [], revision: 1 }, {
      id: targetId,
      name: "主画布",
      projectId: legacyManifest.id,
      now
    });
  }
  await writeBoard(root, board);

  const oldRevisionDirectory = projectPath(root, ".prototype/revisions/board");
  const newRevisionDirectory = projectPath(root, `.prototype/revisions/boards/${targetId}`);
  await mkdir(newRevisionDirectory, { recursive: true });
  if (await pathExists(oldRevisionDirectory)) {
    const revisionFiles = (await readdir(oldRevisionDirectory)).filter((file) => file.endsWith(".json"));
    for (const file of revisionFiles) {
      const revision = JSON.parse(await readFile(path.join(oldRevisionDirectory, file), "utf8")) as BoardRevisionRecord;
      const migrated: BoardRevisionRecord = {
        ...revision,
        boardId: targetId,
        before: normalizedBoard(revision.before, { id: targetId, name: board.name, projectId: legacyManifest.id, now: revision.createdAt || now }),
        after: normalizedBoard(revision.after, { id: targetId, name: board.name, projectId: legacyManifest.id, now: revision.createdAt || now })
      };
      await atomicWrite(path.join(newRevisionDirectory, file), JSON.stringify(migrated, null, 2));
    }
  }

  // The manifest is deliberately written last: until all file operations succeed the project remains legacy and retryable.
  await rm(projectPath(root, "requirements"), { recursive: true, force: true });
  await rm(oldRevisionDirectory, { recursive: true, force: true });
  await rm(projectPath(root, "board.yaml"), { force: true });
  const manifest: ProjectManifest = {
    ...legacyManifest,
    projectFormatVersion: 2,
    defaultBoardId: targetId,
    updatedAt: now
  };
  await atomicWrite(projectPath(root, "project.yaml"), stringify(manifest, { lineWidth: 0 }));
  return manifest;
}

export async function getPage(root: string, pageId: string): Promise<PageDSL> {
  const filePath = projectPath(root, pageRelativePath(pageId));
  if (!(await pathExists(filePath))) throw new ProjectStoreError("PAGE_NOT_FOUND", `页面“${pageId}”不存在。`);
  try {
    const dsl = parse(await readFile(filePath, "utf8")) as PageDSL;
    const validation = validateDSL(dsl);
    if (!validation.valid) {
      throw new ProjectStoreError("INVALID_DSL_FILE", `页面“${pageId}”未通过 DSL 校验。`, validation.errors);
    }
    return dsl;
  } catch (error) {
    if (error instanceof ProjectStoreError) throw error;
    throw new ProjectStoreError("INVALID_DSL_FILE", `页面文件“${pageId}.ui.yaml”无法解析。`, error);
  }
}

export async function listPages(root: string): Promise<ProjectPageSummary[]> {
  const directory = projectPath(root, "pages");
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((file) => file.endsWith(".ui.yaml")).sort();
  const pages: ProjectPageSummary[] = [];
  for (const file of files) {
    const pageId = file.slice(0, -".ui.yaml".length);
    try {
      const dsl = await getPage(root, pageId);
      pages.push({
        id: dsl.page.id,
        title: dsl.page.title,
        type: dsl.page.type,
        status: dsl.page.status,
        revision: dsl.revision,
        file: `pages/${file}`
      });
    } catch {
      // Invalid external files remain visible through watcher errors but do not enter the valid page index.
    }
  }
  return pages;
}

export async function listComponentTemplates(root: string): Promise<Array<{ id: string; name: string; type: string; revision: number; file: string }>> {
  const directory = projectPath(root, "components");
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((file) => file.endsWith(".ui-component.yaml")).sort();
  const templates: Array<{ id: string; name: string; type: string; revision: number; file: string }> = [];
  for (const file of files) {
    const componentId = file.slice(0, -".ui-component.yaml".length);
    try {
      const dsl = await getComponentTemplate(root, componentId);
      templates.push({
        id: dsl.component.id,
        name: dsl.component.name,
        type: dsl.component.type,
        revision: dsl.revision,
        file: `components/${file}`
      });
    } catch {
      // 无效组件文件跳过，保持索引稳定。
    }
  }
  return templates;
}

export async function getComponentTemplate(root: string, componentId: string): Promise<ComponentTemplateDSL> {
  const filePath = projectPath(root, componentTemplateRelativePath(componentId));
  if (!(await pathExists(filePath))) throw new ProjectStoreError("COMPONENT_NOT_FOUND", `组件模板“${componentId}”不存在。`);
  try {
    const dsl = parse(await readFile(filePath, "utf8")) as ComponentTemplateDSL;
    const validation = validateComponentTemplate(dsl);
    if (!validation.valid) {
      throw new ProjectStoreError("INVALID_DSL_FILE", `组件模板“${componentId}”未通过校验。`, validation.errors);
    }
    return dsl;
  } catch (error) {
    if (error instanceof ProjectStoreError) throw error;
    throw new ProjectStoreError("INVALID_DSL_FILE", `组件模板文件“${componentId}.ui-component.yaml”无法解析。`, error);
  }
}

export async function writeComponentTemplate(root: string, dsl: ComponentTemplateDSL, options: { overwrite?: boolean } = {}): Promise<void> {
  const validation = validateComponentTemplate(dsl);
  if (!validation.valid) throw new ProjectStoreError("INVALID_DSL_FILE", "组件模板未通过校验，未写入文件。", validation.errors);
  const filePath = projectPath(root, componentTemplateRelativePath(dsl.component.id));
  if (!options.overwrite && await pathExists(filePath)) {
    throw new ProjectStoreError("COMPONENT_EXISTS", `组件模板“${dsl.component.id}”已经存在。`);
  }
  await atomicWrite(filePath, stringify(dsl, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" }));
}

export async function createComponentTemplate(root: string, dsl: ComponentTemplateDSL): Promise<{ id: string; name: string; type: string; revision: number }> {
  await getManifest(root);
  await writeComponentTemplate(root, dsl);
  return { id: dsl.component.id, name: dsl.component.name, type: dsl.component.type, revision: dsl.revision };
}

export async function deleteComponentTemplate(root: string, componentId: string): Promise<void> {
  const filePath = projectPath(root, componentTemplateRelativePath(componentId));
  if (!(await pathExists(filePath))) throw new ProjectStoreError("COMPONENT_NOT_FOUND", `组件模板“${componentId}”不存在。`);
  const trashDirectory = projectPath(root, ".prototype/trash/components");
  await mkdir(trashDirectory, { recursive: true });
  await rename(filePath, path.join(trashDirectory, `${componentId}.${Date.now()}.ui-component.yaml`));
}

export async function openProject(root: string): Promise<OpenedProject> {
  const manifest = await getManifest(root);
  const boards = await listBoards(root);
  return {
    root: path.resolve(root),
    manifest,
    pages: await listPages(root),
    boards,
    board: await readBoard(root, manifest.defaultBoardId)
  };
}

async function readBoardFile(root: string, boardId: string): Promise<BoardDSL> {
  const filePath = projectPath(root, boardRelativePath(boardId));
  if (!(await pathExists(filePath))) throw new ProjectStoreError("BOARD_NOT_FOUND", `画布“${boardId}”不存在。`);
  let raw: unknown;
  try {
    raw = parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new ProjectStoreError("INVALID_DSL_FILE", `画布“${boardId}”无法解析。`, error);
  }
  const validation = validateBoard(raw);
  if (!validation.valid) {
    throw new ProjectStoreError("INVALID_DSL_FILE", `画布“${boardId}”未通过校验。`, validation.errors);
  }
  return raw as BoardDSL;
}

export async function readBoard(root: string, boardId?: string): Promise<BoardDSL> {
  const manifest = await getManifest(root);
  return readBoardFile(root, boardId ?? manifest.defaultBoardId ?? "main");
}

export async function writeBoard(root: string, board: BoardDSL): Promise<void> {
  const validation = validateBoard(board);
  if (!validation.valid) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "画布未通过校验，未写入文件。", validation.errors);
  }
  await atomicWrite(projectPath(root, boardRelativePath(board.id)), stringify(board, { lineWidth: 0 }));
}

export async function persistBoardRevision(root: string, boardId: string, board: BoardDSL, revision: BoardRevisionRecord): Promise<void> {
  const validation = validateBoard(board);
  if (!validation.valid) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "画布未通过校验，未写入修改。", validation.errors);
  }
  if (board.id !== boardId || revision.boardId !== boardId) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "画布命令结果与目标 board_id 不一致。");
  }
  const revisionFile = projectPath(root, `.prototype/revisions/boards/${assertBoardId(boardId)}/${String(revision.revision).padStart(6, "0")}.json`);
  await atomicWrite(revisionFile, JSON.stringify(revision, null, 2));
  await writeBoard(root, board);
  await appendBoardAudit(root, revision);
}

export type ExecuteBoardCommandsInput = Omit<ApplyBoardCommandsInput, "board">;

export async function executeBoardCommands(root: string, boardId: string, input: ExecuteBoardCommandsInput): Promise<{ board: BoardDSL; revision: BoardRevisionRecord }> {
  const board = await readBoard(root, boardId);
  const result = applyBoardCommands({ ...input, board });
  result.board.updatedAt = result.revision.createdAt;
  await persistBoardRevision(root, boardId, result.board, result.revision);
  return result;
}

export async function getBoardRevision(root: string, boardId: string, revision: number): Promise<BoardRevisionRecord> {
  const filePath = projectPath(root, `.prototype/revisions/boards/${assertBoardId(boardId)}/${String(revision).padStart(6, "0")}.json`);
  if (!(await pathExists(filePath))) {
    throw new ProjectStoreError("REVISION_NOT_FOUND", `找不到画布“${boardId}”的 revision ${revision}。`);
  }
  return JSON.parse(await readFile(filePath, "utf8")) as BoardRevisionRecord;
}

function toBoardSummary(board: BoardDSL, defaultBoardId: string): BoardSummary {
  return {
    id: board.id,
    name: board.name,
    description: board.description,
    revision: board.revision,
    pageCount: new Set(board.objects.filter((object) => object.type === "page").map((object) => object.pageId)).size,
    objectCount: board.objects.length,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    isDefault: board.id === defaultBoardId
  };
}

export async function listBoards(root: string): Promise<BoardSummary[]> {
  const manifest = await getManifest(root);
  const directory = projectPath(root, "boards");
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((file) => file.endsWith(".board.yaml"));
  const boards = await Promise.all(files.map((file) => readBoardFile(root, file.slice(0, -".board.yaml".length))));
  return boards
    .map((board) => toBoardSummary(board, manifest.defaultBoardId ?? "main"))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
}

async function uniqueBoardId(root: string, requested: string): Promise<string> {
  const base = slugifyBoardId(requested);
  let candidate = base;
  let index = 2;
  while (await pathExists(projectPath(root, boardRelativePath(candidate)))) candidate = `${base}-${index++}`;
  return candidate;
}

async function assertUniqueBoardName(root: string, name: string, exceptId?: string): Promise<string> {
  const normalized = name.trim();
  if (!normalized) throw new ProjectStoreError("INVALID_PROJECT", "画布名称不能为空。");
  const duplicate = (await listBoards(root)).find((board) => board.id !== exceptId && board.name.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0);
  if (duplicate) throw new ProjectStoreError("BOARD_EXISTS", `画布名称“${normalized}”已存在。`);
  return normalized;
}

function tilePages(pageIds: string[]): BoardDSL["objects"] {
  return pageIds.map((pageId, index) => ({
    id: `obj-${pageId}`,
    type: "page" as const,
    pageId,
    x: 120 + (index % 2) * 1040,
    y: 80 + Math.floor(index / 2) * 720,
    width: 960,
    height: 640,
    source: "default" as const
  }));
}

export async function createBoard(root: string, input: CreateBoardInput): Promise<BoardDSL> {
  const manifest = await getManifest(root);
  const name = await assertUniqueBoardName(root, input.name);
  const boardId = input.boardId ? assertBoardId(input.boardId) : await uniqueBoardId(root, name);
  if (await pathExists(projectPath(root, boardRelativePath(boardId)))) {
    throw new ProjectStoreError("BOARD_EXISTS", `画布 ID“${boardId}”已存在。`);
  }
  const pageIds = [...new Set(input.pageIds ?? [])];
  const existingPages = new Set((await listPages(root)).map((page) => page.id));
  const missing = pageIds.filter((pageId) => !existingPages.has(pageId));
  if (missing.length) throw new ProjectStoreError("PAGE_NOT_FOUND", `以下页面不存在：${missing.join("、")}。`);
  const now = input.now ?? new Date().toISOString();
  const board: BoardDSL = {
    dslVersion: DSL_VERSION,
    id: boardId,
    projectId: manifest.id,
    name,
    description: input.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    objects: tilePages(pageIds),
    links: []
  };
  await writeBoard(root, board);
  return board;
}

export async function createBoards(root: string, inputs: CreateBoardInput[]): Promise<BoardDSL[]> {
  if (!inputs.length) return [];
  const existing = await listBoards(root);
  const names = new Set(existing.map((board) => board.name.toLocaleLowerCase()));
  const ids = new Set(existing.map((board) => board.id));
  const pages = new Set((await listPages(root)).map((page) => page.id));
  for (const input of inputs) {
    const name = input.name.trim();
    const key = name.toLocaleLowerCase();
    if (!name || names.has(key)) throw new ProjectStoreError("BOARD_EXISTS", `画布名称“${name || "(空)"}”重复。`);
    names.add(key);
    if (input.boardId) {
      const id = assertBoardId(input.boardId);
      if (ids.has(id)) throw new ProjectStoreError("BOARD_EXISTS", `画布 ID“${id}”重复。`);
      ids.add(id);
    }
    const missing = [...new Set(input.pageIds ?? [])].filter((pageId) => !pages.has(pageId));
    if (missing.length) throw new ProjectStoreError("PAGE_NOT_FOUND", `画布“${name}”引用了不存在的页面：${missing.join("、")}。`);
  }
  const created: BoardDSL[] = [];
  try {
    for (const input of inputs) created.push(await createBoard(root, input));
    return created;
  } catch (error) {
    await Promise.all(created.map((board) => rm(projectPath(root, boardRelativePath(board.id)), { force: true })));
    throw error;
  }
}

export async function updateBoard(root: string, boardId: string, input: UpdateBoardInput): Promise<BoardDSL> {
  const manifest = await getManifest(root);
  const board = await readBoard(root, boardId);
  if (input.name !== undefined) board.name = await assertUniqueBoardName(root, input.name, boardId);
  if (input.description !== undefined) board.description = input.description.trim() || undefined;
  board.updatedAt = input.now ?? new Date().toISOString();
  await writeBoard(root, board);
  if (input.isDefault && manifest.defaultBoardId !== boardId) {
    await atomicWrite(projectPath(root, "project.yaml"), stringify({ ...manifest, defaultBoardId: boardId, updatedAt: board.updatedAt }, { lineWidth: 0 }));
  }
  return board;
}

export async function deleteBoard(root: string, boardId: string): Promise<{ deletedBoardId: string; defaultBoardId: string }> {
  const manifest = await getManifest(root);
  const summaries = await listBoards(root);
  if (summaries.length <= 1) throw new ProjectStoreError("LAST_BOARD", "项目必须至少保留一个画布。");
  await readBoard(root, boardId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashRoot = projectPath(root, `.prototype/trash/boards/${assertBoardId(boardId)}-${stamp}`);
  await mkdir(trashRoot, { recursive: true });
  await rename(projectPath(root, boardRelativePath(boardId)), path.join(trashRoot, `${boardId}.board.yaml`));
  const revisionDirectory = projectPath(root, `.prototype/revisions/boards/${boardId}`);
  if (await pathExists(revisionDirectory)) await rename(revisionDirectory, path.join(trashRoot, "revisions"));
  const defaultBoardId = manifest.defaultBoardId === boardId
    ? summaries.find((board) => board.id !== boardId)?.id ?? "main"
    : manifest.defaultBoardId ?? "main";
  if (defaultBoardId !== manifest.defaultBoardId) {
    await atomicWrite(projectPath(root, "project.yaml"), stringify({ ...manifest, defaultBoardId, updatedAt: new Date().toISOString() }, { lineWidth: 0 }));
  }
  return { deletedBoardId: boardId, defaultBoardId };
}

function assertTrashId(trashId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(trashId)) throw new ProjectStoreError("BOARD_NOT_FOUND", "回收站记录不存在。");
  return trashId;
}

export async function listTrashedBoards(root: string): Promise<TrashedBoardSummary[]> {
  await getManifest(root);
  const trashDirectory = projectPath(root, ".prototype/trash/boards");
  const entries = await readdir(trashDirectory, { withFileTypes: true }).catch(() => []);
  const summaries: TrashedBoardSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const trashId = assertTrashId(entry.name);
    const directory = path.join(trashDirectory, trashId);
    const boardFile = (await readdir(directory)).find((file) => file.endsWith(".board.yaml"));
    if (!boardFile) continue;
    const board = parse(await readFile(path.join(directory, boardFile), "utf8")) as BoardDSL;
    if (!validateBoard(board).valid) continue;
    const metadata = await stat(directory);
    summaries.push({ trashId, boardId: board.id, name: board.name, description: board.description, deletedAt: metadata.mtime.toISOString() });
  }
  return summaries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function restoreBoard(root: string, trashId: string): Promise<BoardDSL> {
  const safeTrashId = assertTrashId(trashId);
  const trashDirectory = projectPath(root, `.prototype/trash/boards/${safeTrashId}`);
  const boardFile = (await readdir(trashDirectory).catch(() => [] as string[])).find((file) => file.endsWith(".board.yaml"));
  if (!boardFile) throw new ProjectStoreError("BOARD_NOT_FOUND", "回收站记录不存在。");
  const board = parse(await readFile(path.join(trashDirectory, boardFile), "utf8")) as BoardDSL;
  const validation = validateBoard(board);
  if (!validation.valid) throw new ProjectStoreError("INVALID_DSL_FILE", "回收站中的画布无效。", validation.errors);
  await assertUniqueBoardName(root, board.name);
  const destination = projectPath(root, boardRelativePath(board.id));
  if (await pathExists(destination)) throw new ProjectStoreError("BOARD_EXISTS", `画布 ID“${board.id}”已存在。`);
  await rename(path.join(trashDirectory, boardFile), destination);
  const trashedRevisions = path.join(trashDirectory, "revisions");
  if (await pathExists(trashedRevisions)) {
    const revisionsDestination = projectPath(root, `.prototype/revisions/boards/${board.id}`);
    await mkdir(path.dirname(revisionsDestination), { recursive: true });
    await rename(trashedRevisions, revisionsDestination);
  }
  await rm(trashDirectory, { recursive: true, force: true });
  return board;
}

/** Backward compatibility: returns the default board after upgrading legacy projects. */
export async function ensureBoard(root: string): Promise<BoardDSL> {
  return readBoard(root);
}

export async function writePage(root: string, dsl: PageDSL, options: { overwrite?: boolean } = {}): Promise<void> {
  const validation = validateDSL(dsl);
  if (!validation.valid) throw new ProjectStoreError("INVALID_DSL_FILE", "页面 DSL 未通过校验，未写入文件。", validation.errors);
  const filePath = projectPath(root, pageRelativePath(dsl.page.id));
  if (!options.overwrite && await pathExists(filePath)) {
    throw new ProjectStoreError("PAGE_EXISTS", `页面“${dsl.page.id}”已经存在。`);
  }
  await atomicWrite(filePath, stringify(dsl, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" }));
}

export async function createPage(root: string, dsl: PageDSL): Promise<ProjectPageSummary> {
  await getManifest(root);
  await writePage(root, dsl);
  return {
    id: dsl.page.id,
    title: dsl.page.title,
    type: dsl.page.type,
    status: dsl.page.status,
    revision: dsl.revision,
    file: pageRelativePath(dsl.page.id)
  };
}

export async function deletePage(root: string, pageId: string): Promise<void> {
  const filePath = projectPath(root, pageRelativePath(pageId));
  if (!(await pathExists(filePath))) throw new ProjectStoreError("PAGE_NOT_FOUND", `页面“${pageId}”不存在。`);
  const trashDirectory = projectPath(root, ".prototype/trash");
  await mkdir(trashDirectory, { recursive: true });
  await rename(filePath, path.join(trashDirectory, `${pageId}.${Date.now()}.ui.yaml`));
}

async function persistRevision(root: string, dsl: PageDSL, revision: RevisionRecord): Promise<void> {
  const revisionFile = projectPath(root, `.prototype/revisions/${dsl.page.id}/${String(revision.revision).padStart(6, "0")}.json`);
  await atomicWrite(revisionFile, JSON.stringify(revision, null, 2));
  await writePage(root, dsl, { overwrite: true });
  await appendAudit(root, revision);
}

export async function executeProjectCommands(
  root: string,
  pageId: string,
  input: Omit<ExecuteCommandsInput, "dsl">
): Promise<ReturnType<typeof executeCommands>> {
  const dsl = await getPage(root, pageId);
  const result = executeCommands({ ...input, dsl });
  await persistRevision(root, result.dsl, result.revision);
  return result;
}

export interface PersistPageSnapshotInput {
  baseRevision: number;
  source: RevisionSource;
  operator: string;
}

/** Writes a page snapshot (undo/redo/rename/title edits) through the version chain with an empty command list. */
export async function persistPageSnapshot(
  root: string,
  dsl: PageDSL,
  input: PersistPageSnapshotInput
): Promise<{ dsl: PageDSL; revision: RevisionRecord }> {
  const current = await getPage(root, dsl.page.id);
  if (input.baseRevision !== current.revision) {
    throw new ProjectStoreError(
      "REVISION_NOT_FOUND",
      `页面当前 revision 为 ${current.revision}，但快照基于 ${input.baseRevision}。`,
      { currentRevision: current.revision, baseRevision: input.baseRevision }
    );
  }
  const validation = validateDSL(dsl);
  if (!validation.valid) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "页面快照未通过 DSL 校验。", validation.errors);
  }
  if (dsl.revision !== current.revision + 1) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "页面快照 revision 必须是 baseRevision + 1。");
  }
  const revision: RevisionRecord = {
    id: randomUUID(),
    pageId: dsl.page.id,
    revision: dsl.revision,
    source: input.source,
    operator: input.operator,
    baseRevision: current.revision,
    commands: [],
    before: current,
    after: dsl,
    changedComponentIds: [],
    createdAt: new Date().toISOString()
  };
  await persistRevision(root, dsl, revision);
  return { dsl, revision };
}

export async function getRevision(root: string, pageId: string, revision: number): Promise<RevisionRecord> {
  const filePath = projectPath(root, `.prototype/revisions/${pageId}/${String(revision).padStart(6, "0")}.json`);
  if (!(await pathExists(filePath))) throw new ProjectStoreError("REVISION_NOT_FOUND", `找不到页面“${pageId}”的 revision ${revision}。`);
  return JSON.parse(await readFile(filePath, "utf8")) as RevisionRecord;
}

export async function undoRevision(root: string, pageId: string, revision: number, operator: string): Promise<RevisionRecord> {
  const current = await getPage(root, pageId);
  const target = await getRevision(root, pageId, revision);
  const result = createRevertRevision(current, target, operator);
  await persistRevision(root, result.dsl, result.revision);
  return result.revision;
}

export async function redoRevision(root: string, pageId: string, revision: number, operator: string): Promise<RevisionRecord> {
  const current = await getPage(root, pageId);
  const target = await getRevision(root, pageId, revision);
  const result = createReapplyRevision(current, target, operator);
  await persistRevision(root, result.dsl, result.revision);
  return result.revision;
}

export interface ProductPackage {
  formatVersion: "2.0";
  generatedAt: string;
  project: ProjectManifest;
  pages: PageDSL[];
  boards: BoardDSL[];
  flows: Array<{ file: string; content: string }>;
  designSystem: {
    id: string;
    version: string;
  };
  acceptanceCriteria: string[];
  preview: {
    type: "local";
    route: string;
    note: string;
  };
}

async function readTextDirectory(root: string, relativeDirectory: string): Promise<Array<{ file: string; content: string }>> {
  const directory = projectPath(root, relativeDirectory);
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(files.map(async (file) => ({
    file: `${relativeDirectory}/${file}`,
    content: await readFile(projectPath(root, `${relativeDirectory}/${file}`), "utf8")
  })));
}

export async function buildProductPackage(
  root: string,
  options: { acceptanceCriteria?: string[]; now?: string } = {}
): Promise<ProductPackage> {
  const project = await getManifest(root);
  const summaries = await listPages(root);
  const pages = await Promise.all(summaries.map((page) => getPage(root, page.id)));
  const boardSummaries = await listBoards(root);
  const boards = await Promise.all(boardSummaries.map((board) => readBoard(root, board.id)));
  return {
    formatVersion: "2.0",
    generatedAt: options.now ?? new Date().toISOString(),
    project,
    pages,
    boards,
    flows: await readTextDirectory(root, "flows"),
    designSystem: { id: "prototype-studio-default", version: project.designSystemVersion },
    acceptanceCriteria: options.acceptanceCriteria ?? [
      "同一 DSL、Renderer 与 Design System 版本产生一致页面。",
      "所有可交互组件具备稳定且唯一的 componentId。",
      "页面 DSL 通过 Schema、引用、ID、组件与事件校验。"
    ],
    preview: {
      type: "local",
      route: pages[0] ? `/preview-runtime/${pages[0].page.id}` : "/preview-runtime",
      note: "Local-first MVP 不提供虚假的公网分享地址；请在 Prototype Studio 中打开本项目。"
    }
  };
}

export async function exportProductPackage(
  root: string,
  options: { acceptanceCriteria?: string[]; now?: string } = {}
): Promise<string> {
  const productPackage = await buildProductPackage(root, options);
  const safeTimestamp = productPackage.generatedAt.replace(/[:.]/g, "-");
  const exportDirectory = projectPath(root, `.prototype/exports/product-package-${safeTimestamp}`);
  await mkdir(exportDirectory, { recursive: true });
  await atomicWrite(path.join(exportDirectory, "product-package.json"), JSON.stringify(productPackage, null, 2));
  await Promise.all(productPackage.boards.map((board) => atomicWrite(
    path.join(exportDirectory, "boards", `${board.id}.board.yaml`),
    stringify(board, { lineWidth: 0 })
  )));
  const summary = [
    `# ${productPackage.project.name} · Product Package`,
    "",
    `生成时间：${productPackage.generatedAt}`,
    "",
    `- 页面：${productPackage.pages.length}`,
    `- 画布：${productPackage.boards.length}`,
    `- 画布对象：${productPackage.boards.reduce((total, board) => total + board.objects.length, 0)}`,
    `- Flow：${productPackage.flows.length}`,
    `- DSL：${productPackage.project.dslVersion}`,
    `- Renderer：${productPackage.project.rendererVersion}`,
    `- Design System：${productPackage.project.designSystemVersion}`,
    "",
    "该包是结构化产品规格，不是生产代码。完整机器可读内容见 `product-package.json`。",
    ""
  ].join("\n");
  await atomicWrite(path.join(exportDirectory, "README.md"), summary);
  return exportDirectory;
}

export async function importExternalPage(root: string, relativePath: string): Promise<{ dsl?: PageDSL; validation: DSLValidationResult }> {
  const filePath = projectPath(root, relativePath);
  try {
    const raw = parse(await readFile(filePath, "utf8"));
    const validation = validateDSL(raw);
    return { dsl: validation.valid ? raw as PageDSL : undefined, validation };
  } catch (error) {
    return {
      validation: {
        valid: false,
        errors: [{ code: "SCHEMA_INVALID", path: "$", message: `YAML 解析失败：${error instanceof Error ? error.message : "未知错误"}` }],
        warnings: []
      }
    };
  }
}

export function watchProject(root: string, onEvent: (event: ExternalFileEvent) => void): FSWatcher {
  const patterns = ["project.yaml", "pages", "boards", "data", "flows"].map((entry) => projectPath(root, entry));
  const watcher = chokidar.watch(patterns, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 40 } });
  const handle = async (kind: ExternalFileEvent["kind"], filePath: string) => {
    const relativePath = path.relative(path.resolve(root), filePath);
    if (relativePath.startsWith("pages/") && relativePath.endsWith(".ui.yaml") && kind !== "unlink") {
      const result = await importExternalPage(root, relativePath);
      onEvent({ kind, relativePath, validation: result.validation, pageId: result.dsl?.page.id });
    } else {
      onEvent({ kind, relativePath });
    }
  };
  watcher.on("add", (filePath) => void handle("add", filePath));
  watcher.on("change", (filePath) => void handle("change", filePath));
  watcher.on("unlink", (filePath) => void handle("unlink", filePath));
  return watcher;
}

export async function initializeGit(root: string): Promise<void> {
  const gitDirectory = projectPath(root, ".git");
  if (await pathExists(gitDirectory)) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["init"], { cwd: path.resolve(root), stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`git init 退出码 ${code}`)));
  });
}

export async function ensureProjectWritable(root: string): Promise<void> {
  const handle = await open(projectPath(root, "project.yaml"), "r+");
  await handle.close();
}

export async function removeRebuildableCache(root: string): Promise<void> {
  const cache = projectPath(root, ".prototype/cache");
  await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });
}

export interface ProjectVersion {
  id: string;
  label: string;
  createdAt: string;
  pages: Record<string, PageDSL>;
  boards: Record<string, BoardDSL>;
}

function versionsFilePath(root: string): string {
  return projectPath(root, ".prototype/versions.json");
}

export async function listProjectVersions(root: string): Promise<ProjectVersion[]> {
  try {
    const parsed = JSON.parse(await readFile(versionsFilePath(root), "utf8")) as { versions?: ProjectVersion[] };
    return Array.isArray(parsed.versions) ? parsed.versions : [];
  } catch {
    return [];
  }
}

/** 保存当前项目状态（所有页面与画布）为一个命名版本。 */
export async function saveProjectVersion(root: string, label: string): Promise<ProjectVersion> {
  const manifest = await getManifest(root);
  const pages: Record<string, PageDSL> = {};
  for (const summary of await listPages(root)) pages[summary.id] = await getPage(root, summary.id);
  const boardIds = new Set<string>([
    ...(manifest.defaultBoardId ? [manifest.defaultBoardId] : []),
    ...(await listBoards(root)).map((board) => board.id)
  ]);
  const boards: Record<string, BoardDSL> = {};
  for (const boardId of boardIds) boards[boardId] = await readBoard(root, boardId);
  const version: ProjectVersion = {
    id: randomUUID(),
    label,
    createdAt: new Date().toISOString(),
    pages,
    boards
  };
  const versions = await listProjectVersions(root);
  versions.push(version);
  await atomicWrite(versionsFilePath(root), JSON.stringify({ versions }, null, 2));
  return version;
}

/** 把项目恢复到某个命名版本（页面与画布文件均还原为该版本快照）。 */
export async function restoreProjectVersion(root: string, versionId: string): Promise<ProjectVersion> {
  const versions = await listProjectVersions(root);
  const version = versions.find((item) => item.id === versionId);
  if (!version) throw new ProjectStoreError("PROJECT_NOT_FOUND", `找不到版本“${versionId}”。`);
  for (const pageId of Object.keys(version.pages)) {
    const dsl = version.pages[pageId];
    if (dsl) await writePage(root, dsl, { overwrite: true });
  }
  for (const boardId of Object.keys(version.boards)) {
    const board = version.boards[boardId];
    if (board) await writeBoard(root, board);
  }
  return version;
}

export type ProjectCommandInput = {
  baseRevision: number;
  commands: Command[];
  source: RevisionSource;
  operator: string;
};
