# ArcTools API × x402 — pay-per-call in USDC on Arc

Status: design + implementation sketch (nothing deployed). Author: ArcTools, 22 Sep 2026.

## 0. TL;DR

- Three endpoints go paid-per-call: `token-stats`, `dev-audit`, `sell-sim`. Free tier stays for humans (rate-limited); agents and bots pay in USDC per request, no API key, no account.
- Protocol: **x402** (Coinbase's HTTP 402 standard), scheme **`exact`**, network **Arc (eip155:5042)**, asset = native USDC via its ERC-20 facade `0x3600…0000`.
- Why it fits Arc: the facade is Circle's **FiatTokenV2 behind a proxy** — `transferWithAuthorization` (EIP-3009), `DOMAIN_SEPARATOR`, name `USDC`, version `2` all verified on-chain. That is exactly what x402 `exact` needs, so the reference client libraries (`x402-fetch`, `x402-axios`, `@coinbase/x402`) work against us after adding one chain entry.
- We run our **own facilitator** (verify + settle) in the Cloudflare Worker + buybot, so there is no dependency on Coinbase's hosted facilitator and no fee to anyone else. Settlement gas on Arc is ~0.002 USDC, so 0.01 USDC calls are still 80 % margin.
- Revenue goes to the same treasury as every fee → ARCT buyback and burn.

## 1. Pricing

| Endpoint | What the caller gets | Cost of serving | Price / call | Notes |
|---|---|---|---|---|
| `GET /api/x402/token-stats?token=` | price, 5m/1h/6h/24h change, volume, txns, traders, supply, mcap, first_ts | 1 Postgres read (cached 5 s) | **0.005 USDC** | cheapest; bots poll it |
| `GET /api/x402/dev-audit?token=` | deployer wallet history, previous tokens and their fate, funder cluster, bundle detection, clone-farm flag | 5–20 DB reads + RPC | **0.02 USDC** | our unique data |
| `GET /api/x402/sell-sim?token=&amount=` | full on-chain round-trip simulation (buy → sell) with state override, honeypot verdict, realised slippage | 2–4 `eth_call` with state override (~300 ms) | **0.03 USDC** | most expensive to serve, highest value |
| bundle `GET /api/x402/token-report?token=` | all three in one response | | **0.04 USDC** | discount vs 0.055 |

Rules
- Prices are in the 402 challenge, so they can change without breaking clients; a client always sees the price before paying.
- `maxTimeoutSeconds` 60: the signed authorization is valid for 60 s, the response must be produced in that window.
- Free tier unchanged: the same data on the public `/api/...` routes with the current rate limit (60 req/min/IP) — humans in the browser never see a 402. Paid routes have **no rate limit** and a 99.9 % SLA target.
- Volume discount later via `arc-voucher` (section 6), not now.

Expected economics: 0.005 USDC minus ~0.002 USDC settlement gas = 0.003 net at the floor; at 100k calls/day that is ~300 USDC/day net, all of it burned. Settlement can be batched (one `transferWithAuthorization` per payment cannot be batched by design, but gas is paid by our relayer at 0.002, fine).

## 2. Payment flow (x402 `exact`)

```
Agent                         ArcTools Worker (resource server + facilitator)          Arc chain
  |  GET /api/x402/dev-audit?token=0x..                                                     |
  |----------------------------------------------->|                                        |
  |  402 Payment Required                          |                                        |
  |  PAYMENT-REQUIRED: base64({                    |                                        |
  |    x402Version:1, accepts:[{ scheme:"exact",   |                                        |
  |    network:"eip155:5042", asset:"0x3600…0000", |                                        |
  |    payTo: treasury, maxAmountRequired:"20000", |   (6-dec USDC units = 0.02 USDC)       |
  |    resource:"…/dev-audit?token=0x..",          |                                        |
  |    maxTimeoutSeconds:60, extra:{name:"USDC",   |                                        |
  |    version:"2"} }] })                           |                                        |
  |<-----------------------------------------------|                                        |
  |  (client signs EIP-712 TransferWithAuthorization: from=agent, to=treasury,              |
  |   value=20000, validAfter=now-60, validBefore=now+60, nonce=random32)                    |
  |  GET … again, header X-PAYMENT: base64({ x402Version, scheme, network, payload:{        |
  |    signature, authorization:{from,to,value,validAfter,validBefore,nonce} } })            |
  |----------------------------------------------->|                                        |
  |                                                |  verify: chain id, asset, payTo, value ≥ price,
  |                                                |  time window, EIP-712 sig recovers `from`,
  |                                                |  nonce unused (authorizationState), balance ≥ value
  |                                                |  → serve the resource NOW (fast path)   |
  |  200 OK + JSON                                 |                                        |
  |  X-PAYMENT-RESPONSE: base64({success,txHash?,network})                                  |
  |<-----------------------------------------------|                                        |
  |                                                |  settle (async, ≤ 2 s): relayer calls  |
  |                                                |  USDC.transferWithAuthorization(...)   |
  |                                                |--------------------------------------->|
  |                                                |  receipt → payments table (status,tx)  |
```

Design decisions
- **Serve-then-settle** for latency: the response goes out as soon as the signature verifies and the balance is sufficient; settlement is submitted by the buybot relayer within ~2 s. Risk: the agent spends the balance between verify and settle. Mitigations: (a) balance check at verify, (b) an unpaid settlement puts the `from` address on a **denylist** (no more fast-path; that address must pay via settle-then-serve until it clears), (c) the loss is bounded by one call price. This is the same trade-off Coinbase's facilitator makes.
- **Nonce replay**: a nonce is single-use on-chain (`authorizationState`); we also keep a memory/KV set of nonces seen in the last 10 minutes so a replay is rejected before touching the chain.
- **Idempotency**: the same `X-PAYMENT` re-sent (network retry) returns the cached response, not a second charge — keyed by `keccak(signature)`, KV TTL 120 s.
- **Facilitator = us**: `POST /api/x402/verify` and `POST /api/x402/settle` are exposed with the standard facilitator shapes so third-party resource servers on Arc could use them later (opt-in, separate decision).

## 3. Chain entry for clients

```ts
// x402 network descriptor for Arc — what a client library needs to add
export const arc = {
  network: "eip155:5042",
  chainId: 5042,
  rpc: "https://rpc.arc.io",                       // any public Arc RPC
  usdc: { address: "0x3600000000000000000000000000000000000000", name: "USDC", version: "2", decimals: 6 },
  // EIP-712 domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: usdc.address }
};
```

Note: the facade exposes 6-decimal ERC-20 amounts (x402 amounts are in these units: `"20000"` = 0.02 USDC). Native `msg.value` on Arc is 18-dec — irrelevant here, x402 only touches the ERC-20 surface.

## 4. Server sketch — Cloudflare Worker (TanStack Start route)

`site/src/lib/x402.server.ts`

```ts
import { recoverTypedDataAddress, hexToBytes, keccak256 } from "viem";        // viem is already a transitive dep; ethers would also do
import { bindings } from "@/lib/bindings.server";
import { rpc } from "@/lib/arc-api";

export const USDC = "0x3600000000000000000000000000000000000000";
export const TREASURY = "0xb35c471b31d636b96f95b84e7a27d69b63235c0d";
export const NETWORK = "eip155:5042";
export const PRICES: Record<string, string> = { "token-stats": "5000", "dev-audit": "20000", "sell-sim": "30000", "token-report": "40000" };  // 6-dec USDC

const DOMAIN = { name: "USDC", version: "2", chainId: 5042, verifyingContract: USDC } as const;
const TYPES = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] } as const;

export type Auth = { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
export type Payment = { x402Version: 1; scheme: "exact"; network: string; payload: { signature: string; authorization: Auth } };

/** the 402 body + header for one resource */
export function challenge(resource: string, endpoint: string) {
  const body = { x402Version: 1, error: "payment required", accepts: [{
    scheme: "exact", network: NETWORK, asset: USDC, payTo: TREASURY, maxAmountRequired: PRICES[endpoint],
    resource, description: `ArcTools ${endpoint}`, mimeType: "application/json", maxTimeoutSeconds: 60,
    extra: { name: DOMAIN.name, version: DOMAIN.version },
  }] };
  return new Response(JSON.stringify(body), { status: 402, headers: { "content-type": "application/json", "PAYMENT-REQUIRED": btoa(JSON.stringify(body)), "access-control-allow-origin": "*", "access-control-expose-headers": "PAYMENT-REQUIRED, X-PAYMENT-RESPONSE" } });
}

/** verify without touching the chain except two cheap reads: nonce state + balance */
export async function verify(p: Payment, endpoint: string): Promise<{ ok: true; from: string; key: string } | { ok: false; reason: string }> {
  const a = p.payload.authorization;
  if (p.x402Version !== 1 || p.scheme !== "exact" || p.network !== NETWORK) return { ok: false, reason: "unsupported scheme/network" };
  if (a.to.toLowerCase() !== TREASURY) return { ok: false, reason: "payTo mismatch" };
  if (BigInt(a.value) < BigInt(PRICES[endpoint])) return { ok: false, reason: "amount below price" };
  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validAfter) > now || Number(a.validBefore) < now + 5) return { ok: false, reason: "authorization window" };
  let signer: string;
  try { signer = await recoverTypedDataAddress({ domain: DOMAIN, types: TYPES, primaryType: "TransferWithAuthorization", message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) } as any, signature: p.payload.signature as `0x${string}` }); }
  catch { return { ok: false, reason: "bad signature" }; }
  if (signer.toLowerCase() !== a.from.toLowerCase()) return { ok: false, reason: "signer != from" };
  const key = keccak256(p.payload.signature as `0x${string}`);
  const kv = bindings().KV!;
  if (await kv.get(`x402:nonce:${a.nonce}`)) return { ok: false, reason: "nonce replay" };
  if (await kv.get(`x402:deny:${a.from.toLowerCase()}`)) return { ok: false, reason: "address has an unpaid settlement; retry in settle-first mode" };
  // on-chain: authorizationState(from, nonce) == false and balanceOf(from) >= value (two eth_calls, ~40 ms on our node)
  const [used, bal] = await Promise.all([
    rpc("eth_call", [{ to: USDC, data: "0xe94a0102" + pad(a.from) + a.nonce.slice(2) }, "latest"]),
    rpc("eth_call", [{ to: USDC, data: "0x70a08231" + pad(a.from) }, "latest"]),
  ]);
  if (BigInt(used) !== 0n) return { ok: false, reason: "nonce already used on-chain" };
  if (BigInt(bal) < BigInt(a.value)) return { ok: false, reason: "insufficient USDC" };
  await kv.put(`x402:nonce:${a.nonce}`, "1", { expirationTtl: 600 });
  return { ok: true, from: a.from, key };
}
const pad = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/** hand the settlement to the buybot relayer (it has the gas key); the Worker never holds a private key */
export async function settle(p: Payment, key: string, endpoint: string) {
  const env = bindings() as unknown as { X402_SETTLE_AUTH?: string };
  await fetch("https://bot-production-4200.up.railway.app/api/x402/settle", { method: "POST", headers: { "content-type": "application/json", "X-Settle-Auth": env.X402_SETTLE_AUTH ?? "" },
    body: JSON.stringify({ key, endpoint, payment: p }) }).catch(() => null);     // fire-and-forget; the relayer retries and reports
}
```

`site/src/routes/api/x402/$endpoint.ts`

```ts
import { createFileRoute } from "@tanstack/react-router";
import { challenge, verify, settle, PRICES, type Payment } from "@/lib/x402.server";

export const Route = createFileRoute("/api/x402/$endpoint")({
  server: { handlers: { GET: async ({ request, params }) => {
    const endpoint = params.endpoint;
    if (!PRICES[endpoint]) return Response.json({ error: "unknown endpoint" }, { status: 404 });
    const url = new URL(request.url);
    const hdr = request.headers.get("X-PAYMENT");
    if (!hdr) return challenge(url.toString(), endpoint);
    let p: Payment; try { p = JSON.parse(atob(hdr)); } catch { return Response.json({ error: "bad X-PAYMENT" }, { status: 400 }); }
    const v = await verify(p, endpoint);
    if (!v.ok) return Response.json({ error: v.reason }, { status: 402, headers: { "PAYMENT-REQUIRED": (await challenge(url.toString(), endpoint)).headers.get("PAYMENT-REQUIRED")! } });
    // idempotent replay of the same payment → same answer, no second charge
    const { bindings } = await import("@/lib/bindings.server"); const kv = bindings().KV!;
    const cached = await kv.get(`x402:resp:${v.key}`);
    if (cached) return new Response(cached, { headers: { "content-type": "application/json", "X-PAYMENT-RESPONSE": btoa(JSON.stringify({ success: true, network: "eip155:5042", replay: true })) } });
    // serve: the paid routes are the public bot routes without the rate limit
    const upstream = `https://bot-production-4200.up.railway.app/api/${endpoint}${url.search}`;
    const body = await fetch(upstream, { headers: { "X-Internal": "x402" } }).then((r) => r.text());
    await kv.put(`x402:resp:${v.key}`, body, { expirationTtl: 120 });
    void settle(p, v.key, endpoint);          // note: in a Worker, wrap in ctx.waitUntil or await — a dangling promise dies with the response (see ads.ts lesson)
    return new Response(body, { headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-expose-headers": "X-PAYMENT-RESPONSE",
      "X-PAYMENT-RESPONSE": btoa(JSON.stringify({ success: true, network: "eip155:5042", payer: v.from })) } });
  } } },
});
```

## 5. Relayer sketch — buybot (`buybot/x402.py`)

```python
"""x402 settlement relayer: receives verified payments from the Worker, submits USDC.transferWithAuthorization,
records the result, denylists payers whose settlement fails (insufficient balance at settle time)."""
SEL = "0xe3ee160e"   # transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)

