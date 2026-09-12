import { createFileRoute } from "@tanstack/react-router";

import { bindings } from "@/lib/bindings.server";

/**
 * Minimal JSON-RPC proxy for the in-browser trading wallet: the public Arc RPCs do not send CORS headers for
 * browsers, so gas estimation and raw-tx broadcast go through this Worker route. Only two methods are allowed;
 * the raw transaction is already signed client-side — this route never sees a key.
 */
const ALLOWED = new Set(["eth_estimateGas", "eth_sendRawTransaction", "eth_getTransactionCount", "eth_gasPrice"]);
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
        try {
          const r = await fetch(RELAY, {
            body: JSON.stringify({ id: body.id ?? 1, jsonrpc: "2.0", method: body.method, params: body.params ?? [] }),
            headers: { "Content-Type": "application/json", "X-Send-Auth": (bindings() as { SEND_AUTH?: string }).SEND_AUTH ?? "" },
            method: "POST",
          });
          return json(await r.json(), r.status === 200 ? 200 : r.status);
        } catch (e) {
          return json({ error: { message: (e as Error).message } }, 502);
        }
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
