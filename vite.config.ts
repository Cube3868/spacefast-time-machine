import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handle } from "./functions/_app.ts";

export default defineConfig({
  server: { watch: { ignored: ["**/.local/**", "**/artifacts/**"] } },
  plugins: [
    react(),
    {
      name: "spacefast-local-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/") && !req.url?.startsWith("/oauth/"))
            return next();
          // Preview has no production DB or account credentials. It fails closed.
          try {
            const origin = "http://127.0.0.1:5173";
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
            const headers = new Headers();
            for (const [key, val] of Object.entries(req.headers))
              if (val)
                headers.set(key, Array.isArray(val) ? val.join(", ") : val);
            const response = await handle(
              new Request(origin + req.url, {
                method: req.method,
                headers,
                ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
              }),
              {},
            );
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(await response.text());
          } catch {
            res.statusCode = 500;
            res.end('{"error":"Local API failed."}');
          }
        });
      },
    },
  ],
});
