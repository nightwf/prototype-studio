import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { buildApp } from "./index";
import { MemoryMetadataStore } from "./metadata";
import { ProjectSpaceManager } from "./spaces";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function testServer() {
  const root = await mkdtemp(join(tmpdir(), "prototype-mcp-"));
  temporaryRoots.push(root);
  const metadata = new MemoryMetadataStore();
  const spaces = new ProjectSpaceManager(metadata, join(root, "spaces"));
  const app = await buildApp({ metadata, spaces, inviteCodes: ["MCP-INVITE", "MCP-INVITE-2"], baseUrl: "http://127.0.0.1:8787" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address === "string" || address === null) throw new Error("无端口地址");
  const base = `http://127.0.0.1:${address.port}`;
  return { app, base };
}

async function register(app: Awaited<ReturnType<typeof testServer>>["app"], name: string, email: string, inviteCode: string) {
  const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { inviteCode, name, email, password: "secret123" } });
  expect(register.statusCode).toBe(201);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "secret123" } });
  return login.json().apiToken as string;
}

async function mcpClient(base: string, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  });
  const client = new Client({ name: "mcp-e2e", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

const templateYaml = `
title: 案件批量分配
pages:
  - id: case-list
    title: 案件列表页
    type: list
board:
  objects:
    - id: note-1
      type: note
      x: 10
      y: 10
      width: 200
      height: 80
      text: 最多选择 500 条
`;

describe("cloud MCP", () => {
  it("authenticates with a bearer token and exercises multi-project tools", { timeout: 60_000 }, async () => {
    const { app, base } = await testServer();
    const tokenA = await register(app, "Alice", "alice-mcp@example.com", "MCP-INVITE");
    const tokenB = await register(app, "Bob", "bob-mcp@example.com", "MCP-INVITE-2");

    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "MCP 项目" }, headers: { authorization: `Bearer ${tokenA}` } });
    const projectId = created.json().project.id as string;

    const { client } = await mcpClient(base, tokenA);
    try {
      const listed = await client.callTool({ name: "prototype_list_projects", arguments: {} });
      expect(listed.structuredContent).toMatchObject({ ok: true, data: { projects: [{ id: projectId }] } });

      const page = await client.callTool({
        name: "prototype_create_page",
        arguments: { project_id: projectId, dsl: structuredClone(caseListExample) }
      });
      expect(page.structuredContent).toMatchObject({ ok: true, data: { page_id: "case-list" } });

      const commands = await client.callTool({
        name: "prototype_apply_commands",
        arguments: {
          project_id: projectId,
          page_id: "case-list",
          base_revision: 1,
          commands: [{ type: "UPDATE_COMPONENT", target: "search.status", changes: { label: "状态" } }]
        }
      });
      expect(commands.structuredContent).toMatchObject({ ok: true, data: { revision: 2 } });

      const boardCommands = await client.callTool({
        name: "prototype_apply_board_commands",
        arguments: {
          project_id: projectId,
          base_revision: 1,
          commands: [{ type: "ADD_BOARD_OBJECT", object: { id: "note-1", type: "note", x: 0, y: 0, width: 200, height: 80, text: "说明" } }]
        }
      });
      expect(boardCommands.structuredContent).toMatchObject({ ok: true, data: { revision: 2, changed_object_ids: ["note-1"] } });

      const board = await client.callTool({ name: "prototype_get_board", arguments: { project_id: projectId } });
      expect(board.structuredContent).toMatchObject({ ok: true, data: { board: { revision: 2 } } });

      const preview = await client.callTool({ name: "prototype_get_preview_url", arguments: { project_id: projectId, page_id: "case-list" } });
      expect(preview.structuredContent).toMatchObject({ ok: true, data: { preview_url: `http://127.0.0.1:8787/?project=${projectId}&page=case-list` } });

      const fromRequirement = await client.callTool({
        name: "prototype_create_project_from_requirement",
        arguments: { name: "从需求创建", requirement: templateYaml }
      });
      expect(fromRequirement.structuredContent).toMatchObject({ ok: true, data: { pages: ["case-list"] } });
      const newProjectId = (fromRequirement.structuredContent as { data: { project_id: string } }).data.project_id;
      expect(newProjectId).not.toBe(projectId);

    } finally {
      await client.close();
    }

    const forbiddenClient = await mcpClient(base, tokenB);
    try {
      const result = await forbiddenClient.client.callTool({ name: "prototype_get_project", arguments: { project_id: projectId } });
      expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    } finally {
      await forbiddenClient.client.close();
    }
  });

  it("rejects requests without a valid token", { timeout: 60_000 }, async () => {
    const { app, base } = await testServer();
    const tokenA = await register(app, "Carol", "carol-mcp@example.com", "MCP-INVITE");
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "P" }, headers: { authorization: `Bearer ${tokenA}` } });
    const projectId = created.json().project.id as string;

    const { client } = await mcpClient(base, "invalid-token");
    try {
      const result = await client.callTool({ name: "prototype_get_project", arguments: { project_id: projectId } });
      expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    } finally {
      await client.close();
    }
  });
});
