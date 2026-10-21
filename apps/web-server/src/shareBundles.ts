import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BoardDSL, PageDSL } from "@prototype-studio/dsl-schema";
import { validateDSL } from "@prototype-studio/dsl-validator";

/**
 * 分享包：发布时把画布与相关页面打包成一份只读快照。
 * 编辑与查看仍以本地/项目数据为准，分享包只在「发布」这一刻生成或覆盖。
 */
export interface ShareBundleManifest {
  formatVersion: 1;
  id: string;
  projectId: string;
  projectName: string;
  description?: string;
  boardIds: string[];
  defaultBoardId: string;
  pageIds: string[];
  /** 由画布、页面的 revision 组合而成，用于判断发布后项目是否又有改动。 */
  sourceDigest: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareBundleInput {
  projectId: string;
  projectName?: string;
  description?: string;
  boards: BoardDSL[];
  pages: PageDSL[];
  sourceDigest?: string;
}

export interface ShareBundle {
  manifest: ShareBundleManifest;
  boards: BoardDSL[];
  pages: PageDSL[];
}

export class ShareBundleError extends Error {
  constructor(
    readonly code: "INVALID_BUNDLE" | "BUNDLE_NOT_FOUND",
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ShareBundleError";
  }
}

export function bundleRoot(spacesBaseDir: string): string {
  return resolve(spacesBaseDir, "_share-bundles");
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned || "item";
}

/** 内容指纹只看 revision：任何一个页面或画布改过，指纹就会变。 */
export function computeSourceDigest(boards: BoardDSL[], pages: PageDSL[]): string {
  const boardPart = [...boards]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((board) => `${board.id}@${board.revision}`)
    .join("|");
  const pagePart = [...pages]
    .sort((a, b) => String(a.page?.id ?? "").localeCompare(String(b.page?.id ?? "")))
    .map((page) => `${page.page?.id ?? "?"}@${page.revision}`)
    .join("|");
  return `${boardPart}#${pagePart}`;
}

export function validateShareBundle(input: ShareBundleInput): string[] {
  const errors: string[] = [];
  const boards = Array.isArray(input.boards) ? input.boards : [];
  const pages = Array.isArray(input.pages) ? input.pages : [];
  if (!boards.length) errors.push("分享包至少需要一个画布。");
  const boardIds = new Set<string>();
  for (const board of boards) {
    if (!board?.id) { errors.push("画布缺少 id。"); continue; }
    if (boardIds.has(board.id)) errors.push(`画布 id 重复：${board.id}`);
    boardIds.add(board.id);
    if (!Array.isArray(board.objects)) errors.push(`画布 ${board.id} 的 objects 必须是数组。`);
  }
  const pageIds = new Set<string>();
  for (const page of pages) {
    const pageId = page?.page?.id;
    if (!pageId) { errors.push("页面缺少 page.id。"); continue; }
    if (pageIds.has(pageId)) errors.push(`页面 id 重复：${pageId}`);
    pageIds.add(pageId);
    const result = validateDSL(page);
    if (!result.valid) {
      for (const issue of result.errors.slice(0, 3)) errors.push(`页面 ${pageId}：${issue.path} ${issue.message}`);
    }
  }
  for (const board of boards) {
    for (const object of board?.objects ?? []) {
      if (object?.type === "page" && !pageIds.has(object.pageId)) {
        errors.push(`画布 ${board.id} 引用了未包含的页面：${object.pageId}`);
      }
    }
  }
  return errors;
}

export async function writeShareBundle(root: string, bundleId: string, input: ShareBundleInput): Promise<ShareBundleManifest> {
  const errors = validateShareBundle(input);
  if (errors.length) throw new ShareBundleError("INVALID_BUNDLE", "分享包未通过校验。", errors);

  const target = join(root, safeSegment(bundleId));
  const staging = `${target}.staging-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const previous = await readShareBundle(root, bundleId).catch(() => undefined);
  const manifest: ShareBundleManifest = {
    formatVersion: 1,
    id: safeSegment(bundleId),
    projectId: input.projectId,
    projectName: input.projectName?.trim() || previous?.manifest.projectName || "未命名项目",
    ...(input.description ? { description: input.description } : previous?.manifest.description ? { description: previous.manifest.description } : {}),
    boardIds: input.boards.map((board) => board.id),
    defaultBoardId: input.boards[0]!.id,
    pageIds: input.pages.map((page) => page.page.id),
    sourceDigest: input.sourceDigest?.trim() || computeSourceDigest(input.boards, input.pages),
    createdAt: previous?.manifest.createdAt ?? now,
    updatedAt: now
  };

  await mkdir(join(staging, "pages"), { recursive: true });
  await mkdir(join(staging, "boards"), { recursive: true });
  for (const page of input.pages) {
    await writeFile(join(staging, "pages", `${safeSegment(page.page.id)}.json`), JSON.stringify(page, null, 2), "utf8");
  }
  for (const board of input.boards) {
    await writeFile(join(staging, "boards", `${safeSegment(board.id)}.json`), JSON.stringify(board, null, 2), "utf8");
  }
  // manifest 最后写：目录不完整时不会被当成有效分享包。
  await writeFile(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  return manifest;
}

export async function readShareBundle(root: string, bundleId: string): Promise<ShareBundle> {
  const target = join(root, safeSegment(bundleId));
  let manifest: ShareBundleManifest;
  try {
    manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8")) as ShareBundleManifest;
  } catch {
    throw new ShareBundleError("BUNDLE_NOT_FOUND", "分享包不存在或已损坏。");
  }
  const readAll = async <T>(dir: "pages" | "boards"): Promise<T[]> => {
    let names: string[] = [];
    try { names = await readdir(join(target, dir)); } catch { return []; }
    const items: T[] = [];
    for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
      items.push(JSON.parse(await readFile(join(target, dir, name), "utf8")) as T);
    }
    return items;
  };
  return { manifest, boards: await readAll<BoardDSL>("boards"), pages: await readAll<PageDSL>("pages") };
}

export async function deleteShareBundle(root: string, bundleId: string): Promise<void> {
  await rm(join(root, safeSegment(bundleId)), { recursive: true, force: true });
}
