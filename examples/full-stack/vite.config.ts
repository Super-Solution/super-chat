import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { createLocalRouter } from "./server/router";

const PREFIX = "/api/router";

function localRouter(): Plugin {
  return {
    name: "local-super-router",
    async configureServer(server) {
      const forward = await createLocalRouter();
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(PREFIX + "/")) return next();
        forward(req, res, req.url.slice(PREFIX.length)).catch(next);
      });
    },
  };
}

export default defineConfig({ plugins: [react(), localRouter()] });
