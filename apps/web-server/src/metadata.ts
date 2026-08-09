import { randomUUID } from "node:crypto";

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

export interface MetadataStore {
  createUser(name: string, email: string, passwordHash: string, id?: string): Promise<User>;
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
}

export class MemoryMetadataStore implements MetadataStore {
  private users = new Map<string, User>();
  private sessions = new Map<string, SessionRow>();
  private apiTokens = new Map<string, string>();
  private invites = new Map<string, string | undefined>();
  private projects = new Map<string, ProjectRow>();
  private members = new Map<string, ProjectMemberRow>();

  async createUser(name: string, email: string, passwordHash: string, id?: string): Promise<User> {
    const user: User = { id: id ?? randomUUID(), name, email, passwordHash, createdAt: new Date().toISOString() };
    this.users.set(user.id, user);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return [...this.users.values()].find((user) => user.email === email);
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async createInvite(code: string): Promise<void> {
    this.invites.set(code, undefined);
  }

  async consumeInvite(code: string, userId: string): Promise<boolean> {
    if (!this.invites.has(code)) return false;
    if (this.invites.get(code) !== undefined) return false;
    this.invites.set(code, userId);
    return true;
  }

  async createSession(token: string, userId: string, expiresAt: string): Promise<void> {
    this.sessions.set(token, { token, userId, expiresAt });
  }

  async getSession(token: string): Promise<SessionRow | undefined> {
    const row = this.sessions.get(token);
    if (!row) return undefined;
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return row;
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async createApiToken(token: string, userId: string): Promise<void> {
    this.apiTokens.set(token, userId);
  }

  async getUserByApiToken(token: string): Promise<User | undefined> {
    const userId = this.apiTokens.get(token);
    return userId ? this.users.get(userId) : undefined;
  }

  async createProject(row: ProjectRow): Promise<void> {
    this.projects.set(row.id, row);
  }

  async getProjectById(id: string): Promise<ProjectRow | undefined> {
    return this.projects.get(id);
  }

  async listProjectsByOwner(ownerId: string): Promise<ProjectRow[]> {
    const memberProjectIds = new Set(
      [...this.members.values()].filter((member) => member.userId === ownerId).map((member) => member.projectId)
    );
    return [...this.projects.values()]
      .filter((project) => project.ownerId === ownerId || memberProjectIds.has(project.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateProject(id: string, patch: Partial<Pick<ProjectRow, "name" | "description" | "status">>): Promise<void> {
    const row = this.projects.get(id);
    if (!row) return;
    this.projects.set(id, { ...row, ...patch, updatedAt: new Date().toISOString() });
  }

  async addProjectMember(projectId: string, userId: string, role: string): Promise<void> {
    this.members.set(`${projectId}:${userId}`, { projectId, userId, role });
  }

  async hasProjectMember(projectId: string, userId: string): Promise<boolean> {
    return this.members.has(`${projectId}:${userId}`);
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