async def api_settle(req):
    if req.headers.get("X-Settle-Auth") != os.environ["X402_SETTLE_AUTH"]: return web.json_response({"ok": False}, status=403)
    j = await req.json(); a = j["payment"]["payload"]["authorization"]; sig = j["payment"]["payload"]["signature"]
    r, s, v = sig[2:66], sig[66:130], int(sig[130:132], 16)
    data = SEL + pad(a["from"]) + pad(a["to"]) + pad(hex(int(a["value"]))) + pad(hex(int(a["validAfter"]))) + pad(hex(int(a["validBefore"]))) + a["nonce"][2:] + pad(hex(v)) + r + s
    await db.execute(text("INSERT INTO x402_payments (key, payer, endpoint, amount, status, ts) VALUES (:k,:p,:e,:a,'pending',:t) ON CONFLICT (key) DO NOTHING")
                     .bindparams(k=j["key"], p=a["from"].lower(), e=j["endpoint"], a=int(a["value"]), t=int(time.time())))
    asyncio.create_task(_settle(j["key"], a["from"], data))           # answer the Worker immediately
    return web.json_response({"ok": True})

async def _settle(key, payer, data):
    try:
        res = await send_tx(to=USDC, data=data, gas=120_000)          # relayer key = X402_RELAYER_KEY (funded with a few USDC for gas)
        ok = res["ok"]
    except Exception as e:
        ok = False; res = {"error": str(e)}
    await db.execute(text("UPDATE x402_payments SET status=:s, tx=:x WHERE key=:k").bindparams(s="settled" if ok else "failed", x=res.get("tx"), k=key))
    if not ok:                                                        # payer spent the balance between verify and settle → no more fast path for them
        await kv_put(f"x402:deny:{payer.lower()}", "1", ttl=86400)     # Worker KV via the site's /api/x402/deny (signed) — or keep the denylist in Postgres and let verify() call the bot
