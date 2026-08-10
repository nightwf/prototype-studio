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

async function testServer() {
  const root = await mkdtemp(join(tmpdir(), "prototype-share-"));
  temporaryRoots.push(root);
  const metadata = new MemoryMetadataStore();
  const spaces = new ProjectSpaceManager(metadata, join(root, "spaces"));
  const app = await buildApp({ metadata, spaces, inviteCodes: ["SHARE-INVITE"], baseUrl: "http://127.0.0.1:8787" });
  return { app, root };
}

async function login(app: Awaited<ReturnType<typeof testServer>>["app"]) {
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { inviteCode: "SHARE-INVITE", name: "分享用户", email: "share@example.com", password: "secret123" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "share@example.com", password: "secret123" } });
  const apiToken = login.json().apiToken as string;
  const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "分享项目" }, headers: { authorization: `Bearer ${apiToken}` } });
  return { apiToken, projectId: created.json().project.id as string };
}

describe("read-only sharing", () => {
  it("creates, serves and revokes share links with expiration", async () => {
    const { app } = await testServer();
    const { apiToken, projectId } = await login(app);
    const auth = { authorization: `Bearer ${apiToken}` };

    await app.inject({ method: "POST", url: `/api/projects/${projectId}/pages`, payload: structuredClone(caseListExample), headers: auth });
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/board-commands`,
      payload: { base_revision: 1, commands: [{ type: "ADD_BOARD_OBJECT", object: { id: "obj-case-list", type: "page", pageId: "case-list", x: 120, y: 80, width: 960, height: 640 } }] },
      headers: auth
    });
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/boards`, payload: { name: "第二画布", page_ids: ["case-list"] }, headers: auth });
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/board-commands`,
      payload: { base_revision: 2, commands: [{ type: "ADD_BOARD_OBJECT", object: { id: "note-1", type: "note", x: 0, y: 0, width: 200, height: 80, text: "说明" } }] },
      headers: auth
    });

    const share = await app.inject({ method: "POST", url: `/api/projects/${projectId}/share`, payload: {}, headers: auth });
    expect(share.statusCode).toBe(201);
    const token = share.json().token as string;
    expect(share.json().url).toBe(`http://127.0.0.1:8787/share/${token}`);

    const data = await app.inject({ method: "GET", url: `/api/share/${token}` });
    expect(data.statusCode).toBe(200);
    expect(data.json()).toMatchObject({ ok: true, project: { id: projectId }, pages: [{ id: "case-list" }] });
    expect(data.json().boards).toHaveLength(2);
    expect(data.json().boards[0].revision).toBe(3);
    expect(data.json().project.defaultBoardId).toBe("main");

    const html = await app.inject({ method: "GET", url: `/share/${token}` });
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.body).toContain("data-board-object");
    expect(html.body).toContain("案件管理");
    expect(html.body).toContain("data-board-tab");
    expect(html.body).toContain("第二画布");

    const revoked = await app.inject({ method: "DELETE", url: `/api/projects/${projectId}/share/${token}`, headers: auth });
    expect(revoked.statusCode).toBe(200);
    const afterRevoke = await app.inject({ method: "GET", url: `/api/share/${token}` });
    expect(afterRevoke.statusCode).toBe(404);

    const expired = await app.inject({ method: "POST", url: `/api/projects/${projectId}/share`, payload: { expires_in_seconds: -1 }, headers: auth });
    const expiredToken = expired.json().token as string;
    const afterExpiry = await app.inject({ method: "GET", url: `/api/share/${expiredToken}` });
    expect(afterExpiry.statusCode).toBe(404);
  });

  it("exports a zip and restores it into a new project", async () => {
    const { app } = await testServer();
    const { apiToken, projectId } = await login(app);
    const auth = { authorization: `Bearer ${apiToken}` };
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/pages`, payload: structuredClone(caseListExample), headers: auth });

    const zip = await app.inject({ method: "POST", url: `/api/projects/${projectId}/export`, payload: { type: "zip" }, headers: auth });
    expect(zip.statusCode).toBe(200);
    const zipBase64 = zip.json().zip as string;

    const imported = await app.inject({ method: "POST", url: "/api/projects/import", payload: { name: "恢复项目", zip: zipBase64 }, headers: auth });
    expect(imported.statusCode).toBe(201);
    const importedId = imported.json().project.id as string;

    const tree = await app.inject({ method: "GET", url: `/api/projects/${importedId}/tree`, headers: auth });
    expect(tree.statusCode).toBe(200);
    expect(tree.json().manifest.name).toBe("分享项目");
    expect(tree.json().pages.map((page: { id: string }) => page.id)).toContain("case-list");
    expect(tree.json().board).toMatchObject({ revision: 1 });
  });
});
