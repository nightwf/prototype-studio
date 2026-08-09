#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPrototypeStudioServer } from "./server.js";
import { resolveProjectRoot } from "./service.js";

export { createPrototypeStudioServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
export { PrototypeService, resolveProjectRoot } from "./service.js";

export async function runStdioServer(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const projectRoot = resolveProjectRoot(environment.PROTOTYPE_STUDIO_PROJECT_ROOT);
  const server = createPrototypeStudioServer({
    projectRoot,
    ...(environment.PROTOTYPE_STUDIO_PREVIEW_URL
      ? { previewBaseUrl: environment.PROTOTYPE_STUDIO_PREVIEW_URL }
      : {})
  });
  await server.connect(new StdioServerTransport());
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  runStdioServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "未知启动错误";
    console.error(`prototype-studio-mcp-server 启动失败：${message}`);
    process.exitCode = 1;
  });
}
