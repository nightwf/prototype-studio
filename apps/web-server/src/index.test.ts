import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createRequestHandler } from "./index";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("web server skeleton", () => {
  it("answers the health endpoint", async () => {
    const server = createServer(createRequestHandler()).listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("无端口地址");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: "prototype-studio-web-server" });
  });

  it("returns 404 for unknown routes", async () => {
    const server = createServer(createRequestHandler()).listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("无端口地址");
    const response = await fetch(`http://127.0.0.1:${address.port}/nope`);
    expect(response.status).toBe(404);
  });
});
