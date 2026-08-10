import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { buildApp } from "./index";
import { MemoryMetadataStore } from "./metadata";
import { ProjectSpaceManager } from "./spaces";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function testApp(inviteCode = "TEST-INVITE") {
  const root = await mkdtemp(join(tmpdir(), "prototype-web-"));
  temporaryRoots.push(root);
  const metadata = new MemoryMetadataStore();
  const spaces = new ProjectSpaceManager(metadata, join(root, "spaces"));
  const app = await buildApp({ metadata, spaces, inviteCodes: [inviteCode, "TEST-INVITE-2"] });
  return { app, root };
}

async function registerAndLogin(app: Awaited<ReturnType<typeof testApp>>["app"], name: string, email: string, inviteCode = "TEST-INVITE") {
  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { inviteCode, name, email, password: "secret123" }
  });
  if (register.statusCode !== 201) throw new Error(`注册失败：${register.statusCode} ${register.body}`);
  expect(register.statusCode).toBe(201);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "secret123" }
  });
  expect(login.statusCode).toBe(200);
  const body = login.json();
  const cookieHeader = login.headers["set-cookie"];
  const cookie = typeof cookieHeader === "string" ? cookieHeader.split(";")[0] : "";
  return { apiToken: body.apiToken as string, cookie };
}

