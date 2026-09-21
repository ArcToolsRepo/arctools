/** ARCT supply for CoinMarketCap / CoinGecko: they poll a URL that returns a BARE NUMBER (no JSON) for
 *  total and circulating supply. ?q=total | circulating (default) | json.
 *  circulating = totalSupply − treasury (the only project-held, non-circulating balance; it is spent on buyback→burn
 *  and never sold). Staked ARCT in the vault belongs to users and counts as circulating. Burned tokens are removed
 *  from totalSupply by the contract itself, so total already excludes them. 60 s edge cache. */
import { createFileRoute } from "@tanstack/react-router";

const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";
const TREASURY = "0xb35c471b31D636B96f95b84E7A27D69B63235C0D";
const RPCS = ["http://178.156.197.90:8545", "https://rpc.arc-scan.org"];
const p32 = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");

async function call(data: string): Promise<bigint> {
  let last = "";
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: ARCT, data }, "latest"] }), signal: AbortSignal.timeout(6000) });
      const j = (await r.json()) as { result?: string; error?: { message: string } };
      if (j.result && j.result !== "0x") return BigInt(j.result);
      last = j.error?.message ?? "empty";
    } catch (e) { last = String(e); }
  }
  throw new Error(last);
}
const fmt = (wei: bigint) => (Number(wei / 10n ** 12n) / 1e6).toFixed(6);   // 18-dec → 6 decimals of precision, no float overflow

export const Route = createFileRoute("/api/supply")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "circulating";
        try {
          const [total, treasury] = await Promise.all([call("0x18160ddd"), call("0x70a08231" + p32(TREASURY))]);
          const circ = total - treasury;
          const h = { "cache-control": "public, max-age=60, s-maxage=60", "access-control-allow-origin": "*" };
          if (q === "json") return Response.json({ token: ARCT, decimals: 18, total_supply: fmt(total), circulating_supply: fmt(circ), non_circulating: { treasury: fmt(treasury), address: TREASURY }, updated: Math.floor(Date.now() / 1000) }, { headers: h });
          return new Response(fmt(q === "total" ? total : circ), { headers: { ...h, "content-type": "text/plain" } });
        } catch (e) {
          return new Response("rpc unavailable: " + String(e).slice(0, 80), { status: 503 });
        }
      },
    },
  },
});
