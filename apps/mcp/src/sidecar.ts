#!/usr/bin/env node
import { runStdioServer } from "./index.js";

runStdioServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "未知启动错误";
  console.error(`prototype-studio-mcp-server 启动失败：${message}`);
  process.exitCode = 1;
});
