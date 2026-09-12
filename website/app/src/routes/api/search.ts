import { createFileRoute } from "@tanstack/react-router";

const BUYBOT = "https://bot-production-4200.up.railway.app";

/** GET /api/search?q= — every ERC-20 on Arc by symbol / name / address.
 *  Proxies the buybot search (own swap index + arc-scan chain-wide search), which caches per query. */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 64);
        if (q.length < 2) return Response.json({ q, rows: [] }, { headers: { "Access-Control-Allow-Origin": "*" } });
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 9000);
          const r = await fetch(`${BUYBOT}/api/search?q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" }, signal: ctl.signal });
          clearTimeout(t);
          if (!r.ok) throw new Error(`upstream ${r.status}`);
          const j = await r.json();
          return Response.json(j, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" } });
        } catch (e) {
          return Response.json({ q, rows: [], error: String((e as Error).message ?? e) }, { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
