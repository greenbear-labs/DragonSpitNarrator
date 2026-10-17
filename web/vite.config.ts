import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { configFromEnv, createRelay, pathOf } from "../api/_lib/relay";
import { storeFromEnv } from "../api/_lib/store";

// Runs the same relay Vercel runs, so `npm run dev` serves /api too. It reads ENGINE_URL and ENGINE_TOKEN
// from web/.env.local or the shell, and defaults to the engine on this computer.
function relayPlugin(): Plugin {
  return {
    name: "narrator-relay",
    configureServer(server) {
      const env: Record<string, string | undefined> = { ...loadEnv("development", process.cwd(), ""), ...process.env, NODE_ENV: "development" };
      env.ENGINE_URL ||= "http://127.0.0.1:8765";
      const handle = createRelay(configFromEnv(env), storeFromEnv(env));
      server.middlewares.use("/api", async (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === "string") headers.set(name, value);
          else if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
        }
        const request = new Request(`http://localhost/api${req.url}`, {
          method: req.method,
          headers,
          body: chunks.length && req.method !== "GET" ? Buffer.concat(chunks) : undefined,
        });
        const response = await handle(request, pathOf(request));
        res.statusCode = response.status;
        response.headers.forEach((value, name) => {
          if (name !== "set-cookie") res.setHeader(name, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader("Set-Cookie", cookies);
        if (response.body) Readable.fromWeb(response.body as never).pipe(res);
        else res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), relayPlugin()],
});
