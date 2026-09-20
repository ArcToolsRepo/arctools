import { createFileRoute } from "@tanstack/react-router";

const UPSTREAM = "https://bot-production-4200.up.railway.app";

/** Same-origin proxy for the buybot / Arc Insider API: https://arctools.fun/bot/api/... → Railway.
 *  Browsers that cannot reach *.railway.app (DNS filters, ad-blockers, regional edge trouble) still get every
 *  panel filled; no CORS preflights; Cloudflare edge in front. */
// Public, identical-for-everyone reads. Measured: every one of these cost each visitor a 0.35-0.5 s round
// trip to Railway (Cloudflare edge -> Railway -> Postgres), and the Terminal fires eight of them before the
// table has numbers. GMGN / DexScreener feel instant because the hot lists come from the edge, not from the
// database. Cache these at the edge for a few seconds: the bot's own memory cache is already 15-30 s, so a
// 10 s edge TTL loses nothing and turns 0.45 s into ~0.05 s for everybody after the first visitor.
const EDGE_TTL: Array<[RegExp, number]> = [
  [/^api\/trending\b/, 10],
  [/^api\/chain-status\b/, 5],
  [/^api\/pads\b/, 60],
  [/^api\/alpha\b/, 15],
  [/^api\/insiders\b/, 15],
  [/^api\/sim-flags\b/, 30],
  [/^api\/feed\b/, 15],
  [/^api\/arct-burn\b/, 30],
  [/^api\/buyback-stats\b/, 30],
  [/^api\/token-meta\b/, 60],
  [/^api\/token-stats\b/, 10],
  [/^api\/trades\b/, 5],
  [/^api\/holder-risk\b/, 20],
  [/^api\/bubbles\b/, 60],
  [/^api\/ohlc\b/, 10],
];

function edgeTtl(splat: string, search: string): number {
  if (/(^|[?&])key=/.test(search)) return 0;                       // never cache anything keyed
  for (const [re, ttl] of EDGE_TTL) if (re.test(splat)) return ttl;
  return 0;
}

async function proxy(request: Request, splat: string): Promise<Response> {
  const url = new URL(request.url);
  const target = `${UPSTREAM}/${splat}${url.search}`;
  const ttl = request.method === "GET" ? edgeTtl(splat, url.search) : 0;
  const cache = ttl && typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  const cacheKey = cache ? new Request(url.toString(), { method: "GET" }) : null;
  if (cache && cacheKey) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers); h.set("x-arc-edge", "hit");
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }
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
    out.set("x-arc-proxy", "1");
    if (ttl && last.status === 200 && cache && cacheKey) {
      // stale-while-revalidate: the browser may keep it briefly, the edge keeps it for ttl seconds
      out.set("cache-control", `public, max-age=${Math.min(ttl, 5)}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 3}`);
      out.set("x-arc-edge", "miss");
      const bytes = await last.arrayBuffer();
      out.delete("vary"); out.delete("set-cookie");
      out.set("content-length", String(bytes.byteLength));
      await cache.put(cacheKey, new Response(bytes.slice(0), { status: 200, headers: out })).catch(() => undefined);
      return new Response(bytes, { status: 200, headers: out });
    }
    out.set("cache-control", last.headers.get("cache-control") ?? "no-store");
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
