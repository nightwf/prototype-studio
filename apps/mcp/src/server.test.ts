import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { caseListExample } from "@prototype-studio/dsl-schema/example";
import { createPage, createProject } from "@prototype-studio/project-store";
import { createPrototypeStudioServer, SERVER_NAME } from "./server.js";

describe("createPrototypeStudioServer", () => {
  it("registers the complete prefixed tool set with modern MCP metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "prototype-studio-mcp-server-test-"));
    await createProject(root, { name: "MCP Server 测试" });
    await createPage(root, structuredClone(caseListExample));
    const server = createPrototypeStudioServer({ projectRoot: root });
    const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        "prototype_apply_board_commands",
        "prototype_apply_commands",
        "prototype_create_board",
        "prototype_create_boards",
        "prototype_create_overlay",
        "prototype_create_page",
        "prototype_delete_board",
        "prototype_delete_component",
        "prototype_delete_page",
        "prototype_get_board",
        "prototype_get_component",
        "prototype_get_dsl",
        "prototype_get_page",
        "prototype_get_preview_url",
        "prototype_get_project",
        "prototype_list_boards",
        "prototype_list_pages",
        "prototype_move_component",
        "prototype_render_preview",
        "prototype_update_board",
        "prototype_update_component",
        "prototype_update_overlay",
        "prototype_validate_dsl"
      ]);
      for (const tool of listed.tools) {
        expect(tool.name.startsWith("prototype_")).toBe(true);
        expect(tool.title).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.annotations).toMatchObject({ openWorldHint: false });
      }

      const result = await client.callTool({ name: "prototype_get_project", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text" })]));
      expect(result.structuredContent).toMatchObject({ ok: true });
      expect(SERVER_NAME).toBe("prototype-studio-mcp-server");

      const board = await client.callTool({ name: "prototype_get_board", arguments: { board_id: "main" } });
      expect(board.structuredContent).toMatchObject({ ok: true, data: { object_count: 0, revision: 1 } });

      const write = await client.callTool({
        name: "prototype_apply_board_commands",
        arguments: {
          board_id: "main",
          base_revision: 1,
          commands: [
            { type: "ADD_BOARD_OBJECT", object: { id: "note-1", type: "note", x: 0, y: 0, width: 200, height: 80, text: "MCP 说明" } }
          ]
        }
      });
      expect(write.structuredContent).toMatchObject({ ok: true, data: { revision: 2, changed_object_ids: ["note-1"] } });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
