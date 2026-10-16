import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PageDSL } from "@prototype-studio/dsl-schema";
import { buildApp } from "./index";
import { MemoryMetadataStore } from "./metadata";
import { ProjectSpaceManager } from "./spaces";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function testApp(inviteCode = "IMAGE-INVITE") {
  const root = await mkdtemp(join(tmpdir(), "prototype-wf-image-"));
  temporaryRoots.push(root);
  const metadata = new MemoryMetadataStore();
  const spaces = new ProjectSpaceManager(metadata, join(root, "spaces"));
  const app = await buildApp({ metadata, spaces, inviteCodes: [inviteCode, "IMAGE-INVITE-2"] });
  return { app };
}

async function registerAndLogin(app: Awaited<ReturnType<typeof testApp>>["app"], email: string, inviteCode = "IMAGE-INVITE") {
  const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { inviteCode, name: "图片测试", email, password: "secret123" } });
  expect(register.statusCode).toBe(201);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "secret123" } });
  expect(login.statusCode).toBe(200);
  const cookieHeader = login.headers["set-cookie"];
  return { cookie: typeof cookieHeader === "string" ? cookieHeader.split(";")[0]! : "" };
}

function wireframeImagePage(id: string, src: string): PageDSL {
  return {
    dslVersion: "1.0",
    rendererVersion: "1.0.0",
    designSystemVersion: "1.0.0",
    revision: 1,
    page: { id, type: "wireframe", title: "带图线框页", status: "Draft" },
    layout: { type: "standard", density: "normal" },
    overlays: [],
    rules: [],
    events: [],
    wireframe: {
      width: 1440,
      height: 900,
      background: "#ffffff",
      elements: [{ id: "wf-image", type: "image", x: 40, y: 40, width: 600, height: 400, src, text: "screenshot.png" }]
    }
  };
}

describe("线框页内嵌图片", () => {
  it("接受 1MB 以上的 base64 图片并原样读回", async () => {
    const { app } = await testApp();
    const auth = await registerAndLogin(app, "wf-image@example.com");
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "图片项目" }, headers: auth });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    // 尺寸通过编辑器压缩后仍在 1MB 以上，默认 1MB 的请求体上限会让这类保存静默失败。
    const src = `data:image/png;base64,${Buffer.alloc(2_200_000, "A").toString("base64").slice(0, 2_200_000)}`;
    const page = wireframeImagePage("wf-big-image", src);
    const written = await app.inject({ method: "POST", url: `/api/projects/${projectId}/pages`, payload: page, headers: auth });
    expect(written.statusCode).toBe(201);

    const read = await app.inject({ method: "GET", url: `/api/projects/${projectId}/pages/wf-big-image`, headers: auth });
    expect(read.statusCode).toBe(200);
    const element = read.json().dsl.wireframe.elements[0] as { src: string };
    expect(element.src).toBe(src);
  });

  it("允许用 SET_WIREFRAME 给已有线框页补图片", async () => {
    const { app } = await testApp();
    const auth = await registerAndLogin(app, "wf-image2@example.com");
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "图片项目 2" }, headers: auth });
    const projectId = created.json().project.id as string;

    const empty = wireframeImagePage("wf-command-image", "");
    empty.wireframe!.elements = [{ id: "wf-image", type: "image", x: 40, y: 40, width: 600, height: 400 }];
    expect((await app.inject({ method: "POST", url: `/api/projects/${projectId}/pages`, payload: empty, headers: auth })).statusCode).toBe(201);

    const src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
    const applied = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/commands`,
      payload: {
        page_id: "wf-command-image",
        base_revision: 1,
        source: "manual",
        commands: [{ type: "SET_WIREFRAME", wireframe: { width: 1440, height: 900, background: "#ffffff", elements: [{ id: "wf-image", type: "image", x: 40, y: 40, width: 600, height: 400, src }] } }]
      },
      headers: auth
    });
    expect(applied.statusCode).toBe(200);

    const read = await app.inject({ method: "GET", url: `/api/projects/${projectId}/pages/wf-command-image`, headers: auth });
    expect((read.json().dsl.wireframe.elements[0] as { src: string }).src).toBe(src);
    expect(read.json().dsl.revision).toBe(2);
  });
});
