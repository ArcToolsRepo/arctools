import { createFileRoute } from "@tanstack/react-router";

import { longLaunches, longStocks } from "@/lib/longsupply";

/** GET /api/stocks — long.supply wrapped stocks on Arc (address, symbol, USD price, vault) + optional ?launches=1. */
export const Route = createFileRoute("/api/stocks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const [stocks, launches] = await Promise.all([longStocks().catch(() => []), u.searchParams.get("launches") ? longLaunches().catch(() => []) : Promise.resolve(null)]);
        return Response.json({ stocks, ...(launches ? { launches } : {}) }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } });
      },
    },
  },
});
