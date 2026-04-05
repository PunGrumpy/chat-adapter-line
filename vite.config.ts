import { defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  pack: {
    clean: true,
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
    dts: false,
    entry: "src/main.ts",
    external: ["chat"],
    fixedExtension: false,
    format: ["esm"],
    minify: true,
    platform: "node",
    sourcemap: true,
  },
});
