import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "uri-guard",
      configureServer(server: ViteDevServer) {
        server.middlewares.use((req, res, next) => {
          try {
            if (req.url) {
              decodeURI(req.url);
            }
          } catch {
            res.statusCode = 400;
            res.end("Bad Request");
            return;
          }
          next();
        });
      },
    } as Plugin,
  ],
  base: "./",
});
