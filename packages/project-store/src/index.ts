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
  type PageDSL,
  type ProjectManifest,
  type RevisionRecord,
  type RevisionSource
} from "@prototype-studio/dsl-schema";
import { validateBoard, validateDSL, type DSLValidationResult } from "@prototype-studio/dsl-validator";

export class ProjectStoreError extends Error {
  constructor(
    public readonly code:
      | "PROJECT_NOT_FOUND"
      | "INVALID_PROJECT"
      | "PAGE_NOT_FOUND"
      | "PAGE_EXISTS"
      | "PATH_OUTSIDE_PROJECT"
      | "INVALID_DSL_FILE"
      | "REVISION_NOT_FOUND",
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
  board: BoardDSL;
}

export interface ExternalFileEvent {
  kind: "add" | "change" | "unlink";
  relativePath: string;
  validation?: DSLValidationResult;
  pageId?: string;
}

const requiredDirectories = ["requirements", "pages", "data", "flows", "assets", ".prototype", ".prototype/revisions", ".prototype/cache"];

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
    dslVersion: DSL_VERSION,
    rendererVersion: RENDERER_VERSION,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    createdAt: now,
    updatedAt: now
  };
  await atomicWrite(manifestPath, stringify(manifest, { lineWidth: 0 }));
  const board: BoardDSL = {
    dslVersion: DSL_VERSION,
    id: `${manifest.id}-board`,
    revision: 1,
    objects: [],
    links: []
  };
  await writeBoard(absoluteRoot, board);
  await atomicWrite(projectPath(absoluteRoot, ".gitignore"), ".prototype/cache/\n*.tmp\n");
  await atomicWrite(projectPath(absoluteRoot, ".prototype/index.json"), JSON.stringify({ version: 1, generatedAt: now, pages: [] }, null, 2));
  return { root: absoluteRoot, manifest, pages: [], board };
}

export async function getManifest(root: string): Promise<ProjectManifest> {
  const manifestPath = projectPath(root, "project.yaml");
  if (!(await pathExists(manifestPath))) {
    throw new ProjectStoreError("PROJECT_NOT_FOUND", `目录“${path.resolve(root)}”不是 Prototype Studio 项目。`);
  }
  try {
    const manifest = parse(await readFile(manifestPath, "utf8")) as ProjectManifest;
    if (!manifest.id || !manifest.name || !manifest.dslVersion) throw new Error("missing required fields");
    return manifest;
  } catch (error) {
    throw new ProjectStoreError("INVALID_PROJECT", "project.yaml 无法读取或缺少必填字段。", error);
  }
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

export async function openProject(root: string): Promise<OpenedProject> {
  const manifest = await getManifest(root);
  return { root: path.resolve(root), manifest, pages: await listPages(root), board: await ensureBoard(root) };
}

export async function readBoard(root: string): Promise<BoardDSL> {
  const filePath = projectPath(root, "board.yaml");
  if (!(await pathExists(filePath))) throw new ProjectStoreError("PROJECT_NOT_FOUND", "项目缺少 board.yaml。");
  let raw: unknown;
  try {
    raw = parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "board.yaml 无法解析。", error);
  }
  const validation = validateBoard(raw);
  if (!validation.valid) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "board.yaml 未通过画布校验。", validation.errors);
  }
  return raw as BoardDSL;
}

export async function writeBoard(root: string, board: BoardDSL): Promise<void> {
  const validation = validateBoard(board);
  if (!validation.valid) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "画布未通过校验，未写入文件。", validation.errors);
  }
  await atomicWrite(projectPath(root, "board.yaml"), stringify(board, { lineWidth: 0 }));
}

export async function persistBoardRevision(root: string, board: BoardDSL, revision: BoardRevisionRecord): Promise<void> {
  const validation = validateBoard(board);
  if (!validation.valid) {
    throw new ProjectStoreError("INVALID_DSL_FILE", "画布未通过校验，未写入修改。", validation.errors);
  }
  const revisionFile = projectPath(root, `.prototype/revisions/board/${String(revision.revision).padStart(6, "0")}.json`);
  await atomicWrite(revisionFile, JSON.stringify(revision, null, 2));
  await writeBoard(root, board);
  await appendBoardAudit(root, revision);
}

export type ExecuteBoardCommandsInput = Omit<ApplyBoardCommandsInput, "board">;

export async function executeBoardCommands(root: string, input: ExecuteBoardCommandsInput): Promise<{ board: BoardDSL; revision: BoardRevisionRecord }> {
  const board = await readBoard(root);
  const result = applyBoardCommands({ ...input, board });
  await persistBoardRevision(root, result.board, result.revision);
  return result;
}

export async function getBoardRevision(root: string, revision: number): Promise<BoardRevisionRecord> {
  const filePath = projectPath(root, `.prototype/revisions/board/${String(revision).padStart(6, "0")}.json`);
  if (!(await pathExists(filePath))) {
    throw new ProjectStoreError("REVISION_NOT_FOUND", `找不到画布 revision ${revision}。`);
  }
  return JSON.parse(await readFile(filePath, "utf8")) as BoardRevisionRecord;
}

/** Backward compatibility: generates a default canvas that tiles existing pages. */
export async function ensureBoard(root: string): Promise<BoardDSL> {
  if (await pathExists(projectPath(root, "board.yaml"))) return readBoard(root);
  const project = await getManifest(root);
  const pages = await listPages(root);
  const board: BoardDSL = {
    dslVersion: DSL_VERSION,
    id: `${project.id}-board`,
    revision: 1,
    objects: pages.map((page, index) => ({
      id: `obj-${page.id}`,
      type: "page",
      pageId: page.id,
      x: 120,
      y: 80 + index * 720,
      width: 960,
      height: 640,
      source: "default"
    })),
    links: []
  };
  await writeBoard(root, board);
  return board;
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
  formatVersion: "1.0";
  generatedAt: string;
  project: ProjectManifest;
  requirements: Array<{ file: string; content: string }>;
  pages: PageDSL[];
  board: BoardDSL;
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
  const board = await ensureBoard(root);
  return {
    formatVersion: "1.0",
    generatedAt: options.now ?? new Date().toISOString(),
    project,
    requirements: await readTextDirectory(root, "requirements"),
    pages,
    board,
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
  await atomicWrite(path.join(exportDirectory, "board.yaml"), stringify(productPackage.board, { lineWidth: 0 }));
  const summary = [
    `# ${productPackage.project.name} · Product Package`,
    "",
    `生成时间：${productPackage.generatedAt}`,
    "",
    `- 需求文件：${productPackage.requirements.length}`,
    `- 页面：${productPackage.pages.length}`,
    `- 画布对象：${productPackage.board.objects.length}`,
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
  const patterns = ["project.yaml", "requirements", "pages", "data", "flows"].map((entry) => projectPath(root, entry));
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

export type ProjectCommandInput = {
  baseRevision: number;
  commands: Command[];
  source: RevisionSource;
  operator: string;
};
