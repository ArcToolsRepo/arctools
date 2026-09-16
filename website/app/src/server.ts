import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { setMemoRuntime, setRelayKey } from "./lib/memo-kv";
import { applySecurityHeaders } from "./lib/security-headers.server";
import { selfHeal, setSelfFetch, type HealEnv } from "./lib/self-heal";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  // cron (wrangler.jsonc triggers.crons, every 20 min): probe + repair the stack, warm caches
  async scheduled(_event: unknown, env: unknown, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    const e = env as HealEnv;
    setMemoRuntime(e.KV as never, ctx.waitUntil.bind(ctx));
    const handler = await getServerEntry();
    setSelfFetch((req) => Promise.resolve(handler.fetch(req, env, ctx)));
    ctx.waitUntil(selfHeal(e).then((r) => console.log("self-heal", JSON.stringify({ ok: r.ok, actions: r.actions, bad: r.checks.filter((c) => !c.ok).map((c) => c.name) }))).catch((err) => console.error("self-heal failed", err)));
  },
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const e = env as { KV?: import("./lib/memo-kv").KVLike } | undefined;
      const c = ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
      setMemoRuntime(e?.KV, c?.waitUntil ? c.waitUntil.bind(c) : undefined); setRelayKey((env as { RELAY_KEY?: string }).RELAY_KEY);
      const handler = await getServerEntry();
      setSelfFetch((req) => Promise.resolve(handler.fetch(req, env, ctx)));
      const response = await handler.fetch(request, env, ctx);
      return applySecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return applySecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