```

Postgres: `x402_payments(key PK, payer, endpoint, amount, status, tx, ts)`; `/api/x402/stats` (public): calls/day, USDC/day, unique payers, settlement success rate — goes on the burn page as another fee source.

## 6. Extension for heavy users — `arc-voucher` (later, optional)

For agents making thousands of calls, one on-chain settlement per call is silly. A second accepted scheme in the same 402 challenge:

- `ArcMeter` contract: `deposit()` USDC into a balance; `withdraw()` after a 1 h cooldown; `settle(payer, cumulativeAmount, sig)` callable by the operator — pulls the delta since the last settlement.
- Client signs an EIP-712 **cumulative voucher** per call (`{payer, cumulative, nonceEpoch}`); the server verifies `cumulative - lastSeen ≥ price` off-chain, serves instantly, and settles once per hour or per 1 USDC. Zero gas per call, sub-millisecond verify.
- ~150 lines of Solidity (a payment channel), tests on the fork like ArcLocker. Ship only if `exact` shows demand (> 20k calls/day).

## 7. Client example (what we put in the docs)

```ts
import { wrapFetchWithPayment } from "x402-fetch";        // Coinbase reference client
import { privateKeyToAccount } from "viem/accounts";
const account = privateKeyToAccount(process.env.AGENT_KEY);
const fetchWithPay = wrapFetchWithPayment(fetch, account, { network: "eip155:5042", usdc: "0x3600000000000000000000000000000000000000" });   // Arc entry
const r = await fetchWithPay("https://arctools.fun/api/x402/dev-audit?token=0x7c7489163b1060333e71229bb7a9f8cb7094a7a9");
console.log(await r.json());                              // paid 0.02 USDC, no API key, no account
```

and the raw-HTTP version (curl + a 30-line signer) for non-JS agents.

## 8. Rollout

1. Worker route + verify (no settlement) behind a flag; test with our own signer against Arc mainnet — 1 day.
2. Relayer in buybot, `x402_payments`, denylist, stats — 0.5 day.
3. Docs page `/api-docs` (prices, chain entry, examples), KB entry for Archy, announce on X with the burn angle — 0.5 day.
4. Watch two weeks; if > 20k paid calls/day, build `arc-voucher`.

Open points to decide: (a) `serve-then-settle` (fast, small bounded risk) vs `settle-then-serve` (+1–2 s latency, zero risk) — I propose fast path by default with automatic downgrade per payer; (b) whether to expose our facilitator to other Arc projects (extra revenue via a 0.001 USDC facilitator fee, extra load on the relayer); (c) whether MCP tools (`arctools.dev_audit` etc.) get published alongside so Claude/GPT agents can call the API natively.
