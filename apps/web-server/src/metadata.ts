import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface ProjectRow {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  spacePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRow {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface ProjectMemberRow {
  projectId: string;
  userId: string;
  role: string;
}

export interface ShareLinkRow {
  id: string;
  projectId: string;
  token: string;
  mode: string;
  createdBy: string;
  expiresAt?: string;
  createdAt: string;
}

export interface MetadataStore {
  createUser(name: string, email: string, passwordHash: string, id?: string): Promise<User>;
  deleteUser(id: string): Promise<void>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  createInvite(code: string): Promise<void>;
  consumeInvite(code: string, userId: string): Promise<boolean>;
  createSession(token: string, userId: string, expiresAt: string): Promise<void>;
  getSession(token: string): Promise<SessionRow | undefined>;
  deleteSession(token: string): Promise<void>;
  createApiToken(token: string, userId: string): Promise<void>;
  getUserByApiToken(token: string): Promise<User | undefined>;
  createProject(row: ProjectRow): Promise<void>;
  getProjectById(id: string): Promise<ProjectRow | undefined>;
  listProjectsByOwner(ownerId: string): Promise<ProjectRow[]>;
  updateProject(id: string, patch: Partial<Pick<ProjectRow, "name" | "description" | "status">>): Promise<void>;
  addProjectMember(projectId: string, userId: string, role: string): Promise<void>;
  hasProjectMember(projectId: string, userId: string): Promise<boolean>;
  createShareLink(row: ShareLinkRow): Promise<void>;
  getShareLinkByToken(token: string): Promise<ShareLinkRow | undefined>;
  deleteShareLink(token: string): Promise<void>;
}

export class MemoryMetadataStore implements MetadataStore {
  private users = new Map<string, User>();
  private sessions = new Map<string, SessionRow>();
  private apiTokens = new Map<string, string>();
  private invites = new Map<string, string | undefined>();
  private projects = new Map<string, ProjectRow>();
  private members = new Map<string, ProjectMemberRow>();
  private shareLinks = new Map<string, ShareLinkRow>();
  private readonly ready: Promise<void>;

  constructor(private readonly persistPath?: string) {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const raw = JSON.parse(await readFile(this.persistPath, "utf8")) as {
        users?: User[]; sessions?: SessionRow[]; apiTokens?: Array<{ token: string; userId: string }>;
        invites?: Array<{ code: string; consumedBy?: string }>; projects?: ProjectRow[];
        members?: ProjectMemberRow[]; shareLinks?: ShareLinkRow[];
      };
      raw.users?.forEach((user) => this.users.set(user.id, user));
      raw.sessions?.forEach((session) => this.sessions.set(session.token, session));
      raw.apiTokens?.forEach((entry) => this.apiTokens.set(entry.token, entry.userId));
      raw.invites?.forEach((entry) => this.invites.set(entry.code, entry.consumedBy));
      raw.projects?.forEach((project) => this.projects.set(project.id, project));
      raw.members?.forEach((member) => this.members.set(`${member.projectId}:${member.userId}`, member));
      raw.shareLinks?.forEach((link) => this.shareLinks.set(link.token, link));
    } catch {
      // 首次启动或无持久化文件时忽略
    }
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;
    const state = {
      users: [...this.users.values()],
      sessions: [...this.sessions.values()],
      apiTokens: [...this.apiTokens.entries()].map(([token, userId]) => ({ token, userId })),
      invites: [...this.invites.entries()].map(([code, consumedBy]) => ({ code, consumedBy })),
      projects: [...this.projects.values()],
      members: [...this.members.values()],
      shareLinks: [...this.shareLinks.values()]
    };
    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(state, null, 2));
  }

  async createUser(name: string, email: string, passwordHash: string, id?: string): Promise<User> {
    const user: User = { id: id ?? randomUUID(), name, email, passwordHash, createdAt: new Date().toISOString() };
    this.users.set(user.id, user);
    await this.persist();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
    await this.persist();
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    await this.ready;
    return [...this.users.values()].find((user) => user.email === email);
  }

  async getUserById(id: string): Promise<User | undefined> {
    await this.ready;
    return this.users.get(id);
  }

  async createInvite(code: string): Promise<void> {
    this.invites.set(code, undefined);
    await this.persist();
  }

  async consumeInvite(code: string, userId: string): Promise<boolean> {
    if (!this.invites.has(code)) return false;
    if (this.invites.get(code) !== undefined) return false;
    this.invites.set(code, userId);
    await this.persist();
    return true;
  }

  async createSession(token: string, userId: string, expiresAt: string): Promise<void> {
    this.sessions.set(token, { token, userId, expiresAt });
    await this.persist();
  }

  async getSession(token: string): Promise<SessionRow | undefined> {
    await this.ready;
    const row = this.sessions.get(token);
    if (!row) return undefined;
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      this.sessions.delete(token);
      await this.persist();
      return undefined;
    }
    return row;
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
    await this.persist();
  }

  async createApiToken(token: string, userId: string): Promise<void> {
    this.apiTokens.set(token, userId);
    await this.persist();
  }

  async getUserByApiToken(token: string): Promise<User | undefined> {
    await this.ready;
    const userId = this.apiTokens.get(token);
    return userId ? this.users.get(userId) : undefined;
  }

  async createProject(row: ProjectRow): Promise<void> {
    this.projects.set(row.id, row);
    await this.persist();
  }

  async getProjectById(id: string): Promise<ProjectRow | undefined> {
    await this.ready;
    return this.projects.get(id);
  }

  async listProjectsByOwner(ownerId: string): Promise<ProjectRow[]> {
    await this.ready;
    const memberProjectIds = new Set(
      [...this.members.values()].filter((member) => member.userId === ownerId).map((member) => member.projectId)
    );
    return [...this.projects.values()]
      .filter((project) => project.ownerId === ownerId || memberProjectIds.has(project.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateProject(id: string, patch: Partial<Pick<ProjectRow, "name" | "description" | "status">>): Promise<void> {
    const row = this.projects.get(id);
    if (!row) return;
    this.projects.set(id, { ...row, ...patch, updatedAt: new Date().toISOString() });
    await this.persist();
  }

  async addProjectMember(projectId: string, userId: string, role: string): Promise<void> {
    this.members.set(`${projectId}:${userId}`, { projectId, userId, role });
    await this.persist();
  }

  async hasProjectMember(projectId: string, userId: string): Promise<boolean> {
    await this.ready;
    return this.members.has(`${projectId}:${userId}`);
  }

  async createShareLink(row: ShareLinkRow): Promise<void> {
    this.shareLinks.set(row.token, row);
    await this.persist();
  }

  async getShareLinkByToken(token: string): Promise<ShareLinkRow | undefined> {
    await this.ready;
    return this.shareLinks.get(token);
  }

  async deleteShareLink(token: string): Promise<void> {
    this.shareLinks.delete(token);
    await this.persist();
  }
}

export class MetadataError extends Error {
  constructor(
    public readonly code: "EMAIL_EXISTS" | "INVALID_INVITE" | "INVALID_CREDENTIALS" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "MetadataError";
  }
}
