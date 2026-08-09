import { defineConfig } from "tsup";

export default defineConfig({
  entry: { sidecar: "src/sidecar.ts" },
  format: ["cjs"],
  outDir: "dist-sidecar",
  target: "node20",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  clean: true,
  noExternal: [/.*/]
});
