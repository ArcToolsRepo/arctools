/** GET /api/ads-review?id=&do=approve|reject&k=HMAC — the two buttons in the admin's Telegram notice */
import { createFileRoute } from "@tanstack/react-router";
import { reviewAd, reviewKey } from "@/lib/ads.server";

export const Route = createFileRoute("/api/ads-review")({
  server: { handlers: {
    GET: async ({ request }) => {
      const u = new URL(request.url);
      const id = Number(u.searchParams.get("id")); const action = u.searchParams.get("do"); const k = u.searchParams.get("k") ?? "";
      if (!Number.isInteger(id) || (action !== "approve" && action !== "reject")) return new Response("bad request", { status: 400 });
      if (k !== await reviewKey(id, action)) return new Response("forbidden", { status: 403 });
      const r = await reviewAd(id, action);
      return new Response(`<!doctype html><meta name=viewport content="width=device-width"><body style="font:16px system-ui;background:#0a0c10;color:#eef;padding:40px"><p>${r.msg}</p><p><a style="color:#6fa0ff" href="/trade">Terminal</a></p>`, { headers: { "content-type": "text/html", "cache-control": "no-store" } });
    },
  } },
});
