import type { BoardCommand, BoardDSL, Command, PageDSL, RevisionSource } from "@prototype-studio/dsl-schema";
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
  headers.set("content-type", "application/json");
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
    return request<{ ok: true; manifest: { name: string }; pages: Array<{ id: string; title: string }>; board: BoardDSL }>(`/api/projects/${projectId}/tree`);
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
  commands(projectId: string, pageId: string, baseRevision: number, commands: Command[], source: RevisionSource, operator: string) {
    return request<{ ok: true; revision: number }>(`/api/projects/${projectId}/commands`, {
      method: "POST",
      body: JSON.stringify({ page_id: pageId, base_revision: baseRevision, commands, source, operator })
    });
  },
  board(projectId: string) {
    return request<{ ok: true; board: BoardDSL }>(`/api/projects/${projectId}/board`);
  },
  boardCommands(projectId: string, baseRevision: number, commands: BoardCommand[], source: RevisionSource, operator: string) {
    return request<{ ok: true; revision: number }>(`/api/projects/${projectId}/board-commands`, {
      method: "POST",
      body: JSON.stringify({ base_revision: baseRevision, commands, source, operator })
    });
  },
  revisions(projectId: string) {
    return request<{ ok: true; revisions: Array<{ object: string; revision: number }> }>(`/api/projects/${projectId}/revisions`);
  },
  exportHtml(projectId: string, mode: "content" | "with-annotations" = "content") {
    return request<{ ok: true; html: string }>(`/api/projects/${projectId}/export`, {
      method: "POST",
      body: JSON.stringify({ type: "html", mode })
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
  }
};
