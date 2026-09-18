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
        return Response.json({ count: rows.length, tokens: rows }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=10, s-maxage=15, stale-while-revalidate=60" } });
      },
    },
  },
});
