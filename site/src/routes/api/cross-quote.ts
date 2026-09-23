import { createFileRoute } from "@tanstack/react-router";

import { crossQuote, crossStatus } from "@/lib/arc-cross";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Cache-Control": "no-store" };

/** POST /api/cross-quote {user, origin, payUsdc, token, usdc, to} → Relay quote with the ArcAggregator destination call (used by ArcOne).
 *  GET  /api/cross-quote?check=/intents/status/v2?requestId=… → fill status. */
export const Route = createFileRoute("/api/cross-quote")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const check = new URL(request.url).searchParams.get("check") ?? "";
        const r = await crossStatus({ data: { check } });
        return Response.json(r, { headers: CORS });
      },
      POST: async ({ request }) => {
        let j: { user?: string; origin?: number; payUsdc?: boolean; token?: string; usdc?: number; to?: string };
        try { j = (await request.json()) as typeof j; } catch { return Response.json({ error: "bad json" }, { status: 400, headers: CORS }); }
        const r = await crossQuote({ data: { user: String(j.user ?? ""), origin: Number(j.origin ?? 8453), payUsdc: !!j.payUsdc, token: String(j.token ?? ""), usdc: Number(j.usdc ?? 0), to: String(j.to ?? j.user ?? "") } });
        return Response.json(r, { headers: CORS });
      },
    },
  },
});
