import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import unzipper from "unzipper";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./index";
import { MemoryMetadataStore } from "./metadata";
import { ProjectSpaceManager } from "./spaces";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "prototype-export-local-"));
  temporaryRoots.push(root);
  const metadata = new MemoryMetadataStore();
  const spaces = new ProjectSpaceManager(metadata, join(root, "spaces"));
  const app = await buildApp({ metadata, spaces, inviteCodes: ["EXPORT-INVITE"], baseUrl: "http://127.0.0.1:8787", staticRoot: join(root, "no-static") });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { inviteCode: "EXPORT-INVITE", name: "导出用户", email: "export@example.com", password: "secret123" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "export@example.com", password: "secret123" } });
  const auth = { authorization: `Bearer ${login.json().apiToken as string}` };
  const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "导出项目" }, headers: auth });
  return { app, auth, projectId: created.json().project.id as string };
}

describe("整包导出", () => {
  it("把浏览器侧的本地页面一起打包进 ZIP", async () => {
    const { app, auth, projectId } = await setup();
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export`,
      payload: {
        type: "zip",
        extra_files: [{ name: "pages/local-repayment.ui.yaml", content: "page:\n  id: local-repayment\n  type: wireframe\n" }]
      },
      headers: auth
    });
    expect(response.statusCode).toBe(200);
    const archive = await unzipper.Open.buffer(Buffer.from(response.json().zip as string, "base64"));
    expect(archive.files.map((file: { path: string }) => file.path)).toContain("pages/local-repayment.ui.yaml");
    const entry = archive.files.find((file: { path: string }) => file.path === "pages/local-repayment.ui.yaml") as unknown as { buffer(): Promise<Buffer> };
    expect((await entry.buffer()).toString("utf8")).toContain("local-repayment");
  });

  it("拒绝把额外文件写到 pages/ 之外", async () => {
    const { app, auth, projectId } = await setup();
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export`,
      payload: {
        type: "zip",
        extra_files: [
          { name: "../evil.txt", content: "x" },
          { name: "boards/hack.board.yaml", content: "x" },
          { name: "pages/ok.ui.yaml", content: "ok" }
        ]
      },
      headers: auth
    });
    const archive = await unzipper.Open.buffer(Buffer.from(response.json().zip as string, "base64"));
    const paths = archive.files.map((file: { path: string }) => file.path);
    expect(paths).toContain("pages/ok.ui.yaml");
    expect(paths.some((path: string) => path.includes("evil") || path.includes("hack"))).toBe(false);
  });
});
