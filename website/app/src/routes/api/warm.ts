import { createFileRoute } from "@tanstack/react-router";

import { listAllTokensImpl, memo, screenerIcons, tokenPage } from "@/lib/arc-api";
import { routeSwap } from "@/lib/arc-route";
import { bindings } from "@/lib/bindings.server";

/**
 * GET /api/warm?k=<WARM_AUTH> — pinged by the buybot every 15 s. Recomputes the Terminal / Feed token
 * lists and the logo index so KV always holds a fresh copy: visitors never wait for upstreams.
 */
export const Route = createFileRoute("/api/warm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const auth = bindings().WARM_AUTH;
        if (auth && url.searchParams.get("k") !== auth) return new Response("forbidden", { status: 403 });
        const t0 = Date.now();
        // self-heal hook: ?purge=lists drops the cached token lists / screener / trend so the next compute is fresh;
        // ?purge=token:<ca> drops one token page (used by the watchdog when a page looks broken)
        const purge = url.searchParams.get("purge");
        if (purge) {
          const kv = bindings().KV;
          const keys = purge === "lists" ? ["memo:list:__all", "memo:list:__full", "memo:radar:screener", "memo:trend:1440", "memo:v2:tokens", "memo:padlist", "memo:long:launches", "memo:long:stocks", ...["RadarDex", "ArcPad", "Warp", "Tolly", "UniswapV3", "Archemist", "UniswapV4", "Arguspad"].map((p) => `memo:list:${p}`)]
            : purge.startsWith("token:") ? [`memo:tokenpage:${purge.slice(6).toLowerCase()}`] : [];
          if (kv) await Promise.all(keys.map((k) => kv.delete(k).catch(() => null)));
          return Response.json({ ok: true, purged: keys.length }, { headers: { "Cache-Control": "no-store" } });
        }
        const [all, trend] = await Promise.all([
          memo("list:__all", 1, listAllTokensImpl, (v) => v.length > 50),      // ttl 1 ms: force a recompute, write KV
          fetch("https://bot-production-4200.up.railway.app/api/trending?minutes=60&limit=40").then((r) => r.json()).then((j) => (j.rows ?? []) as { token: string }[]).catch(() => [] as { token: string }[]),
          screenerIcons().catch(() => null),
        ]);
        // token pages of what people click most (trending + newest) — 6 at a time so upstreams stay happy
        // token pages: only every 4th run (~60 s) — they cost RPC; between runs stale-while-revalidate keeps them instant
        const runPages = Math.floor(Date.now() / 15_000) % 16 === 0;   // every ~4 min: the public RPCs cannot afford more
        // ArcToolsPad launches + newest 12 + trending 12 + long.supply top: these are the pages people open from the Terminal
        const pads = all.filter((t) => t.pad === "ArcToolsPad").map((t) => t.token);
        const hot = runPages ? [...new Set([...pads, ...trend.slice(0, 8).map((t) => t.token), ...all.slice(0, 4).map((t) => t.token), ...all.filter((t) => t.pad === "long.supply" && !t.stock).slice(0, 2).map((t) => t.token)])].slice(0, 16) : [];
        let warmed = 0;
        for (let i = 0; i < hot.length; i += 6) {
          await Promise.all(hot.slice(i, i + 6).map((t) => tokenPage({ data: { token: t } }).then(() => { warmed++; }).catch(() => null)));
          // venue discovery for the swap panel / quick-buy (memoized 60 s in KV) — a cold discovery is ~10 s of relay round-trips
          await Promise.all(hot.slice(i, i + 6).map((t) => routeSwap({ data: { token: t, side: "buy", amount: "1000000000000000000" } }).catch(() => null)));
        }
        return Response.json({ ok: true, tokens: all.length, pages: warmed, ms: Date.now() - t0 }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
