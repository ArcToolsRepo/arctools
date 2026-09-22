/** POST /api/ads-submit {wallet,title,url,image(dataURL 1060×144),payToken:"USDC"|"ARCT",tx} — same checks as the form
 *  (payment verified on-chain, banner size exact, tx single-use). For external tools and the release check. */
import { createFileRoute } from "@tanstack/react-router";
import { submitAd, type SubmitIn } from "@/lib/ads.server";

export const Route = createFileRoute("/api/ads-submit")({
  server: { handlers: {
    POST: async ({ request }) => {
      let body: SubmitIn;
      try { body = (await request.json()) as SubmitIn; } catch { return Response.json({ ok: false, reason: "bad json" }, { status: 400 }); }
      const r = await submitAd(body).catch((e) => ({ ok: false as const, reason: String((e as Error).message ?? e) }));
      return Response.json(r, { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });
    },
  } },
});
