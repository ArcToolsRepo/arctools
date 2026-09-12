import { createFileRoute } from "@tanstack/react-router";

import { listFullTokens } from "@/lib/arc-api";

const BUYBOT = "https://bot-production-4200.up.railway.app";

type Hit = {
  token: string; symbol: string | null; name?: string | null; logo?: string | null; pad?: string | null; mcap?: number | null;
  txs: number; vol: number; last_ts: number | null; venue: string | null; source: "index" | "chain" | "pad" | "unknown"; lookalike?: boolean;
};

/** GET /api/search?q= — every ERC-20 on Arc by symbol / name / address.
 *  Three sources merged by address: every launchpad feed we aggregate (names, logos, mcap), the buybot's swap index
 *  (24 h stats) and arc-scan's chain-wide search (tokens that never traded anywhere we index). */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 64);
        const key = q.toLowerCase();
        const hdr = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" };
        if (q.length < 2) return Response.json({ q, rows: [] }, { headers: hdr });
        const isAddr = /^0x[0-9a-f]{40}$/.test(key);
        const words = key.split(/\s+/).filter(Boolean);
        const hits = new Map<string, Hit>();

        const [pads, bot] = await Promise.all([
          // 1) launchpad feeds (name + symbol + logo) — cached list, cheap
          listFullTokens().catch(() => [] as Awaited<ReturnType<typeof listFullTokens>>),
          // 2) buybot: swap index + arc-scan
          (async () => {
            try {
              const ctl = new AbortController();
              const t = setTimeout(() => ctl.abort(), 9000);
              const r = await fetch(`${BUYBOT}/api/search?q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" }, signal: ctl.signal });
              clearTimeout(t);
              if (!r.ok) throw new Error(`upstream ${r.status}`);
              return ((await r.json()) as { rows?: Hit[] }).rows ?? [];
            } catch { return [] as Hit[]; }
          })(),
        ]);

        for (const t of pads) {
          const a = t.token.toLowerCase();
          const hay = `${t.name ?? ""} ${t.symbol ?? ""}`.toLowerCase();
          const ok = isAddr ? a === key : words.every((w) => hay.includes(w));
          if (!ok) continue;
          hits.set(a, { token: a, symbol: t.symbol || null, name: t.name || null, logo: t.logo ?? null, pad: t.pad, mcap: t.mcapUsd ?? null, txs: 0, vol: t.volUsd ?? 0, last_ts: null, venue: t.pad, source: "pad" });
        }
        for (const h of bot) {
          const a = h.token.toLowerCase();
          const cur = hits.get(a);
          if (cur) { // keep pad metadata, take index stats
            if (h.source === "index") Object.assign(cur, { txs: h.txs, vol: Math.max(cur.vol, h.vol), last_ts: h.last_ts, venue: h.venue ?? cur.venue, source: "index" });
            cur.symbol = cur.symbol ?? h.symbol; cur.lookalike = h.lookalike;
          } else hits.set(a, { ...h, token: a });
        }
        if (isAddr && !hits.has(key)) hits.set(key, { token: key, symbol: null, txs: 0, vol: 0, last_ts: null, venue: null, source: "unknown" });

        const exact = (h: Hit) => (h.symbol ?? "").toLowerCase() === key || (h.name ?? "").toLowerCase() === key;
        const rows = [...hits.values()].sort((a, b) => Number(exact(b)) - Number(exact(a)) || (b.vol || 0) - (a.vol || 0) || (b.mcap || 0) - (a.mcap || 0) || b.txs - a.txs).slice(0, 40);
        return Response.json({ q, rows }, { headers: hdr });
      },
    },
  },
});
