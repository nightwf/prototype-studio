import type { PageDSL } from "@prototype-studio/dsl-schema";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * 本地页面目录：AI（本地 MCP）把页面写成 <目录>/pages/*.ui.yaml，
 * 浏览器通过目录授权读取同一批文件；编辑结果也写回这里。
 */
export interface LocalDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LocalDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterableIterator<LocalDirectoryHandle | LocalFileHandle>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

export interface LocalFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<LocalDirectoryHandle>;
}

const DB_NAME = "prototype-studio-local";
const STORE_NAME = "handles";
const HANDLE_KEY = "page-root";

export function supportsLocalDirectory(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export type LocalDirectorySupport = "ok" | "insecure" | "unsupported";

/** 区分「浏览器不支持」和「当前地址不是安全上下文」——两者提示与解法完全不同。 */
export function localDirectorySupport(): LocalDirectorySupport {
  if (typeof window === "undefined") return "unsupported";
  if (supportsLocalDirectory()) return "ok";
  if (!window.isSecureContext) return "insecure";
  return "unsupported";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地存储"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("本地存储操作失败"));
    });
  } finally {
    db.close();
  }
}

export async function saveDirectoryHandle(handle: LocalDirectoryHandle): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
}

export async function loadDirectoryHandle(): Promise<LocalDirectoryHandle | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    return (await withStore<LocalDirectoryHandle | undefined>("readonly", (store) => store.get(HANDLE_KEY))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(HANDLE_KEY));
}

export async function pickLocalDirectory(): Promise<LocalDirectoryHandle> {
  const picker = (window as unknown as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("当前浏览器不支持目录授权，请使用 Chrome 或 Edge。");
  const handle = await picker({ mode: "readwrite", id: "prototype-studio-pages" });
  // 隐私模式或浏览器不允许持久化句柄时，本次会话仍然可以读写。
  try { await saveDirectoryHandle(handle); } catch { /* 忽略句柄持久化失败 */ }
  return handle;
}

/** 浏览器重启后权限会回落为 prompt，需要用户点一下授权。 */
export async function ensureDirectoryPermission(handle: LocalDirectoryHandle, request = false): Promise<boolean> {
  const descriptor = { mode: "readwrite" as const };
  if (handle.queryPermission) {
    const state = await handle.queryPermission(descriptor);
    if (state === "granted") return true;
    if (state === "denied") return false;
  }
  if (!request || !handle.requestPermission) return false;
  return (await handle.requestPermission(descriptor)) === "granted";
}

function pageFileName(pageId: string): string {
  return `${pageId.replace(/[^a-zA-Z0-9._-]+/g, "_")}.ui.yaml`;
}

function revisionFileName(revision: number): string {
  return `${String(Math.max(0, Math.round(revision))).padStart(6, "0")}.json`;
}

async function revisionDirectory(root: LocalDirectoryHandle, pageId: string, create = true): Promise<LocalDirectoryHandle> {
  const dotPrototype = await root.getDirectoryHandle(".prototype", { create });
  const revisions = await dotPrototype.getDirectoryHandle("revisions", { create });
  return revisions.getDirectoryHandle(pageId.replace(/[^a-zA-Z0-9._-]+/g, "_"), { create });
}

export interface LocalPageScan {
  pages: PageDSL[];
  fileById: Record<string, string>;
  skipped: string[];
}

/** 读取 <目录>/pages/*.ui.yaml；无法解析或缺少 id 的文件只记录跳过原因，不阻断其余页面。 */
export async function readLocalPages(root: LocalDirectoryHandle): Promise<LocalPageScan> {
  const pagesDir = await root.getDirectoryHandle("pages", { create: false });
  const pages: PageDSL[] = [];
  const fileById: Record<string, string> = {};
  const skipped: string[] = [];
  const seen = new Set<string>();
  for await (const entry of pagesDir.values()) {
    if (entry.kind !== "file" || !entry.name.endsWith(".ui.yaml")) continue;
    try {
      const text = await (await (entry as LocalFileHandle).getFile()).text();
      const parsed = parseYaml(text) as PageDSL;
      const id = parsed?.page?.id;
      if (!id) { skipped.push(`${entry.name}：缺少 page.id`); continue; }
      if (seen.has(id)) { skipped.push(`${entry.name}：页面 id 与其它文件重复（${id}）`); continue; }
      seen.add(id);
      pages.push(parsed);
      fileById[id] = entry.name;
    } catch (error) {
      skipped.push(`${entry.name}：${error instanceof Error ? error.message : "无法解析"}`);
    }
  }
  pages.sort((a, b) => a.page.title.localeCompare(b.page.title, "zh-CN"));
  return { pages, fileById, skipped };
}

export async function writeLocalPage(root: LocalDirectoryHandle, dsl: PageDSL): Promise<void> {
  const pagesDir = await root.getDirectoryHandle("pages", { create: true });
  const file = await pagesDir.getFileHandle(pageFileName(dsl.page.id), { create: true });
  const writable = await file.createWritable();
  await writable.write(stringifyYaml(dsl, { lineWidth: 0 }));
  await writable.close();
  // 同时留存一份版本快照，支持跨会话回溯（与云端 .prototype/revisions 结构一致）。
  try {
    const dir = await revisionDirectory(root, dsl.page.id);
    const snapshot = await dir.getFileHandle(revisionFileName(dsl.revision), { create: true });
    const revisionWritable = await snapshot.createWritable();
    await revisionWritable.write(JSON.stringify(dsl, null, 2));
    await revisionWritable.close();
  } catch { /* 版本快照失败不影响页面写入 */ }
}

/** 列出本地页面的历史 revision 编号（升序）。 */
export async function listLocalRevisions(root: LocalDirectoryHandle, pageId: string): Promise<number[]> {
  try {
    const dir = await revisionDirectory(root, pageId, false);
    const numbers: number[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
      const value = Number(entry.name.replace(/\.json$/, ""));
      if (Number.isFinite(value)) numbers.push(value);
    }
    return numbers.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** 读取指定 revision 的本地快照。 */
export async function readLocalRevision(root: LocalDirectoryHandle, pageId: string, revision: number): Promise<PageDSL | undefined> {
  try {
    const dir = await revisionDirectory(root, pageId, false);
    const file = await dir.getFileHandle(revisionFileName(revision), { create: false });
    return JSON.parse(await (await file.getFile()).text()) as PageDSL;
  } catch {
    return undefined;
  }
}

export async function deleteLocalPage(root: LocalDirectoryHandle, pageId: string): Promise<void> {
  const pagesDir = await root.getDirectoryHandle("pages", { create: false });
  const fileName = pageFileName(pageId);
  // 先备份到项目内回收站：备份失败就不删除，避免误删无法恢复。
  const file = await pagesDir.getFileHandle(fileName);
  const text = await (await file.getFile()).text();
  const dotPrototype = await root.getDirectoryHandle(".prototype", { create: true });
  const trash = await dotPrototype.getDirectoryHandle("trash", { create: true });
  const trashPages = await trash.getDirectoryHandle("pages", { create: true });
  const backup = await trashPages.getFileHandle(`${Date.now().toString(36)}-${fileName}`, { create: true });
  const writable = await backup.createWritable();
  await writable.write(text);
  await writable.close();
  await pagesDir.removeEntry(fileName);
}
