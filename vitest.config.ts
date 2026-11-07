import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Point at source, not dist, so tests never run against a stale build.
    alias: {
      "@supersolutions/super-chat-core": r("./packages/core/src/index.ts"),
      "@supersolutions/super-chat-ui-core": r("./packages/ui-core/src/index.ts"),
      "@supersolutions/super-chat-server": r("./packages/server/src/index.ts"),
      "@supersolutions/super-chat-client": r("./packages/client/src/index.ts"),
      "@supersolutions/super-chat-react": r("./packages/react/src/index.ts"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