describe("web server project spaces", () => {
  it("registers, logs in, creates a project and exercises the space API", async () => {
    const { app } = await testApp();
    const { cookie } = await registerAndLogin(app, "张三", "zhang@example.com");
    const auth = { cookie };

    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "案件中台", description: "测试项目" }, headers: auth });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    const tree = await app.inject({ method: "GET", url: `/api/projects/${projectId}/tree`, headers: auth });
    expect(tree.statusCode).toBe(200);
    expect(tree.json().board).toMatchObject({ revision: 1, objects: [] });

    const pageCreated = await app.inject({ method: "POST", url: `/api/projects/${projectId}/pages`, payload: structuredClone(caseListExample), headers: auth });
    expect(pageCreated.statusCode).toBe(201);

    const commands = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/commands`,
      payload: {
        page_id: "case-list",
        base_revision: 1,
        commands: [{ type: "UPDATE_COMPONENT", target: "search.status", changes: { label: "状态" } }]
      },
      headers: auth
    });
    expect(commands.statusCode).toBe(200);
    expect(commands.json()).toMatchObject({ ok: true, revision: 2 });

    const currentPage = await app.inject({ method: "GET", url: `/api/projects/${projectId}/pages/case-list`, headers: auth });
    const pageDsl = currentPage.json().dsl as typeof caseListExample;
    const snapshot = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/pages/case-list`,
      payload: { content: { ...pageDsl, revision: 3, page: { ...pageDsl.page, title: "案件管理-改" } }, base_revision: 2 },
      headers: auth
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({ ok: true, revision: 3 });

    const boardCommands = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/board-commands`,
      payload: {
        base_revision: 1,
        commands: [{ type: "ADD_BOARD_OBJECT", object: { id: "note-1", type: "note", x: 0, y: 0, width: 200, height: 80, text: "说明" } }]
      },
      headers: auth
    });
    expect(boardCommands.statusCode).toBe(200);
    expect(boardCommands.json()).toMatchObject({ ok: true, revision: 2, changed_object_ids: ["note-1"] });

    const revisions = await app.inject({ method: "GET", url: `/api/projects/${projectId}/revisions`, headers: auth });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().revisions.length).toBeGreaterThanOrEqual(2);

    const createdBoard = await app.inject({ method: "POST", url: `/api/projects/${projectId}/boards`, payload: { name: "对账画布", page_ids: ["case-list"] }, headers: auth });
    expect(createdBoard.statusCode).toBe(201);
    expect(createdBoard.json().board.objects).toHaveLength(1);
    const boardId = createdBoard.json().board.id as string;
    const boardList = await app.inject({ method: "GET", url: `/api/projects/${projectId}/boards`, headers: auth });
    expect(boardList.json().boards).toHaveLength(2);
    const boardRead = await app.inject({ method: "GET", url: `/api/projects/${projectId}/boards/${boardId}`, headers: auth });
    expect(boardRead.json().board.name).toBe("对账画布");

    const exported = await app.inject({ method: "POST", url: `/api/projects/${projectId}/export`, payload: { type: "html" }, headers: auth });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().html).toContain("data-board-object");
    expect(exported.json().html).toContain("data-board-marker");
    expect(exported.json().html).toContain("html,body{margin:0;background:#e6eaed");

    const allBoardsExport = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export`,
      payload: { type: "html", scope: "all" },
      headers: auth
    });
    expect(allBoardsExport.statusCode).toBe(200);
    expect(allBoardsExport.json().html).toContain("data-board-tab");
    expect(allBoardsExport.json().html).toContain("主画布");
    expect(allBoardsExport.json().html).toContain("对账画布");

    const zip = await app.inject({ method: "POST", url: `/api/projects/${projectId}/export`, payload: { type: "zip" }, headers: auth });
    if (zip.statusCode !== 200) throw new Error(`zip 导出失败：${zip.statusCode} ${zip.body}`);
    expect(zip.statusCode).toBe(200);
    const zipBuffer = Buffer.from(zip.json().zip as string, "base64");
    expect(zipBuffer.subarray(0, 2).toString()).toBe("PK");

    expect((await app.inject({ method: "DELETE", url: `/api/projects/${projectId}/boards/${boardId}`, headers: auth })).statusCode).toBe(200);
    const trash = await app.inject({ method: "GET", url: `/api/projects/${projectId}/boards/trash`, headers: auth });
    expect(trash.statusCode).toBe(200);
    const trashId = trash.json().boards[0].trashId as string;
    const restored = await app.inject({ method: "POST", url: `/api/projects/${projectId}/boards/trash/${trashId}/restore`, headers: auth });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().board).toMatchObject({ id: boardId, name: "对账画布" });
  });

  it("isolates projects between users and rejects path traversal", async () => {
    const { app } = await testApp();
    const alice = await registerAndLogin(app, "Alice", "alice@example.com");
    const bob = await registerAndLogin(app, "Bob", "bob@example.com", "TEST-INVITE-2");
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A 的项目" }, headers: { cookie: alice.cookie } });
    const projectId = created.json().project.id as string;

    const forbidden = await app.inject({ method: "GET", url: `/api/projects/${projectId}/tree`, headers: { cookie: bob.cookie } });
    expect(forbidden.statusCode).toBe(403);

    const traversal = await app.inject({ method: "GET", url: `/api/projects/${projectId}/boards/..%2Fproject`, headers: { cookie: alice.cookie } });
    expect([400, 404]).toContain(traversal.statusCode);

    const conflict = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/commands`,
      payload: { page_id: "missing", base_revision: 99, commands: [] },
      headers: { cookie: alice.cookie }
    });
    expect([400, 404, 409]).toContain(conflict.statusCode);
  });

  it("rejects invalid invite codes and duplicate emails", async () => {
    const { app } = await testApp();
    const badInvite = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { inviteCode: "WRONG", name: "王五", email: "wang@example.com", password: "secret123" }
    });
    expect(badInvite.statusCode).toBe(400);

    await registerAndLogin(app, "李四", "li@example.com");
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { inviteCode: "TEST-INVITE", name: "李四二", email: "li@example.com", password: "secret123" }
    });
    expect([400, 409]).toContain(duplicate.statusCode);
  });

  it("lists projects ordered by most recent update first", async () => {
    const { app } = await testApp();
    const { cookie } = await registerAndLogin(app, "排序", "sort@example.com");
    const auth = { cookie };
    const a = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" }, headers: auth })).json().project.id as string;
    const b = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" }, headers: auth })).json().project.id as string;
    await app.inject({ method: "POST", url: `/api/projects/${a}/pages`, payload: structuredClone(caseListExample), headers: auth });

    const list = (await app.inject({ method: "GET", url: "/api/projects", headers: auth })).json().projects as Array<{ id: string }>;
    expect(list.map((project) => project.id)).toEqual([a, b]);
  });
});
