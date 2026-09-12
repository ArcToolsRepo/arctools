import { createFileRoute } from "@tanstack/react-router";

import { bindings } from "@/lib/bindings.server";

/** Browser -> Worker -> bot ledger, so the credit secret stays server-side. Fee is capped to what a swap can carry. */
export const Route = createFileRoute("/api/ref-credit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const j = (await request.json().catch(() => ({}))) as { wallet?: string; tx?: string; fee_usd?: number };
        const wallet = String(j.wallet ?? "").toLowerCase(); const tx = String(j.tx ?? "").toLowerCase(); const fee = Number(j.fee_usd ?? 0);
        if (!/^0x[0-9a-f]{40}$/.test(wallet) || !/^0x[0-9a-f]{64}$/.test(tx) || !(fee > 0) || fee > 5000) return Response.json({ ok: false }, { status: 400 });
        const auth = bindings().REF_AUTH;
        if (!auth) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
        const r = await fetch("https://bot-production-4200.up.railway.app/api/ref/credit", { method: "POST", headers: { "Content-Type": "application/json", "X-Ref-Auth": auth }, body: JSON.stringify({ subject_kind: "wallet", subject_id: wallet, source: "site", tx, fee_usd: fee }) });
        return Response.json(await r.json().catch(() => ({ ok: r.ok })), { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
