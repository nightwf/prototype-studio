import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import type { MetadataStore, ProjectMemberRow, ProjectRow, SessionRow, ShareLinkRow, User } from "./metadata";

const { Pool } = pg;

function mapUser(row: Record<string, unknown>): User {
  return { id: String(row.id), name: String(row.name), email: String(row.email), passwordHash: String(row.password_hash), createdAt: String(row.created_at) };
}

function mapProject(row: Record<string, unknown>): ProjectRow {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    description: row.description == null ? undefined : String(row.description),
    status: String(row.status) as ProjectRow["status"],
    spacePath: String(row.space_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

/** PostgreSQL 元数据存储（生产）。测试与本地开发使用 MemoryMetadataStore。 */
export class PostgresMetadataStore implements MetadataStore {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async migrate(): Promise<void> {
    const sql = await readFile(join(process.cwd(), "apps", "web-server", "migrations", "001_init.sql"), "utf8");
    await this.pool.query(sql);
  }

  async createUser(name: string, email: string, passwordHash: string, id?: string): Promise<User> {
    const result = await this.pool.query(
      "insert into users (id, name, email, password_hash) values ($1, $2, $3, $4) returning *",
      [id ?? crypto.randomUUID(), name, email, passwordHash]
    );
    return mapUser(result.rows[0]);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await this.pool.query("select * from users where email = $1", [email]);
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const result = await this.pool.query("select * from users where id = $1", [id]);
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async createInvite(code: string): Promise<void> {
    await this.pool.query("insert into invite_codes (code) values ($1) on conflict do nothing", [code]);
  }

  async consumeInvite(code: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      "update invite_codes set consumed_by = $2 where code = $1 and consumed_by is null returning code",
      [code, userId]
    );
    return result.rowCount === 1;
  }

  async createSession(token: string, userId: string, expiresAt: string): Promise<void> {
    await this.pool.query("insert into sessions (token, user_id, expires_at) values ($1, $2, $3)", [token, userId, expiresAt]);
  }

  async getSession(token: string): Promise<SessionRow | undefined> {
    const result = await this.pool.query("select * from sessions where token = $1 and expires_at > now()", [token]);
    return result.rows[0] ? { token: String(result.rows[0].token), userId: String(result.rows[0].user_id), expiresAt: String(result.rows[0].expires_at) } : undefined;
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query("delete from sessions where token = $1", [token]);
  }

  async createApiToken(token: string, userId: string): Promise<void> {
    await this.pool.query("insert into api_tokens (token, user_id) values ($1, $2)", [token, userId]);
  }

  async getUserByApiToken(token: string): Promise<User | undefined> {
    const result = await this.pool.query(
      "select u.* from api_tokens t join users u on u.id = t.user_id where t.token = $1",
      [token]
    );
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async createProject(row: ProjectRow): Promise<void> {
    await this.pool.query(
      "insert into projects (id, owner_id, name, description, status, space_path, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [row.id, row.ownerId, row.name, row.description ?? null, row.status, row.spacePath, row.createdAt, row.updatedAt]
    );
  }

  async getProjectById(id: string): Promise<ProjectRow | undefined> {
    const result = await this.pool.query("select * from projects where id = $1", [id]);
    return result.rows[0] ? mapProject(result.rows[0]) : undefined;
  }

  async listProjectsByOwner(ownerId: string): Promise<ProjectRow[]> {
    const result = await this.pool.query(
      "select p.* from projects p where p.owner_id = $1 or exists (select 1 from project_members m where m.project_id = p.id and m.user_id = $1) order by p.created_at",
      [ownerId]
    );
    return result.rows.map(mapProject);
  }

  async updateProject(id: string, patch: Partial<Pick<ProjectRow, "name" | "description" | "status">>): Promise<void> {
    await this.pool.query(
      "update projects set name = coalesce($2, name), description = coalesce($3, description), status = coalesce($4, status), updated_at = now() where id = $1",
      [id, patch.name ?? null, patch.description ?? null, patch.status ?? null]
    );
  }

  async addProjectMember(projectId: string, userId: string, role: string): Promise<void> {
    await this.pool.query("insert into project_members (project_id, user_id, role) values ($1,$2,$3) on conflict do nothing", [projectId, userId, role]);
  }

  async hasProjectMember(projectId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query("select 1 from project_members where project_id = $1 and user_id = $2", [projectId, userId]);
    return result.rowCount === 1;
  }

  async createShareLink(row: ShareLinkRow): Promise<void> {
    await this.pool.query(
      "insert into share_links (id, project_id, token, mode, created_by, expires_at) values ($1,$2,$3,$4,$5,$6)",
      [row.id, row.projectId, row.token, row.mode, row.createdBy, row.expiresAt ?? null]
    );
  }

  async getShareLinkByToken(token: string): Promise<ShareLinkRow | undefined> {
    const result = await this.pool.query("select * from share_links where token = $1", [token]);
    const row = result.rows[0];
    return row ? {
      id: String(row.id),
      projectId: String(row.project_id),
      token: String(row.token),
      mode: String(row.mode),
      createdBy: String(row.created_by),
      expiresAt: row.expires_at == null ? undefined : String(row.expires_at),
      createdAt: String(row.created_at)
    } : undefined;
  }

  async deleteShareLink(token: string): Promise<void> {
    await this.pool.query("delete from share_links where token = $1", [token]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export type { ProjectMemberRow };
