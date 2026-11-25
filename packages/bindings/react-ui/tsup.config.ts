import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cards: "src/entry-cards.ts",
    agent: "src/entry-agent.ts",
    surfaces: "src/entry-surfaces.ts",
    labels: "src/entry-labels.ts",
    "mobile-agent": "src/mobile-agent.ts",
    "mobile-agent-react-native": "src/mobile-agent-rn.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["react", "@supersolutions/super-chat-core", "@supersolutions/super-chat-react", "@supersolutions/super-chat-client", "@supersolutions/super-chat-ui-core"],
  loader: { ".css": "copy" },
});
