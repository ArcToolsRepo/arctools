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
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  // Railway's edge answers a plain-text "error code: 502" for ~30-60 s while a deploy swaps containers (and on the odd
  // hiccup). Retry GETs up to 3x with a short backoff; never hand a text/plain 5xx to the browser — the panels expect JSON.
  let last: Response | null = null; let err = "";
  const attempts = body === undefined ? 3 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(target, { method: request.method, headers, body, signal: AbortSignal.timeout(25_000) });
      if (r.status < 500 || i === attempts - 1) { last = r; break; }
      last = r;
    } catch (e) { err = String(e).slice(0, 120); }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  if (last && last.status < 500) {
    const out = new Headers();
    out.set("content-type", last.headers.get("content-type") ?? "application/json");
    out.set("cache-control", last.headers.get("cache-control") ?? "no-store");
    out.set("x-arc-proxy", "1");
    return new Response(last.body, { status: last.status, headers: out });
  }
  const detail = last ? `upstream ${last.status}` : `upstream unreachable: ${err}`;
  return new Response(JSON.stringify({ error: "upstream unavailable", detail, retry_after_s: 5 }), {
    status: 503, headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": "5", "x-arc-proxy": "1" },
  });
}

export const Route = createFileRoute("/bot/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxy(request, (params as { _splat?: string })._splat ?? ""),
      POST: ({ request, params }) => proxy(request, (params as { _splat?: string })._splat ?? ""),
    },
  },
});
