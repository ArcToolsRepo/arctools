/** GET /api/ads → { ads: [{id,title,url,ends_at}], slots, days, next_free_at } — the live banner strip (cache 60 s) */
import { createFileRoute } from "@tanstack/react-router";
import { AD_DAYS, AD_SLOTS } from "@/lib/ads";
import { activeAds, nextFree } from "@/lib/ads.server";

export const Route = createFileRoute("/api/ads")({
  server: { handlers: {
    GET: async () => {
      try {
        const [ads, nf] = await Promise.all([activeAds(), nextFree()]);
        return Response.json({ ads: ads.map((a) => ({ id: a.id, title: a.title, url: a.url, ends_at: a.ends_at })), slots: AD_SLOTS, days: AD_DAYS, next_free_at: nf.nextFreeAt, queued: nf.queued },
          { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60", "cdn-cache-control": "max-age=60" } });
      } catch (e) {
        return Response.json({ ads: [], slots: AD_SLOTS, days: AD_DAYS, error: String(e) }, { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });
      }
    },
  } },
});
