import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import type { BoardCommand, Command, PageDSL, RevisionSource } from "@prototype-studio/dsl-schema";
import type { MetadataStore, User } from "./metadata";
import { MetadataError } from "./metadata";
import { hashPassword, newToken, verifyPassword } from "./auth";
import { ProjectSpaceManager, SpaceError } from "./spaces";
import { renderBoardHtml } from "./export";

export interface AppOptions {
  metadata: MetadataStore;
  spaces: ProjectSpaceManager;
  inviteCodes?: string[];
}

const projectIdPattern = /^[a-zA-Z0-9-]{8,64}$/;

function toHttpError(error: unknown): { status: number; code: string; message: string; details?: unknown } {
  if (error instanceof SpaceError || error instanceof MetadataError) {
    const status = error.code === "NOT_FOUND" ? 404
      : error.code === "FORBIDDEN" ? 403
      : error.code === "CONFLICT" || error.code === "EMAIL_EXISTS" ? 409
      : error.code === "ARCHIVED" ? 410
      : error.code === "INVALID_INVITE" || error.code === "INVALID_CREDENTIALS" || error.code === "INVALID_INPUT" ? 400
      : 500;
    return { status, code: error.code, message: error.message, details: "details" in error ? (error as { details?: unknown }).details : undefined };
  }
  if (error instanceof Error && "code" in error) {
    const code = String((error as { code: unknown }).code);
    const status = code === "REVISION_CONFLICT" || code === "PAGE_EXISTS" ? 409
      : code === "PAGE_NOT_FOUND" || code === "TARGET_NOT_FOUND" || code === "REVISION_NOT_FOUND" ? 404
      : code === "INVALID_COMMAND" || code === "CONTAINER_NOT_FOUND" ? 400
      : code === "INVALID_DSL_FILE" || code === "DSL_VALIDATION_FAILED" || code === "BOARD_VALIDATION_FAILED" ? 422
      : 500;
    return { status, code, message: error.message, details: (error as { details?: unknown }).details };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "未知错误" };
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  for (const code of options.inviteCodes ?? ["PROTOTYPE-DEV"]) {
    await options.metadata.createInvite(code);
  }

  async function sessionUser(request: FastifyRequest): Promise<User | undefined> {
    const cookieToken = request.cookies?.ps_session;
    if (cookieToken) {
      const session = await options.metadata.getSession(cookieToken);
      if (session) return options.metadata.getUserById(session.userId);
    }
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      return options.metadata.getUserByApiToken(authorization.slice("Bearer ".length));
    }
    return undefined;
  }

  async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<User> {
    const user = await sessionUser(request);
    if (!user) {
      reply.code(401).send({ ok: false, error: "UNAUTHORIZED", message: "请先登录。" });
      throw new Error("unauthorized");
    }
    return user;
  }

  function projectIdOf(params: unknown): string {
    const id = (params as { projectId?: string }).projectId ?? "";
    if (!projectIdPattern.test(id)) throw new SpaceError("INVALID_INPUT", "项目 ID 无效。");
    return id;
  }

  app.post("/api/auth/register", async (request, reply) => {
    const body = request.body as { inviteCode?: string; name?: string; email?: string; password?: string };
    if (!body.inviteCode || !body.name?.trim() || !body.email?.trim() || !body.password || body.password.length < 6) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "邀请码、名称、邮箱和至少 6 位密码为必填。" });
      return;
    }
    const userId = randomUUID();
    if (!(await options.metadata.consumeInvite(body.inviteCode, userId))) {
      reply.code(400).send({ ok: false, error: "INVALID_INVITE", message: "邀请码无效或已被使用。" });
      return;
    }
    const passwordHash = await hashPassword(body.password);
    const user = await options.metadata.createUser(body.name.trim(), body.email.trim().toLowerCase(), passwordHash, userId);
    reply.code(201).send({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "邮箱和密码为必填。" });
      return;
    }
    const user = await options.metadata.getUserByEmail(body.email.trim().toLowerCase());
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new MetadataError("INVALID_CREDENTIALS", "邮箱或密码错误。");
    }
    const sessionToken = newToken();
    const apiToken = newToken();
    await options.metadata.createSession(sessionToken, user.id, new Date(Date.now() + 30 * 24 * 3600_000).toISOString());
    await options.metadata.createApiToken(apiToken, user.id);
    reply.setCookie("ps_session", sessionToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
    reply.send({ ok: true, user: { id: user.id, name: user.name, email: user.email }, apiToken });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies?.ps_session;
    if (token) await options.metadata.deleteSession(token);
    reply.clearCookie("ps_session", { path: "/" });
    reply.send({ ok: true });
  });

  app.get("/api/me", async (request) => {
    const user = await sessionUser(request);
    return { ok: true, user: user ? { id: user.id, name: user.name, email: user.email } : null };
  });

  app.get("/api/projects", async (request, reply) => {
    const user = await requireUser(request, reply);
    return { ok: true, projects: await options.spaces.listSpaces(user.id) };
  });

  app.post("/api/projects", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { name?: string; description?: string };
    if (!body.name?.trim()) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "项目名称必填。" });
      return;
    }
    const row = await options.spaces.createSpace(user, body.name.trim(), body.description?.trim());
    reply.code(201).send({ ok: true, project: row });
  });

  app.patch("/api/projects/:projectId", async (request, reply) => {
    const user = await requireUser(request, reply);
    const projectId = projectIdOf(request.params);
    const body = request.body as { name?: string };
    if (!body.name?.trim()) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "项目名称必填。" });
      return;
    }
    return { ok: true, project: await options.spaces.renameSpace(user.id, projectId, body.name.trim()) };
  });

  app.delete("/api/projects/:projectId", async (request, reply) => {
    const user = await requireUser(request, reply);
    await options.spaces.archiveSpace(user.id, projectIdOf(request.params));
    return { ok: true };
  });

  app.get("/api/projects/:projectId/tree", async (request, reply) => {
    const user = await requireUser(request, reply);
    return { ok: true, ...(await options.spaces.tree(user.id, projectIdOf(request.params))) };
  });

  app.get("/api/projects/:projectId/pages/:pageId", async (request, reply) => {
    const user = await requireUser(request, reply);
    const params = request.params as { pageId?: string };
    return { ok: true, dsl: await options.spaces.getPageDsl(user.id, projectIdOf(request.params), params.pageId ?? "") };
  });

  app.post("/api/projects/:projectId/pages", async (request, reply) => {
    const user = await requireUser(request, reply);
    const dsl = request.body as PageDSL;
    const created = await options.spaces.createPage(user.id, projectIdOf(request.params), dsl);
    reply.code(201).send({ ok: true, page: created });
  });

  app.post("/api/projects/:projectId/commands", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { page_id?: string; base_revision?: number; commands?: Command[]; source?: RevisionSource; operator?: string };
    if (!body.page_id || typeof body.base_revision !== "number" || !Array.isArray(body.commands)) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "page_id、base_revision 与 commands 为必填。" });
      return;
    }
    const result = await options.spaces.applyPageCommands(user.id, projectIdOf(request.params), body.page_id, {
      baseRevision: body.base_revision,
      commands: body.commands,
      source: body.source ?? "api",
      operator: body.operator ?? user.name
    });
    return { ok: true, revision: result.revision.revision, changed_component_ids: result.revision.changedComponentIds };
  });

  app.get("/api/projects/:projectId/board", async (request, reply) => {
    const user = await requireUser(request, reply);
    return { ok: true, board: await options.spaces.getBoard(user.id, projectIdOf(request.params)) };
  });

  app.post("/api/projects/:projectId/board-commands", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { base_revision?: number; commands?: BoardCommand[]; source?: RevisionSource; operator?: string };
    if (typeof body.base_revision !== "number" || !Array.isArray(body.commands)) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "base_revision 与 commands 为必填。" });
      return;
    }
    const result = await options.spaces.applyBoardCommands(user.id, projectIdOf(request.params), {
      baseRevision: body.base_revision,
      commands: body.commands,
      source: body.source ?? "api",
      operator: body.operator ?? user.name
    });
    return { ok: true, revision: result.revision.revision, changed_object_ids: result.revision.changedObjectIds };
  });

  app.get("/api/projects/:projectId/revisions", async (request, reply) => {
    const user = await requireUser(request, reply);
    return { ok: true, revisions: await options.spaces.revisions(user.id, projectIdOf(request.params)) };
  });

  app.get("/api/projects/:projectId/requirements/:file", async (request, reply) => {
    const user = await requireUser(request, reply);
    const params = request.params as { file?: string };
    return { ok: true, ...(await options.spaces.requirements(user.id, projectIdOf(request.params), params.file ?? "")) };
  });

  app.post("/api/projects/:projectId/export", async (request, reply) => {
    const user = await requireUser(request, reply);
    const projectId = projectIdOf(request.params);
    const body = request.body as { type?: string };
    if (body.type === "product-package") {
      return { ok: true, package: await options.spaces.productPackage(user.id, projectId) };
    }
    if (body.type === "html") {
      const tree = await options.spaces.tree(user.id, projectId);
      const pages: Record<string, PageDSL> = {};
      for (const summary of tree.pages) {
        pages[summary.id] = await options.spaces.getPageDsl(user.id, projectId, summary.id);
      }
      const html = await renderBoardHtml(tree.board, pages, tree.manifest.name);
      return { ok: true, html };
    }
    if (body.type === "zip") {
      const zip = await options.spaces.exportZip(user.id, projectId);
      return { ok: true, zip: zip.toString("base64"), bytes: zip.length };
    }
    reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "导出类型仅支持 product-package 或 html。" });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Error && error.message === "unauthorized") return;
    const mapped = toHttpError(error);
    reply.code(mapped.status).send({ ok: false, error: mapped.code, message: mapped.message, ...(mapped.details === undefined ? {} : { details: mapped.details }) });
  });

  return app;
}
