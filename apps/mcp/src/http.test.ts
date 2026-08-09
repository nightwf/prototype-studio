import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPrototypeStudioServer } from "./server.js";
import { handleMcpHttpRequest } from "./http.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("MCP HTTP skeleton", () => {
  it("connects a real HTTP MCP client and discovers tools", async () => {
    const server = createServer((request, response) => {
      void handleMcpHttpRequest(request, response, {
        createServer: () => createPrototypeStudioServer({ projectRoot: process.cwd() })
      });
    }).listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("无端口地址");

    const client = new Client({ name: "http-skeleton-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.map((tool) => tool.name)).toContain("prototype_get_project");
    await client.close();
  });
});
