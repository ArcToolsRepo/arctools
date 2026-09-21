import { createFileRoute } from "@tanstack/react-router";

import { listAllTokens, listTokens } from "@/lib/arc-api";

/** GET /api/tokens — the Terminal's merged token list (all launchpads), JSON, cached like the page. */
export const Route = createFileRoute("/api/tokens")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const pad = u.searchParams.get("pad");
        // ?full=1 used to run its own uncapped compute: 40 MB of JSON, over the 25 MB KV limit, so it was never
        // cached and every visitor paid a 25 s recompute that the Worker eventually killed — the Terminal fetches
        // this first, so the table stayed empty. Both lists are now the same capped set; full is kept as an alias.
        const rows = pad ? await listTokens({ data: { pad } }) : await listAllTokens();
        // ?lite=1 — the Terminal's table. The full row carries a venue URL, a description, a stage label and a
        // dex list that the table never renders; 15 k of them were 5 MB of JSON parsed on every visit, and the
        // parse + the 15 k-row filter on each keystroke is most of what "the site lags" meant. Keep only what
        // the rows read; the token page fetches the full record on its own.
        const lite = u.searchParams.get("lite") === "1";
        // Trimming fields barely moved the needle (5.0 -> 4.9 MB): the weight is the row count. 76 % of the
        // 15 k rows never traded and are older than a week — dead launches the table only ever shows when
        // someone searches for them by address, and the search box falls through to the chain lookup for
        // an unknown CA anyway. Ship the rows that can appear in a list.
        // every row, slim fields. Dropping "dead" rows made the app show 8.8k of 15.9k tokens and its New tab
        // miss launches the site lists. The saving was the fields, not the rows: ~300 B/row → ~1 MB gzipped.
        // alive=1 (the app's first paint): rows that traded, have a cap, or are younger than a week — ~9 k instead of
        // 16 k. 5 MB of JSON parsed on a phone WebView blocked the UI for ten seconds and showed "loading" forever;
        // the full list is fetched in the background only when the All / New pairs tabs need it.
        const aliveOnly = u.searchParams.get("alive") === "1";
        const weekAgo = Date.now() - 86_400_000;   // traded, has a cap, or launched in the last 24 h (Arc is 10 days old — a week kept 97 % of rows)
        const src = aliveOnly ? rows.filter((t) => (t.volUsd ?? 0) > 0 || (t.mcapUsd ?? 0) > 0 || (t.createdAt ? Date.parse(t.createdAt) > weekAgo : false)) : rows;
        const out = lite
          ? src.map((t) => ({
              token: t.token, symbol: t.symbol, name: t.name, pad: t.pad, logo: t.logo, createdAt: t.createdAt,
              mcapUsd: t.mcapUsd, priceUsd: t.priceUsd, volUsd: t.volUsd, liqUsd: t.liqUsd ?? null, curve: t.curve ?? null,
              twitter: t.twitter ?? null, telegram: t.telegram ?? null, website: t.website ?? null,
              stock: t.stock || undefined, og: t.og || undefined, quoteSymbol: t.quoteSymbol ?? undefined,
              dexes: t.dexes?.length ? t.dexes : undefined,
            }))
          : rows;
        return Response.json({ count: out.length, tokens: out }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=10, s-maxage=15, stale-while-revalidate=60" } });
      },
    },
  },
});
