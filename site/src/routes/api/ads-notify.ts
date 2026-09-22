/** GET /api/ads-notify?id=&k=HMAC(ad:id:notify) — re-send the admin review notice for one banner (diagnosis / lost message) */
import { createFileRoute } from "@tanstack/react-router";
import { notifyAdmin, reviewKey } from "@/lib/ads.server";

export const Route = createFileRoute("/api/ads-notify")({
  server: { handlers: {
    GET: async ({ request }) => {
      const u = new URL(request.url); const id = Number(u.searchParams.get("id")); const k = u.searchParams.get("k") ?? "";
      if (!Number.isInteger(id)) return new Response("bad id", { status: 400 });
      if (k !== await reviewKey(id, "notify")) return new Response("forbidden", { status: 403 });
      const [ka, kr] = await Promise.all([reviewKey(id, "approve"), reviewKey(id, "reject")]);
      const r = await notifyAdmin(`📢 Banner #${id} — review notice re-sent\nPreview: https://arctools.fun/api/ads-img/${id}`, [[
        { text: "✅ Approve", url: `https://arctools.fun/api/ads-review?id=${id}&do=approve&k=${ka}` },
        { text: "❌ Reject", url: `https://arctools.fun/api/ads-review?id=${id}&do=reject&k=${kr}` },
      ]]);
      return new Response(r, { headers: { "cache-control": "no-store" } });
    },
  } },
});
