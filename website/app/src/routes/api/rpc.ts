import { createFileRoute } from "@tanstack/react-router";

import { bindings } from "@/lib/bindings.server";

/**
 * Minimal JSON-RPC proxy for the in-browser trading wallet: the public Arc RPCs do not send CORS headers for
 * browsers, so gas estimation and raw-tx broadcast go through this Worker route. Only two methods are allowed;
 * the raw transaction is already signed client-side — this route never sees a key.
 */
const ALLOWED = new Set(["eth_estimateGas", "eth_sendRawTransaction", "eth_getTransactionCount", "eth_gasPrice",
  // reads the page needs (staking allowance, balances, receipts): they used to go from the browser straight
  // to the relay, which bans browser IPs and replies with the bare word "banned"
  "eth_call", "eth_getBalance", "eth_getTransactionReceipt", "eth_blockNumber", "eth_chainId", "eth_getCode"]);
const RELAY = "https://rpc-production-ba7a.up.railway.app";   // our Railway relay: not rate-limited for Cloudflare IPs; sends need X-Send-Auth

export const Route = createFileRoute("/api/rpc")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { headers: cors() }),
      POST: async ({ request }) => {
        let body: { id?: number; method?: string; params?: unknown[] };
        try {
          body = await request.json();
        } catch {
          return json({ error: "bad json" }, 400);
        }
        if (!body.method || !ALLOWED.has(body.method)) return json({ error: "method not allowed" }, 403);
        // the relay sits behind Railway's edge, which answers a plain-text 502 when a fan-out takes long → retry up to 3×
        let lastErr = "relay unreachable";
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(RELAY, {
              body: JSON.stringify({ id: body.id ?? 1, jsonrpc: "2.0", method: body.method, params: body.params ?? [] }),
              headers: { "Content-Type": "application/json", "X-Send-Auth": (bindings() as { SEND_AUTH?: string }).SEND_AUTH ?? "" },
              method: "POST", signal: AbortSignal.timeout(24_000),
            });
            const text = await r.text();
            try { return json(JSON.parse(text), r.status === 200 ? 200 : r.status); }
            catch { lastErr = `relay ${r.status}: ${text.slice(0, 80)}`; }
          } catch (e) { lastErr = (e as Error).message; }
          await new Promise((res) => setTimeout(res, 1500));
        }
        return json({ jsonrpc: "2.0", id: body.id ?? 1, error: { code: -32005, message: `RPC busy — ${lastErr}. Retry in a moment.` } }, 200);
      },
    },
  },
});

function cors() {
  return { "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { headers: cors(), status });
}
