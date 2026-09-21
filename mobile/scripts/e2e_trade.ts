/** Real money E2E through the app's own trade.ts: buy ARGUS for 0.5 USDC, sell 100 %, verify the fee hit the treasury. */
import "./shim";
import * as HW from "../src/lib/arc-hotwallet";
import { buy, sell, tokenBalanceRaw } from "../src/lib/trade";

const KEY = process.env.E2E_KEY!;
const TOKEN = "0x22610ae8dd2a913a87d1c2e1a519459d3901c6d1"; // GRE (ArcToolsPad v3 curve, USDC)
const TREASURY = "0xb35c471b31d636b96f95b84e7a27d69b63235c0d";
const RPC = "http://178.156.197.90:8545";
const rpc = async (method: string, params: unknown[]) => (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const bal = async (a: string) => BigInt(await rpc("eth_getBalance", [a, "latest"]));

const main = async () => {
  await HW.importWallet(KEY, "e2e-pass");
  await HW.unlock("e2e-pass");
  const me = HW.hotAddress()!;
  const t0 = await bal(TREASURY); const m0 = await bal(me);
  console.log("wallet", me, "USDC", Number(m0) / 1e18);

  let t1 = t0;
  if (!process.env.SELL_ONLY) {
  const h1 = await buy(TOKEN, 0.5, (s) => console.log("  ", s));
  const r1 = await HW.hotWait(h1); console.log("BUY", h1, "status", r1.status);
  const tok = await tokenBalanceRaw(TOKEN, me); console.log("  ARGUS held:", Number(tok) / 1e18);
  t1 = await bal(TREASURY);
  console.log("  treasury +", Number(t1 - t0) / 1e18, "USDC (expected 0.5 % of 0.5 =", 0.0025, ")");
  }

  const h2 = await sell(TOKEN, 100, (s) => console.log("  ", s));
  const r2 = await HW.hotWait(h2); console.log("SELL", h2, "status", r2.status);
  const tok2 = await tokenBalanceRaw(TOKEN, me); const t2 = await bal(TREASURY); const m2 = await bal(me);
  console.log("  ARGUS left:", Number(tok2) / 1e18, "| treasury +", Number(t2 - t1) / 1e18, "USDC on sell");
  console.log("round trip cost:", Number(m0 - m2) / 1e18, "USDC incl. gas + 2 fees");
};
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
