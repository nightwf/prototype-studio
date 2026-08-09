import type { BoardRevisionRecord, RevisionRecord } from "@prototype-studio/dsl-schema";

export interface DesktopProjectSnapshot {
  root: string;
  manifest: {
    id: string;
    name: string;
    description?: string;
    status: string;
    dslVersion: string;
    rendererVersion: string;
    designSystemVersion: string;
    createdAt: string;
    updatedAt: string;
  };
  pageIds: string[];
}

export interface DesktopPageDocument {
  pageId: string;
  relativePath: string;
  content: string;
}

export interface ProjectFileChangedEvent {
  kind: "add" | "change" | "unlink";
  relativePath: string;
}

export interface DesktopMcpStatus {
  state: "running" | "stopped" | "unavailable";
  projectRoot?: string;
  pid?: number;
  detail?: string;
}

export interface DesktopMcpConnectionInfo {
  state: "running" | "stopped" | "unavailable";
  projectRoot?: string;
  sidecarPath?: string;
  sidecarAvailable: boolean;
  configToml?: string;
  connectPrompt?: string;
  detail?: string;
}

export interface DesktopPersistedRevision {
  page: DesktopPageDocument;
  revision: number;
  revisionPath: string;
  auditPath: string;
}

export function isDesktopRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import("@tauri-apps/api/core");
  return api.invoke<T>(command, args);
}

export async function selectProjectFolder(): Promise<DesktopProjectSnapshot | null> {
  return invoke("select_project_folder");
}

export async function createDesktopProject(name: string, description?: string): Promise<DesktopProjectSnapshot | null> {
  return invoke("create_project", { input: { name, description, directoryName: undefined } });
}

export async function readDesktopPage(pageId: string): Promise<DesktopPageDocument> {
  return invoke("read_page_yaml", { pageId });
}

export async function writeDesktopPage(pageId: string, content: string): Promise<DesktopPageDocument> {
  return invoke("write_page_yaml", { pageId, content });
}

export async function readDesktopBoard(): Promise<string> {
  return invoke("read_board_yaml");
}

export async function writeDesktopBoard(content: string): Promise<void> {
  return invoke("write_board_yaml", { content });
}

/** Atomically writes board.yaml, the immutable board Revision file and the audit entry. */
export async function persistDesktopBoardRevision(content: string, revisionRecord: BoardRevisionRecord): Promise<void> {
  return invoke("persist_board_revision", { content, revisionRecord });
}

/** Writes a standalone HTML snapshot of the canvas into the project exports folder. */
export async function exportDesktopBoardHtml(content: string): Promise<string> {
  return invoke("export_board_html", { content });
}

/** Atomically writes the page, immutable Revision file, and audit entry. */
export async function persistDesktopPageRevision(
  pageId: string,
  content: string,
  revisionRecord: RevisionRecord
): Promise<DesktopPersistedRevision> {
  return invoke("persist_page_revision", { pageId, content, revisionRecord });
}

/** Creates a page without overwriting an existing page with the same id. */
export async function createDesktopPage(pageId: string, content: string): Promise<DesktopPageDocument> {
  return invoke("create_page_yaml", { pageId, content });
}

/** Renames the page title while preserving its stable page id and revision history. */
export async function renameDesktopPage(pageId: string, title: string): Promise<DesktopPageDocument> {
  return invoke("rename_page", { pageId, title });
}

/** Persists the user-defined order used by the Studio page tree. */
export async function reorderDesktopPages(pageIds: string[]): Promise<DesktopProjectSnapshot> {
  return invoke("reorder_pages", { pageIds });
}

/** Moves the page file to `.prototype/trash`; it must never permanently unlink it. */
export async function trashDesktopPage(pageId: string): Promise<DesktopProjectSnapshot> {
  return invoke("trash_page", { pageId });
}

export async function startProjectWatcher(): Promise<boolean> {
  return invoke("start_project_watcher");
}

export async function stopProjectWatcher(): Promise<boolean> {
  return invoke("stop_project_watcher");
}

export async function startLocalMcp(): Promise<DesktopMcpStatus> {
  return invoke("start_local_mcp");
}

export async function localMcpStatus(): Promise<DesktopMcpStatus> {
  return invoke("local_mcp_status");
}

export async function getLocalMcpConnectionInfo(): Promise<DesktopMcpConnectionInfo> {
  return invoke("local_mcp_connection_info");
}

export async function listenForProjectFiles(handler: (event: ProjectFileChangedEvent) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ProjectFileChangedEvent>("project-file-changed", (event) => handler(event.payload));
}
