import { createFileRoute } from "@tanstack/react-router";

const UPSTREAM = "https://bot-production-4200.up.railway.app";

/** Same-origin proxy for the buybot / Arc Insider API: https://arctools.fun/bot/api/... → Railway.
 *  Browsers that cannot reach *.railway.app (DNS filters, ad-blockers, regional edge trouble) still get every
 *  panel filled; no CORS preflights; Cloudflare edge in front. */
async function proxy(request: Request, splat: string): Promise<Response> {
  const url = new URL(request.url);
  const target = `${UPSTREAM}/${splat}${url.search}`;
  const headers = new Headers();
  for (const h of ["content-type", "accept", "x-heartbeat-auth", "x-ref-auth", "x-priority"]) { const v = request.headers.get(h); if (v) headers.set(h, v); }
  headers.set("user-agent", "arctools-site-proxy/1.0");
  try {
    const r = await fetch(target, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(), signal: AbortSignal.timeout(25_000) });
    const out = new Headers();
    out.set("content-type", r.headers.get("content-type") ?? "application/json");
    out.set("cache-control", r.headers.get("cache-control") ?? "no-store");
    out.set("x-arc-proxy", "1");
    return new Response(r.body, { status: r.status, headers: out });
  } catch (e) {
    return new Response(JSON.stringify({ error: "upstream unreachable", detail: String(e).slice(0, 120) }), { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
}

export const Route = createFileRoute("/bot/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxy(request, (params as { _splat?: string })._splat ?? ""),
      POST: ({ request, params }) => proxy(request, (params as { _splat?: string })._splat ?? ""),
    },
  },
});
