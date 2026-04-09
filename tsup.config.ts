import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  external: ["playwright-core"],
  clean: true,
  sourcemap: true,
  shims: false,
});
