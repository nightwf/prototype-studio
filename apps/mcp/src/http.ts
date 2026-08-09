import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Phase 0 骨架：Streamable HTTP 传输接线（GET 初始化 / POST 消息 / DELETE 结束会话）。
 * Phase 3 将在此基础上接入多项目服务（project_id 解析、Token 鉴权、list_projects / create_project）。
 */
const transports = new Map<string, StreamableHTTPServerTransport>();

export interface HttpMcpRoutesOptions {
  createServer: () => McpServer;
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export async function handleMcpHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpMcpRoutesOptions
): Promise<void> {
  const url = new URL(request.url ?? "/mcp", "http://localhost");
  if (url.pathname !== "/mcp") {
    json(response, 404, { jsonrpc: "2.0", error: { code: -32001, message: "Not Found" }, id: null });
    return;
  }
  const sessionId = typeof request.headers["mcp-session-id"] === "string"
    ? request.headers["mcp-session-id"]
    : undefined;
  try {
    if (request.method === "GET") {
      const existing = sessionId ? transports.get(sessionId) : undefined;
      if (existing) {
        await existing.handleRequest(request, response, request.headers as IncomingHttpHeaders);
        return;
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      const server = options.createServer();
      await server.connect(transport);
      await transport.handleRequest(request, response, request.headers as IncomingHttpHeaders);
      if (transport.sessionId) transports.set(transport.sessionId, transport);
      return;
    }
    if (request.method === "POST") {
      let transport = sessionId ? transports.get(sessionId) : undefined;
      const raw = await readBody(request);
      const parsedBody = raw ? JSON.parse(raw) : undefined;
      if (!transport) {
        // 首次请求（initialize）：创建会话并把 server 接入该传输。
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
        const server = options.createServer();
        await server.connect(transport);
        await transport.handleRequest(request, response, parsedBody);
        if (transport.sessionId) transports.set(transport.sessionId, transport);
        return;
      }
      await transport.handleRequest(request, response, parsedBody);
      return;
    }
    if (request.method === "DELETE") {
      if (sessionId) {
        const transport = transports.get(sessionId);
        if (transport) {
          await transport.close();
          transports.delete(sessionId);
        }
      }
      response.writeHead(200).end();
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
