/** GET /api/ads-img/:id → the banner bytes (any status — the admin previews pending ones from the Telegram notice) */
import { createFileRoute } from "@tanstack/react-router";
import { adImage } from "@/lib/ads.server";

export const Route = createFileRoute("/api/ads-img/$id")({
  server: { handlers: {
    GET: async ({ params }) => {
      const id = Number(params.id);
      const img = Number.isInteger(id) ? await adImage(id).catch(() => null) : null;
      const m = img ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(img) : null;
      if (!m) return new Response("not found", { status: 404 });
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      return new Response(bytes, { headers: { "content-type": m[1], "access-control-allow-origin": "*", "cache-control": "public, max-age=3600, immutable", "cdn-cache-control": "max-age=3600" } });
    },
  } },
});
