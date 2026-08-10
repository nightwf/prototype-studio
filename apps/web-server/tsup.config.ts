import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["cjs"],
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: [/@prototype-studio\/.*/],
  external: ["archiver"],
  splitting: false,
  sourcemap: false,
  clean: true
});
