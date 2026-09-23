/** Cross-chain Quick Buy: ETH / USDC on another chain → one Relay intent → ArcAggregator buy on Arc, token lands in the buyer's wallet.
 *  The buyer signs ONE transaction on the origin chain. Relay's solver pays native USDC on Arc and calls our aggregator
 *  (destination call), so the 1.5 % ArcTools fee stays exactly the same as a normal Quick Buy. If the Arc call reverts,
 *  Relay refunds native USDC on Arc to the buyer's address (never back to the origin chain). */
import { createServerFn } from "@tanstack/react-start";

import { routeSwap } from "./arc-route";
import { encodeAggregatorSwap, ARC_AGGREGATOR } from "./arc-wallet";

export const FEE_BPS = 150;
export type Origin = { id: number; name: string; native: string; hex: string; usdc: string | null; explorer: string; rpc: string };
export const ORIGINS: Origin[] = [
  { id: 8453, name: "Base", native: "ETH", hex: "0x2105", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://basescan.org/tx/", rpc: "https://mainnet.base.org" },
  { id: 42161, name: "Arbitrum", native: "ETH", hex: "0xa4b1", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", explorer: "https://arbiscan.io/tx/", rpc: "https://arb1.arbitrum.io/rpc" },
  { id: 1, name: "Ethereum", native: "ETH", hex: "0x1", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", explorer: "https://etherscan.io/tx/", rpc: "https://ethereum-rpc.publicnode.com" },
  { id: 10, name: "Optimism", native: "ETH", hex: "0xa", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", explorer: "https://optimistic.etherscan.io/tx/", rpc: "https://mainnet.optimism.io" },
  { id: 56, name: "BNB Chain", native: "BNB", hex: "0x38", usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", explorer: "https://bscscan.com/tx/", rpc: "https://bsc-dataseed.binance.org" },
  { id: 137, name: "Polygon", native: "POL", hex: "0x89", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", explorer: "https://polygonscan.com/tx/", rpc: "https://polygon-rpc.com" },
];
const ZERO = "0x0000000000000000000000000000000000000000";
const RELAY = "https://api.relay.link";

export type CrossQuote = {
  error?: string;
  payAmount: string; payFormatted: string; paySymbol: string; payUsd: number | null;
  usdcOut: string; tokenOut: string; legs: string[]; timeEstimate: number; relayFeeUsd: number; arcFeeUsd: number;
  steps: { id: string; tx: { to: string; data: string; value: string; chainId: number; gas?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string }; check: string }[];
  requestId: string;
};

/** Quote: route the buy on Arc, encode the aggregator call, ask Relay what the buyer pays on the origin chain. */
export const crossQuote = createServerFn({ method: "POST" })
  .inputValidator((i: { user: string; origin: number; payUsdc: boolean; token: string; usdc: number; to: string }) => i)
  .handler(async ({ data }): Promise<CrossQuote> => {
    const fail = (error: string): CrossQuote => ({ error, payAmount: "0", payFormatted: "", paySymbol: "", payUsd: null, usdcOut: "0", tokenOut: "0", legs: [], timeEstimate: 0, relayFeeUsd: 0, arcFeeUsd: 0, steps: [], requestId: "" });
    const o = ORIGINS.find((x) => x.id === data.origin); const token = data.token.toLowerCase(); const to = data.to.toLowerCase(); const user = data.user.toLowerCase();
    if (!o || !/^0x[0-9a-f]{40}$/.test(token) || !/^0x[0-9a-f]{40}$/.test(to) || !/^0x[0-9a-f]{40}$/.test(user)) return fail("bad input");
    if (!(data.usdc >= 1 && data.usdc <= 2000)) return fail("1–2000 USDC per buy");
    const spend = BigInt(Math.round(data.usdc * 1e6)) * 10n ** 12n;
    const r = await routeSwap({ data: { token, side: "buy", amount: spend.toString() } });
    if (r.error || r.legs.length === 0) return fail(r.error === "no venue" ? "no pool yet" : r.error ?? "no pool yet");
    const legs = r.legs.map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
    const calldata = encodeAggregatorSwap("buy", token, legs, 0n, to, FEE_BPS);   // minOut 0: solver fills within ~5 s, the quote is informational
    const value = spend + (spend * BigInt(FEE_BPS)) / 10_000n;
    const gas = legs.some((l) => l.venue === 3 || l.venue === 4 || l.venue === 6) ? 2_500_000 : legs.some((l) => l.venue === 2) ? 1_200_000 : 700_000;
    const body = { user, recipient: to, originChainId: o.id, destinationChainId: 5042, originCurrency: data.payUsdc ? o.usdc : ZERO, destinationCurrency: ZERO, amount: value.toString(), tradeType: "EXACT_OUTPUT",
      txs: [{ to: ARC_AGGREGATOR, value: value.toString(), data: calldata }], txsGasLimit: gas, refundTo: to };
    const res = await fetch(`${RELAY}/quote`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "arctools-site/1.0" }, body: JSON.stringify(body) });
    const q = (await res.json()) as { message?: string; details?: Record<string, unknown>; fees?: Record<string, { amountUsd?: string }>; steps?: { id: string; items: { data: Record<string, string>; check?: { endpoint: string } }[] }[] };
    if (!res.ok || !q.details || !q.steps?.length) return fail((q.message ?? "no route on Relay").slice(0, 80));
    const d = q.details as { currencyIn: { amount: string; amountFormatted: string; amountUsd?: string; currency: { symbol: string } }; currencyOut: { amount: string }; timeEstimate?: number; requestId?: string };
    const steps = q.steps.flatMap((st) => st.items.map((item) => ({ id: st.id, tx: { to: item.data.to, data: item.data.data ?? "0x", value: item.data.value ?? "0", chainId: Number(item.data.chainId ?? o.id), gas: item.data.gas, maxFeePerGas: item.data.maxFeePerGas, maxPriorityFeePerGas: item.data.maxPriorityFeePerGas }, check: item.check?.endpoint ?? "" })));
    const relayFee = ["relayer", "gas"].reduce((a, k) => a + Number(q.fees?.[k]?.amountUsd ?? 0), 0);
    return {
      payAmount: d.currencyIn.amount, payFormatted: Number(d.currencyIn.amountFormatted).toLocaleString(undefined, { maximumSignificantDigits: 5 }), paySymbol: d.currencyIn.currency.symbol, payUsd: d.currencyIn.amountUsd ? Number(d.currencyIn.amountUsd) : null,
      usdcOut: value.toString(), tokenOut: r.out, legs: r.legs.map((l) => l.label), timeEstimate: d.timeEstimate ?? 5, relayFeeUsd: relayFee, arcFeeUsd: Number(spend) / 1e18 * FEE_BPS / 10_000,
      steps, requestId: d.requestId ?? "",
    };
  });

/** Fill status of a Relay intent (`pending` → `success` | `failure` | `refund`). */
export const crossStatus = createServerFn({ method: "POST" })
  .inputValidator((i: { check: string }) => i)
  .handler(async ({ data }): Promise<{ status: string; txHashes: string[]; details: string }> => {
    if (!data.check.startsWith("/")) return { status: "failure", txHashes: [], details: "bad check" };
    const r = await fetch(RELAY + data.check, { headers: { "user-agent": "arctools-site/1.0" } });
    const j = (await r.json()) as { status?: string; txHashes?: string[]; details?: string };
    return { status: j.status ?? "pending", txHashes: j.txHashes ?? [], details: typeof j.details === "string" ? j.details : "" };
  });
