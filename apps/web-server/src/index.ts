import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface WebServerOptions {
  port?: number;
}

export function jsonResponse(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/** Phase 0 骨架：健康检查路由。项目空间 API 在 Phase 1 扩展。 */
export function createRequestHandler() {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") {
      jsonResponse(response, 200, { ok: true, service: "prototype-studio-web-server" });
      return;
    }
    jsonResponse(response, 404, { ok: false, error: "NOT_FOUND" });
  };
}

export function startWebServer(options: WebServerOptions = {}): Server {
  return createServer(createRequestHandler()).listen(options.port ?? 0);
}
