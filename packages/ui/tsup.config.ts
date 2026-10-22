import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "mobile-agent": "src/mobile-agent.ts",
    "mobile-agent-react-native": "src/mobile-agent-rn.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["react", "@super-solution/super-chat-core", "@super-solution/super-chat-react"],
  loader: { ".css": "copy" },
});
