import { createFileRoute } from "@tanstack/react-router";

import { routeSwap } from "@/lib/arc-route";

/** GET /api/swaproute?token=0x…&side=buy|sell&amount=<1e18 units> — ArcAggregator route preview (legs, venue labels, expected out). */
export const Route = createFileRoute("/api/swaproute")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const token = (u.searchParams.get("token") ?? "").toLowerCase();
        const side = u.searchParams.get("side") === "sell" ? "sell" : "buy";
        const amount = u.searchParams.get("amount") ?? "1000000000000000000";
        if (!/^0x[0-9a-f]{40}$/.test(token)) return Response.json({ error: "token" }, { status: 400 });
        const r = await routeSwap({ data: { token, side, amount } });
        return Response.json(r, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
      },
    },
  },
});
