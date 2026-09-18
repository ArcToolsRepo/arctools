import { createFileRoute } from "@tanstack/react-router";

import { tokenPage } from "@/lib/arc-api";

/** GET /api/tokenpage?ca=0x… — the token page payload as JSON (same memo as the page). Used for diagnostics + bots. */
export const Route = createFileRoute("/api/tokenpage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ca = new URL(request.url).searchParams.get("ca") ?? "";
        const t0 = Date.now();
        if (new URL(request.url).searchParams.get("probe")) {
          const out: Record<string, unknown> = {};
          for (const u of [`https://api.radardex.pro/token/${ca.toLowerCase()}`, "https://api.radardex.pro/tokens"]) {
            try {
              const r = await fetch(u, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ArcToolsSite/1.0)" }, signal: AbortSignal.timeout(8000) });
              const txt = await r.text();
              out[u] = { status: r.status, len: txt.length, head: txt.slice(0, 120) };
            } catch (e) { out[u] = { err: (e as Error).message }; }
          }
          return Response.json(out, { headers: { "Cache-Control": "no-store" } });
        }
        try {
          const r = await tokenPage({ data: { token: ca } });
          return Response.json({ ms: Date.now() - t0, ...r }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
        } catch (e) {
          return Response.json({ ms: Date.now() - t0, error: (e as Error).message, transient: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
