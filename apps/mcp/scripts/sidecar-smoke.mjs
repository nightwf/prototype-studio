import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const executable = process.env.PROTOTYPE_SIDECAR_EXECUTABLE ?? path.join(root, "apps/desktop/src-tauri/bin/prototype-mcp");
const transport = new StdioClientTransport({
  command: executable,
  env: {
    ...process.env,
    PROTOTYPE_STUDIO_PROJECT_ROOT: path.join(root, "examples/case-management"),
    PROTOTYPE_STUDIO_PREVIEW_URL: "http://127.0.0.1:4173"
  },
  stderr: "pipe"
});
const client = new Client({ name: "prototype-sidecar-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length !== 19) throw new Error(`Expected 19 tools, received ${listed.tools.length}`);
  const project = await client.callTool({ name: "prototype_get_project", arguments: {} });
  if (project.isError || project.structuredContent?.ok !== true) throw new Error(`prototype_get_project failed: ${JSON.stringify(project)}`);
  const requirement = await client.callTool({ name: "prototype_get_requirement", arguments: { requirement_id: "REQ-001" } });
  if (requirement.isError || requirement.structuredContent?.ok !== true) throw new Error("prototype_get_requirement failed");
  const board = await client.callTool({ name: "prototype_get_board", arguments: {} });
  if (board.isError || board.structuredContent?.ok !== true) throw new Error("prototype_get_board failed");
  process.stdout.write(`MCP_SIDECAR_OK tools=${listed.tools.length} project=case-center-demo requirement=REQ-001 board=ok\n`);
} finally {
  await client.close();
}
