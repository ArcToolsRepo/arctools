/** GET /api/x402/:endpoint?token=…  — pay-per-call ArcTools data (x402 `exact`, USDC on Arc).
 *  No X-PAYMENT → 402 with the price. Valid X-PAYMENT → the data, served immediately, settled by the relayer within seconds.
 *  Same payment re-sent → same answer, no second charge. See docs/x402-design.md. */
import { createFileRoute } from "@tanstack/react-router";

import { BOT, PRICES, b64, challenge, corsHeaders, settle, verify, type Payment } from "@/lib/x402.server";

export const Route = createFileRoute("/api/x402/$endpoint")({
  server: { handlers: {
    OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
    GET: async ({ request, params }) => {
      const endpoint = params.endpoint;
      const price = PRICES[endpoint];
      if (!price) return Response.json({ error: "unknown endpoint", endpoints: Object.keys(PRICES) }, { status: 404, headers: corsHeaders });
      const url = new URL(request.url);
      const token = (url.searchParams.get("token") ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(token)) return Response.json({ error: "token=0x… required" }, { status: 400, headers: corsHeaders });
      const resource = `${url.origin}${url.pathname}?token=${token}`;
      const hdr = request.headers.get("X-PAYMENT");
      if (!hdr) return challenge(resource, endpoint);
      let p: Payment;
      try { p = JSON.parse(atob(hdr)) as Payment; } catch { return challenge(resource, endpoint, "X-PAYMENT is not base64 JSON"); }
      // idempotency first: the same signed payment (network retry) gets the same answer and is never charged twice
      const { bindings } = await import("@/lib/bindings.server");
      const kv = bindings().KV;
      const { keccak_256 } = await import("@noble/hashes/sha3.js");
      const sigBytes = Uint8Array.from(((p?.payload?.signature ?? "").replace(/^0x/, "").match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
      const replayKey = "0x" + Array.from(keccak_256(sigBytes), (x) => x.toString(16).padStart(2, "0")).join("");
      const cached = kv ? await kv.get(`x402:resp:${replayKey}`) : null;
      if (cached) return new Response(cached, { headers: { "content-type": "application/json", ...corsHeaders, "X-PAYMENT-RESPONSE": b64(JSON.stringify({ success: true, network: "eip155:5042", payer: p?.payload?.authorization?.from?.toLowerCase(), replay: true })) } });
      const v = await verify(p, endpoint);
      if (!v.ok) return challenge(resource, endpoint, v.reason);

      // the data: the same bot routes the free tier uses, without the free tier's rate limit
      const one = async (ep: string) => {
        const env = bindings() as unknown as { INGEST_KEY?: string };
        const u = `${BOT}${PRICES[ep].upstream}?token=${token}${ep === "dev-audit" ? `&key=${env.INGEST_KEY ?? ""}` : ""}`;
        const r = await fetch(u, { headers: { "X-Internal": "x402" } }); return r.json().catch(() => ({ error: `upstream ${r.status}` }));
      };
      const data = endpoint === "token-report"
        ? await Promise.all([one("token-stats"), one("dev-audit"), one("sell-sim")]).then(([s, d, x]) => ({ token, stats: s, dev_audit: d, sell_sim: x }))
        : await one(endpoint);
      const body = JSON.stringify({ ...(Array.isArray(data) ? { data } : data), x402: { endpoint, price_usdc: Number(price.amount) / 1e6, payer: v.from } });
      if (kv) await kv.put(`x402:resp:${v.key}`, body, { expirationTtl: 120 });
      // settle before returning: a dangling promise dies with the response in a Worker (the ads.ts lesson); the relayer answers in ~50 ms (it queues the tx)
      const s = await settle(p, v.key, endpoint);
      return new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders,
        "X-PAYMENT-RESPONSE": b64(JSON.stringify({ success: true, network: "eip155:5042", payer: v.from, settlement: s.ok ? "queued" : `relayer: ${s.reason ?? "unavailable"}`, ...(s.tx ? { transaction: s.tx } : {}) })) } });
    },
  } },
});
