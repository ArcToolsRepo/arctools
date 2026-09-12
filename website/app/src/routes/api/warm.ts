import { createFileRoute } from "@tanstack/react-router";

import { listAllTokensImpl, memo, screenerIcons, tokenPage } from "@/lib/arc-api";
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
        const [all, trend] = await Promise.all([
          memo("list:__all", 1, listAllTokensImpl, (v) => v.length > 50),      // ttl 1 ms: force a recompute, write KV
          fetch("https://bot-production-4200.up.railway.app/api/trending?minutes=60&limit=40").then((r) => r.json()).then((j) => (j.rows ?? []) as { token: string }[]).catch(() => [] as { token: string }[]),
          screenerIcons().catch(() => null),
        ]);
        // token pages of what people click most (trending + newest) — 6 at a time so upstreams stay happy
        // token pages: only every 4th run (~60 s) — they cost RPC; between runs stale-while-revalidate keeps them instant
        const runPages = Math.floor(Date.now() / 15_000) % 4 === 0;
        const hot = runPages ? [...new Set([...trend.slice(0, 12).map((t) => t.token), ...all.slice(0, 8).map((t) => t.token)])].slice(0, 20) : [];
        let warmed = 0;
        for (let i = 0; i < hot.length; i += 6) {
          await Promise.all(hot.slice(i, i + 6).map((t) => tokenPage({ data: { token: t } }).then(() => { warmed++; }).catch(() => null)));
        }
        return Response.json({ ok: true, tokens: all.length, pages: warmed, ms: Date.now() - t0 }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
