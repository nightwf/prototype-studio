import type { BoardCommand, BoardDSL, Command, ComponentTemplateDSL, PageDSL, RevisionSource } from "@prototype-studio/dsl-schema";
import { isDesktopRuntime } from "./desktopBridge";

const apiBase = (import.meta.env.VITE_WEB_API as string | undefined)?.replace(/\/+$/, "") ?? "";

// 网页端部署（浏览器打开）始终走云端登录/项目流程；
// 只有桌面 App（Tauri）里才是本地项目模式。
export const webMode = Boolean(apiBase) || !isDesktopRuntime();

let apiToken = (typeof localStorage !== "undefined" ? localStorage.getItem("ps_api_token") : null) ?? "";

export function getApiToken(): string {
  return apiToken;
}

export function setApiToken(token: string): void {
  apiToken = token;
  localStorage.setItem("ps_api_token", token);
}

export function clearApiToken(): void {
  apiToken = "";
  localStorage.removeItem("ps_api_token");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (apiToken) headers.set("authorization", `Bearer ${apiToken}`);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = (body as { message?: string }).message ?? `请求失败 ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

export interface WebUser {
  id: string;
  name: string;
  email: string;
}

export interface WebProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
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

export const webAuth = {
  register(inviteCode: string, name: string, email: string, password: string) {
    return request<{ ok: boolean; user: WebUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ inviteCode, name, email, password })
    });
  },
  async login(email: string, password: string): Promise<WebUser> {
    const result = await request<{ ok: boolean; user: WebUser; apiToken: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setApiToken(result.apiToken);
    return result.user;
  },
  me() {
    return request<{ ok: boolean; user: WebUser | null }>("/api/me");
  },
  async logout(): Promise<void> {
    await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    clearApiToken();
  }
};

export const webProjects = {
  list() {
    return request<{ ok: boolean; projects: WebProject[] }>("/api/projects");
  },
  create(name: string, description?: string) {
    return request<{ ok: boolean; project: WebProject }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, description })
    });
  },
  import(name: string, zipBase64: string) {
    return request<{ ok: boolean; project: WebProject }>("/api/projects/import", {
      method: "POST",
      body: JSON.stringify({ name, zip: zipBase64 })
    });
  }
};

export const webSpace = {
  tree(projectId: string) {
    return request<{ ok: true; manifest: { name: string; defaultBoardId?: string }; pages: Array<{ id: string; title: string }>; boards: BoardSummary[]; board: BoardDSL; components: Array<{ id: string; name: string; type: string; revision: number; file: string }> }>(`/api/projects/${projectId}/tree`);
  },
  getPage(projectId: string, pageId: string) {
    return request<{ ok: true; dsl: PageDSL }>(`/api/projects/${projectId}/pages/${encodeURIComponent(pageId)}`);
  },
  createPage(projectId: string, dsl: PageDSL) {
    return request<{ ok: true; page: { id: string; title: string } }>(`/api/projects/${projectId}/pages`, {
      method: "POST",
      body: JSON.stringify(dsl)
    });
  },
  putPage(projectId: string, pageId: string, content: PageDSL, baseRevision: number, source: RevisionSource, operator: string) {
    return request<{ ok: true; revision: number }>(`/api/projects/${projectId}/pages/${encodeURIComponent(pageId)}`, {
      method: "PUT",
      body: JSON.stringify({ content, base_revision: baseRevision, source, operator })
    });
  },
  deletePage(projectId: string, pageId: string) {
    return request<{ ok: true }>(`/api/projects/${projectId}/pages/${encodeURIComponent(pageId)}`, { method: "DELETE" });
  },
  listComponents(projectId: string) {
    return request<{ ok: true; components: Array<{ id: string; name: string; type: string; revision: number; file: string }> }>(`/api/projects/${projectId}/components`);
  },
  getComponent(projectId: string, componentId: string) {
    return request<{ ok: true; dsl: ComponentTemplateDSL }>(`/api/projects/${projectId}/components/${encodeURIComponent(componentId)}`);
  },
  createComponent(projectId: string, dsl: ComponentTemplateDSL) {
    return request<{ ok: true; component: { id: string; name: string; type: string; revision: number } }>(`/api/projects/${projectId}/components`, {
      method: "POST",
      body: JSON.stringify(dsl)
    });
  },
  updateComponent(projectId: string, componentId: string, dsl: ComponentTemplateDSL) {
    return request<{ ok: true; component: { id: string; name: string; type: string; revision: number } }>(`/api/projects/${projectId}/components/${encodeURIComponent(componentId)}`, {
      method: "PUT",
      body: JSON.stringify(dsl)
    });
  },
  deleteComponent(projectId: string, componentId: string) {
    return request<{ ok: true }>(`/api/projects/${projectId}/components/${encodeURIComponent(componentId)}`, { method: "DELETE" });
  },
  commands(projectId: string, pageId: string, baseRevision: number, commands: Command[], source: RevisionSource, operator: string) {
    return request<{ ok: true; revision: number }>(`/api/projects/${projectId}/commands`, {
      method: "POST",
      body: JSON.stringify({ page_id: pageId, base_revision: baseRevision, commands, source, operator })
    });
  },
  boards(projectId: string) {
    return request<{ ok: true; boards: BoardSummary[] }>(`/api/projects/${projectId}/boards`);
  },
  trashedBoards(projectId: string) {
    return request<{ ok: true; boards: TrashedBoardSummary[] }>(`/api/projects/${projectId}/boards/trash`);
  },
  board(projectId: string, boardId: string) {
    return request<{ ok: true; board: BoardDSL }>(`/api/projects/${projectId}/boards/${encodeURIComponent(boardId)}`);
  },
  createBoard(projectId: string, input: { name: string; description?: string; pageIds?: string[] }) {
    return request<{ ok: true; board: BoardDSL }>(`/api/projects/${projectId}/boards`, {
      method: "POST",
      body: JSON.stringify({ name: input.name, description: input.description, page_ids: input.pageIds })
    });
  },
  updateBoard(projectId: string, boardId: string, input: { name?: string; description?: string; isDefault?: boolean }) {
    return request<{ ok: true; board: BoardDSL }>(`/api/projects/${projectId}/boards/${encodeURIComponent(boardId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: input.name, description: input.description, is_default: input.isDefault })
    });
  },
  deleteBoard(projectId: string, boardId: string) {
    return request<{ ok: true; deletedBoardId: string; defaultBoardId: string }>(`/api/projects/${projectId}/boards/${encodeURIComponent(boardId)}`, { method: "DELETE" });
  },
  restoreBoard(projectId: string, trashId: string) {
    return request<{ ok: true; board: BoardDSL }>(`/api/projects/${projectId}/boards/trash/${encodeURIComponent(trashId)}/restore`, { method: "POST" });
  },
  boardCommands(projectId: string, boardId: string, baseRevision: number, commands: BoardCommand[], source: RevisionSource, operator: string) {
    return request<{ ok: true; revision: number }>(`/api/projects/${projectId}/boards/${encodeURIComponent(boardId)}/commands`, {
      method: "POST",
      body: JSON.stringify({ base_revision: baseRevision, commands, source, operator })
    });
  },
  revisions(projectId: string) {
    return request<{ ok: true; revisions: Array<{ object: string; revision: number }> }>(`/api/projects/${projectId}/revisions`);
  },
  versionList(projectId: string) {
    return request<{ ok: true; versions: Array<{ id: string; label: string; createdAt: string }> }>(`/api/projects/${projectId}/versions`);
  },
  versionSave(projectId: string, label: string) {
    return request<{ ok: true; version: { id: string; label: string; createdAt: string } }>(`/api/projects/${projectId}/versions`, {
      method: "POST",
      body: JSON.stringify({ label })
    });
  },
  versionRestore(projectId: string, versionId: string) {
    return request<{ ok: true; version: { id: string; label: string; createdAt: string } }>(`/api/projects/${projectId}/versions/${encodeURIComponent(versionId)}/restore`, {
      method: "POST"
    });
  },
  exportHtml(projectId: string, mode: "content" | "with-annotations" = "content", scope: "current" | "all" = "current", boardId?: string) {
    return request<{ ok: true; html: string }>(`/api/projects/${projectId}/export`, {
      method: "POST",
      body: JSON.stringify({ type: "html", mode, scope, board_id: boardId })
    });
  },
  exportZip(projectId: string) {
    return request<{ ok: true; zip: string; bytes: number }>(`/api/projects/${projectId}/export`, {
      method: "POST",
      body: JSON.stringify({ type: "zip" })
    });
  },
  shareCreate(projectId: string, expiresInSeconds?: number) {
    return request<{ ok: true; token: string; url: string }>(`/api/projects/${projectId}/share`, {
      method: "POST",
      body: JSON.stringify(expiresInSeconds ? { expires_in_seconds: expiresInSeconds } : {})
    });
  },
  shareList(projectId: string) {
    return request<{ ok: true; links: Array<{ token: string; url: string; expiresAt?: string; createdAt: string }> }>(`/api/projects/${projectId}/share`);
  },
  shareRevoke(projectId: string, token: string) {
    return request<{ ok: true }>(`/api/projects/${projectId}/share/${encodeURIComponent(token)}`, {
      method: "DELETE"
    });
  }
};
