import { createFileRoute } from "@tanstack/react-router";

import { listAllTokens, listFullTokens, listTokens } from "@/lib/arc-api";

/** GET /api/tokens — the Terminal's merged token list (all launchpads), JSON, cached like the page. */
export const Route = createFileRoute("/api/tokens")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const pad = u.searchParams.get("pad");
        const rows = pad ? await listTokens({ data: { pad } }) : u.searchParams.get("full") ? await listFullTokens() : await listAllTokens();
        return Response.json({ count: rows.length, tokens: rows }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=10" } });
      },
    },
  },
});
