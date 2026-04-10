import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  external: ["playwright-core"],
  clean: true,
  sourcemap: true,
  shims: false,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
