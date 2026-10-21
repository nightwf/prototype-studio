import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import type { BoardDSL, PageDSL } from "@prototype-studio/dsl-schema";
import { buildApp } from "./index";
import { MemoryMetadataStore } from "./metadata";
import { ProjectSpaceManager } from "./spaces";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "prototype-share-bundle-"));
  temporaryRoots.push(root);
  const metadata = new MemoryMetadataStore();
  const spaces = new ProjectSpaceManager(metadata, join(root, "spaces"));
  const app = await buildApp({ metadata, spaces, inviteCodes: ["BUNDLE-INVITE"], baseUrl: "http://127.0.0.1:8787", staticRoot: join(root, "no-static") });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { inviteCode: "BUNDLE-INVITE", name: "发布用户", email: "bundle@example.com", password: "secret123" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "bundle@example.com", password: "secret123" } });
  const auth = { authorization: `Bearer ${login.json().apiToken as string}` };
  const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "发布项目" }, headers: auth });
  const projectId = created.json().project.id as string;
  await app.inject({ method: "POST", url: `/api/projects/${projectId}/pages`, payload: structuredClone(caseListExample), headers: auth });
  await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/board-commands`,
    payload: { base_revision: 1, commands: [{ type: "ADD_BOARD_OBJECT", object: { id: "obj-case-list", type: "page", pageId: "case-list", x: 120, y: 80, width: 960, height: 640 } }] },
    headers: auth
  });
  const tree = await app.inject({ method: "GET", url: `/api/projects/${projectId}/tree`, headers: auth });
  const board = tree.json().board as BoardDSL;
  const page = (await app.inject({ method: "GET", url: `/api/projects/${projectId}/pages/case-list`, headers: auth })).json().dsl as PageDSL;
  return { app, auth, projectId, board, page };
}

describe("分享包快照", () => {
  it("发布后分享链接读取快照，项目再修改不影响已发布内容", async () => {
    const { app, auth, projectId, board, page } = await setup();

    const published = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/share/bundle`,
      payload: { boards: [board], pages: [page] },
      headers: auth
    });
    expect(published.statusCode).toBe(201);
    const token = published.json().token as string;
    expect(published.json().url).toBe(`http://127.0.0.1:8787/share/${token}`);

    // 发布之后继续改项目：页面 revision 前进到 2
    const changed = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/commands`,
      payload: { page_id: "case-list", base_revision: page.revision, commands: [{ type: "UPDATE_COMPONENT", target: "search.status", changes: { label: "状态（新）" } }] },
      headers: auth
    });
    expect(changed.statusCode).toBe(200);

    const snapshot = await app.inject({ method: "GET", url: `/api/share/${token}/pages/case-list` });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().dsl.revision).toBe(page.revision);
    const sharedLabel = (snapshot.json().dsl as PageDSL).search?.fields.find((field) => field.id === "search.status")?.label;
    expect(sharedLabel).toBe("案件状态");
  });

  it("重新发布沿用同一个链接并更新内容", async () => {
    const { app, auth, projectId, board, page } = await setup();
    const first = await app.inject({ method: "POST", url: `/api/projects/${projectId}/share/bundle`, payload: { boards: [board], pages: [page] }, headers: auth });
    const token = first.json().token as string;

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/commands`,
      payload: { page_id: "case-list", base_revision: page.revision, commands: [{ type: "UPDATE_COMPONENT", target: "search.status", changes: { label: "状态（新）" } }] },
      headers: auth
    });
    const latestPage = (await app.inject({ method: "GET", url: `/api/projects/${projectId}/pages/case-list`, headers: auth })).json().dsl as PageDSL;
    const second = await app.inject({ method: "POST", url: `/api/projects/${projectId}/share/bundle`, payload: { boards: [board], pages: [latestPage] }, headers: auth });
    expect(second.statusCode).toBe(201);
    expect(second.json().token).toBe(token);
    expect(second.json().sourceDigest).not.toBe(first.json().sourceDigest);

    const snapshot = await app.inject({ method: "GET", url: `/api/share/${token}/pages/case-list` });
    expect(snapshot.json().dsl.revision).toBe(latestPage.revision);
    const labels = (await app.inject({ method: "GET", url: `/api/projects/${projectId}/share`, headers: auth })).json().links[0];
    expect(labels.sourceDigest).toBe(second.json().sourceDigest);
  });

  it("画布引用缺失页面时拒绝发布并给出明细", async () => {
    const { app, auth, projectId, board, page } = await setup();
    const brokenBoard: BoardDSL = structuredClone(board);
    brokenBoard.objects.push({ id: "obj-missing", type: "page", pageId: "missing-page", x: 0, y: 0, width: 400, height: 300, source: "explicit" });
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/share/bundle`, payload: { boards: [brokenBoard], pages: [page] }, headers: auth });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).toContain("missing-page");
  });

  it("关闭发布会移除分享包，链接随即失效", async () => {
    const { app, auth, projectId, board, page } = await setup();
    const first = await app.inject({ method: "POST", url: `/api/projects/${projectId}/share/bundle`, payload: { boards: [board], pages: [page] }, headers: auth });
    const token = first.json().token as string;
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}/share/${token}`, headers: auth });
    const after = await app.inject({ method: "GET", url: `/api/share/${token}` });
    expect(after.statusCode).toBe(404);
  });
});
