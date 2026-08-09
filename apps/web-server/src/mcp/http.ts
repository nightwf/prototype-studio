import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const sessions = new Map<string, { transport: StreamableHTTPServerTransport }>();

export interface CloudMcpHttpOptions {
  createServer: (token: string) => McpServer;
  parsedBody?: unknown;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function handleCloudMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CloudMcpHttpOptions
): Promise<void> {
  const url = new URL(request.url ?? "/mcp", "http://localhost");
  if (url.pathname !== "/mcp") {
    json(response, 404, { jsonrpc: "2.0", error: { code: -32001, message: "Not Found" }, id: null });
    return;
  }
  const sessionId = typeof request.headers["mcp-session-id"] === "string"
    ? request.headers["mcp-session-id"]
    : undefined;
  const token = typeof request.headers.authorization === "string"
    ? request.headers.authorization.replace(/^Bearer\s+/i, "")
    : "";
  try {
    if (request.method === "POST") {
      const parsedBody = options.parsedBody ?? (await readBody(request).then((raw) => (raw ? JSON.parse(raw) : undefined)));
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
        const server = options.createServer(token);
        await server.connect(transport);
        await transport.handleRequest(request, response, parsedBody);
        if (transport.sessionId) sessions.set(transport.sessionId, { transport });
        return;
      }
      await session.transport.handleRequest(request, response, parsedBody);
      return;
    }
    if (request.method === "DELETE") {
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (session) {
          await session.transport.close();
          sessions.delete(sessionId);
        }
      }
      response.writeHead(200).end();
      return;
    }
    if (request.method === "GET") {
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (session) {
        await session.transport.handleRequest(request, response, request.headers as IncomingHttpHeaders);
        return;
      }
      json(response, 400, { jsonrpc: "2.0", error: { code: -32000, message: "Unknown session" }, id: null });
      return;
    }
    response.writeHead(405).end();
  } catch (error) {
    json(response, 500, {
      jsonrpc: "2.0",
      error: { code: -32603, message: error instanceof Error ? error.message : "未知错误" },
      id: null
    });
  }
}
