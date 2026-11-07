import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Point at source, not dist, so tests never run against a stale build.
    alias: {
      "@super-solution/super-chat-core": r("./packages/core/src/index.ts"),
      "@super-solution/super-chat-react": r("./packages/react/src/index.ts"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
