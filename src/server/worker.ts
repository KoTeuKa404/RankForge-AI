import app from "./index";
import { getAiProviderStatus } from "./ai";
import type { Env } from "./env";

const HEALTH_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      const provider = getAiProviderStatus(env);
      return new Response(JSON.stringify({
        ok: true,
        version: "0.6.0",
        database: Boolean(env.DB),
        ai: provider.enabled,
        aiProvider: provider.preferred,
        aiMode: provider.mode,
        aiProviders: provider.available,
      }), { headers: HEALTH_HEADERS });
    }
    return app.fetch(request, env);
  },
};
