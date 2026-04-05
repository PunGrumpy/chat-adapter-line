import { defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  pack: {
    clean: true,
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
    deps: {
      neverBundle: ["@chat-adapter/shared", "@line/bot-sdk", "chat"],
    },
    dts: false,
    entry: "src/index.ts",
    fixedExtension: false,
    format: ["esm"],
    minify: true,
    platform: "node",
    sourcemap: true,
  },
  staged: {
    "*.{js,ts,tsx}": "bun run format",
  },
  test: {
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
    include: ["__tests__/**/*.test.ts"],
  },
});
