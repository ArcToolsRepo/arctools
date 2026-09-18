import { createFileRoute } from "@tanstack/react-router";

import { padMetaSet } from "@/lib/arcpad";

/** POST /api/pad-meta {token,name,symbol,website,twitter,telegram,image(dataURL),creator} — same rules as the launch form
 *  (token must exist on ArcToolsPad v3/v2, creator must match on-chain). Used by external tools / retries. */
export const Route = createFileRoute("/api/pad-meta")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, string>;
        try { body = (await request.json()) as Record<string, string>; } catch { return Response.json({ ok: false, reason: "bad json" }, { status: 400 }); }
        const r = await padMetaSet({ data: { token: body.token ?? "", name: body.name ?? "", symbol: body.symbol ?? "", website: body.website, twitter: body.twitter, telegram: body.telegram, image: body.image, creator: body.creator } });
        return Response.json(r, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
      },
    },
  },
});
