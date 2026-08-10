import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import type { BoardCommand, Command, PageDSL, RevisionSource } from "@prototype-studio/dsl-schema";
import type { MetadataStore, User } from "./metadata";
import { MetadataError } from "./metadata";
import { hashPassword, newToken, verifyPassword } from "./auth";
import { ProjectSpaceManager, SpaceError } from "./spaces";
import { renderBoardHtml, renderBoardsHtml } from "./export";
import { handleCloudMcpRequest } from "./mcp/http";
import { buildCloudMcpServer } from "./mcp/server";

export interface AppOptions {
  metadata: MetadataStore;
  spaces: ProjectSpaceManager;
  inviteCodes?: string[];
  baseUrl?: string;
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
    const status = code === "REVISION_CONFLICT" || code === "PAGE_EXISTS" || code === "BOARD_EXISTS" || code === "LAST_BOARD" ? 409
      : code === "PAGE_NOT_FOUND" || code === "BOARD_NOT_FOUND" || code === "TARGET_NOT_FOUND" || code === "REVISION_NOT_FOUND" ? 404
      : code === "INVALID_COMMAND" || code === "CONTAINER_NOT_FOUND" ? 400
      : code === "INVALID_DSL_FILE" || code === "DSL_VALIDATION_FAILED" || code === "BOARD_VALIDATION_FAILED" ? 422
      : 500;
    return { status, code, message: error.message, details: (error as { details?: unknown }).details };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "未知错误" };
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:8787";
  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true, allowedHeaders: ["content-type", "authorization"] });

  const staticRoot = process.env.WEB_STATIC_DIR
    ? resolve(process.env.WEB_STATIC_DIR)
    : resolve(process.cwd(), "apps", "studio", "dist");
  if (existsSync(resolve(staticRoot, "index.html"))) {
    await app.register(fastifyStatic, { root: staticRoot });
  }

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

  function boardIdOf(params: unknown): string {
    const id = (params as { boardId?: string }).boardId ?? "";
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) throw new SpaceError("INVALID_INPUT", "画布 ID 无效。");
    return id;
  }

  function trashIdOf(params: unknown): string {
    const id = (params as { trashId?: string }).trashId ?? "";
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new SpaceError("INVALID_INPUT", "回收站记录 ID 无效。");
    return id;
  }

  app.post("/api/auth/register", async (request, reply) => {
    const body = request.body as { inviteCode?: string; name?: string; email?: string; password?: string };
    if (!body.inviteCode || !body.name?.trim() || !body.email?.trim() || !body.password || body.password.length < 6) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "邀请码、名称、邮箱和至少 6 位密码为必填。" });
      return;
    }
    const userId = randomUUID();
    const passwordHash = await hashPassword(body.password);
    const user = await options.metadata.createUser(body.name.trim(), body.email.trim().toLowerCase(), passwordHash, userId);
    if (!(await options.metadata.consumeInvite(body.inviteCode, userId))) {
      await options.metadata.deleteUser(userId);
      reply.code(400).send({ ok: false, error: "INVALID_INVITE", message: "邀请码无效或已被使用。" });
      return;
    }
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

  app.post("/api/projects/import", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { name?: string; zip?: string };
    if (!body.zip) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "zip 为必填。" });
      return;
    }
    const project = await options.spaces.importZip(user.id, body.name ?? "导入项目", body.zip);
    reply.code(201).send({ ok: true, project });
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

  app.post("/api/projects/:projectId/share", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { expires_in_seconds?: number };
    const share = await options.spaces.createShare(user.id, projectIdOf(request.params), baseUrl, body.expires_in_seconds);
    reply.code(201).send({ ok: true, ...share });
  });

  app.delete("/api/projects/:projectId/share/:token", async (request, reply) => {
    const user = await requireUser(request, reply);
    const params = request.params as { token?: string };
    await options.spaces.revokeShare(user.id, projectIdOf(request.params), params.token ?? "");
    return { ok: true };
  });

  app.get("/api/share/:token", async (request) => {
    const params = request.params as { token?: string };
    return { ok: true, ...(await options.spaces.shareData(params.token ?? "")) };
  });

  app.get("/share/:token", async (request, reply) => {
    const params = request.params as { token?: string };
    const html = await options.spaces.shareHtml(params.token ?? "");
    reply.type("text/html; charset=utf-8").send(html);
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

  app.put("/api/projects/:projectId/pages/:pageId", async (request, reply) => {
    const user = await requireUser(request, reply);
    const params = request.params as { pageId?: string };
    const body = request.body as { content?: PageDSL; base_revision?: number; source?: RevisionSource; operator?: string };
    if (!body.content || typeof body.base_revision !== "number") {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "content 与 base_revision 为必填。" });
      return;
    }
    const result = await options.spaces.putPageSnapshot(user.id, projectIdOf(request.params), params.pageId ?? "", body.content, {
      baseRevision: body.base_revision,
      source: body.source ?? "api",
      operator: body.operator ?? user.name
    });
    return { ok: true, revision: result.revision.revision };
  });

  app.delete("/api/projects/:projectId/pages/:pageId", async (request, reply) => {
    const user = await requireUser(request, reply);
    const params = request.params as { pageId?: string };
    await options.spaces.deletePage(user.id, projectIdOf(request.params), params.pageId ?? "");
    return { ok: true };
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

  app.get("/api/projects/:projectId/boards", async (request, reply) => {
    const user = await requireUser(request, reply);
    return { ok: true, boards: await options.spaces.listBoards(user.id, projectIdOf(request.params)) };
  });

  app.post("/api/projects/:projectId/boards", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { name?: string; description?: string; page_ids?: string[]; board_id?: string };
    if (!body.name?.trim() || (body.page_ids !== undefined && !Array.isArray(body.page_ids))) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "name 必填，page_ids 必须是数组。" });
      return;
    }
    const board = await options.spaces.createBoard(user.id, projectIdOf(request.params), {
      name: body.name.trim(),
      description: body.description,
      pageIds: body.page_ids,
      boardId: body.board_id
    });
    reply.code(201).send({ ok: true, board });
  });

  app.post("/api/projects/:projectId/boards/batch", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { boards?: Array<{ name?: string; description?: string; page_ids?: string[]; board_id?: string }> };
    if (!Array.isArray(body.boards) || !body.boards.length || body.boards.some((board) => !board.name?.trim())) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "boards 必须是包含有效名称的非空数组。" });
      return;
    }
    const boards = await options.spaces.createBoards(user.id, projectIdOf(request.params), body.boards.map((board) => ({
      name: board.name!.trim(),
      description: board.description,
      pageIds: board.page_ids,
      boardId: board.board_id
    })));
    reply.code(201).send({ ok: true, boards });
  });

  app.get("/api/projects/:projectId/boards/trash", async (request, reply) => {
    const user = await requireUser(request, reply);
    return { ok: true, boards: await options.spaces.listTrashedBoards(user.id, projectIdOf(request.params)) };
  });

  app.post("/api/projects/:projectId/boards/trash/:trashId/restore", async (request, reply) => {
    const user = await requireUser(request, reply);
    const board = await options.spaces.restoreBoard(user.id, projectIdOf(request.params), trashIdOf(request.params));
    return { ok: true, board };
  });

  app.get("/api/projects/:projectId/boards/:boardId", async (request, reply) => {
    const user = await requireUser(request, reply);
    return { ok: true, board: await options.spaces.getBoard(user.id, projectIdOf(request.params), boardIdOf(request.params)) };
  });

  app.patch("/api/projects/:projectId/boards/:boardId", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { name?: string; description?: string; is_default?: boolean };
    if (body.name !== undefined && !body.name.trim()) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "画布名称不能为空。" });
      return;
    }
    const board = await options.spaces.updateBoard(user.id, projectIdOf(request.params), boardIdOf(request.params), {
      name: body.name,
      description: body.description,
      isDefault: body.is_default
    });
    return { ok: true, board };
  });

  app.delete("/api/projects/:projectId/boards/:boardId", async (request, reply) => {
    const user = await requireUser(request, reply);
    return { ok: true, ...(await options.spaces.deleteBoard(user.id, projectIdOf(request.params), boardIdOf(request.params))) };
  });

  app.post("/api/projects/:projectId/boards/:boardId/commands", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { base_revision?: number; commands?: BoardCommand[]; source?: RevisionSource; operator?: string };
    if (typeof body.base_revision !== "number" || !Array.isArray(body.commands)) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "base_revision 与 commands 为必填。" });
      return;
    }
    const result = await options.spaces.applyBoardCommands(user.id, projectIdOf(request.params), boardIdOf(request.params), {
      baseRevision: body.base_revision,
      commands: body.commands,
      source: body.source ?? "api",
      operator: body.operator ?? user.name
    });
    return { ok: true, revision: result.revision.revision, changed_object_ids: result.revision.changedObjectIds };
  });

  app.post("/api/projects/:projectId/board-commands", async (request, reply) => {
    const user = await requireUser(request, reply);
    const body = request.body as { base_revision?: number; commands?: BoardCommand[]; source?: RevisionSource; operator?: string };
    if (typeof body.base_revision !== "number" || !Array.isArray(body.commands)) {
      reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "base_revision 与 commands 为必填。" });
      return;
    }
    const defaultBoard = await options.spaces.getBoard(user.id, projectIdOf(request.params));
    const result = await options.spaces.applyBoardCommands(user.id, projectIdOf(request.params), defaultBoard.id, {
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

  app.post("/api/projects/:projectId/export", async (request, reply) => {
    const user = await requireUser(request, reply);
    const projectId = projectIdOf(request.params);
    const body = request.body as { type?: string; mode?: string; scope?: string; board_id?: string };
    if (body.type === "product-package") {
      return { ok: true, package: await options.spaces.productPackage(user.id, projectId) };
    }
    if (body.type === "html") {
      const tree = await options.spaces.tree(user.id, projectId);
      const pages: Record<string, PageDSL> = {};
      for (const summary of tree.pages) {
        pages[summary.id] = await options.spaces.getPageDsl(user.id, projectId, summary.id);
      }
      const mode = body.mode === "with-annotations" ? "with-annotations" : "content";
      const html = body.scope === "all"
        ? await renderBoardsHtml(
          await Promise.all(tree.boards.map((board) => options.spaces.getBoard(user.id, projectId, board.id))),
          pages,
          tree.manifest.name,
          tree.manifest.defaultBoardId ?? tree.board.id,
          { mode }
        )
        : await renderBoardHtml(
          body.board_id ? await options.spaces.getBoard(user.id, projectId, body.board_id) : tree.board,
          pages,
          tree.manifest.name,
          { mode }
        );
      return { ok: true, html };
    }
    if (body.type === "zip") {
      const zip = await options.spaces.exportZip(user.id, projectId);
      return { ok: true, zip: zip.toString("base64"), bytes: zip.length };
    }
    reply.code(400).send({ ok: false, error: "INVALID_INPUT", message: "导出类型仅支持 product-package 或 html。" });
  });

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      reply.hijack();
      await handleCloudMcpRequest(request.raw, reply.raw, {
        parsedBody: request.body,
        createServer: (token) => buildCloudMcpServer({ metadata: options.metadata, spaces: options.spaces, baseUrl, token })
      });
    }
  });

  if (existsSync(resolve(staticRoot, "index.html"))) {
    app.setNotFoundHandler((request, reply) => {
      const wantsHtml = request.method === "GET" && (request.headers.accept ?? "").includes("text/html");
      const isApi = request.url.startsWith("/api/") || request.url === "/api" || request.url === "/mcp";
      if (wantsHtml && !isApi) {
        return reply.type("text/html").sendFile("index.html");
      }
      reply.code(404).send({ message: "Route not found", error: "Not Found", statusCode: 404 });
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Error && error.message === "unauthorized") return;
    const mapped = toHttpError(error);
    reply.code(mapped.status).send({ ok: false, error: mapped.code, message: mapped.message, ...(mapped.details === undefined ? {} : { details: mapped.details }) });
  });

  return app;
}
