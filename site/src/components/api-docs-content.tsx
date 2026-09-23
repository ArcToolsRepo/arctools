import { useEffect, useState } from "react";

/** /api-docs — the pay-per-call API for agents and bots (x402 on Arc). Prices are read from the live 402 challenge so the page never lies. */
const card: React.CSSProperties = { background: "var(--arc-paper-deep)", border: "1px solid var(--arc-line)", borderRadius: 14, padding: 18 };
const pre: React.CSSProperties = { background: "rgba(0,0,0,0.35)", border: "1px solid var(--arc-line)", borderRadius: 10, fontSize: 12, lineHeight: 1.55, overflowX: "auto", padding: 14, whiteSpace: "pre" };
const ENDPOINTS = [
  { ep: "token-stats", what: "price, 5m/1h/6h/24h change, volume, txns, traders, supply, market cap" },
  { ep: "dev-audit", what: "deployer wallet history, previous tokens and how they ended, funder cluster, bundle detection, clone-farm flag" },
  { ep: "sell-sim", what: "a real on-chain round trip (buy, then sell back) simulated with state override: honeypot verdict, how much you keep" },
  { ep: "token-report", what: "all three above in one response" },
];

export function ApiDocsContent() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<{ all_time?: { calls: number; usdc: number; payers: number }; last_24h?: { calls: number; usdc: number; payers: number } } | null>(null);
  useEffect(() => {
    // the price is whatever the 402 says — read it from the challenge itself
    Promise.all(ENDPOINTS.map((e) => fetch(`/api/x402/${e.ep}?token=0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52`).then((r) => r.json()).then((j: { accepts?: { maxAmountRequired: string }[] }) => [e.ep, Number(j.accepts?.[0]?.maxAmountRequired ?? 0) / 1e6] as const).catch(() => [e.ep, 0] as const)))
      .then((rows) => setPrices(Object.fromEntries(rows)));
    fetch("https://bot-production-4200.up.railway.app/api/x402/stats").then((r) => r.json()).then(setStats).catch(() => null);
  }, []);
  return (
    <>
      <p className="arc-eyebrow">ARCTOOLS API · PAY PER CALL</p>
      <h1 className="arc-h2" style={{ fontSize: 30 }}>Data for bots and agents. No key, no account, USDC per call.</h1>
      <p className="arc-body" style={{ maxWidth: 800 }}>
        The same data that powers the Terminal, sold one request at a time with <a href="https://www.x402.org" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">x402</a> — the HTTP 402 payment standard.
        Your agent calls an endpoint, gets a price, signs a USDC authorization on Arc, retries, gets the data. Settlement happens on-chain within seconds; you pay exactly the listed price and nothing else.
        Every payment lands in the ArcTools treasury and is burned into ARCT like every other fee. The free endpoints on this site stay free for humans (rate-limited); the paid ones have no rate limit.
      </p>
      {stats?.all_time && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>Live: {stats.all_time.calls.toLocaleString()} paid calls · {stats.all_time.usdc.toFixed(3)} USDC · {stats.all_time.payers} payers all-time · {stats.last_24h?.calls ?? 0} calls in the last 24 h</p>}

      <div className="arc-pay-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", marginTop: 20 }}>
        <div style={card}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>Endpoints</p>
          {ENDPOINTS.map((e) => (
            <div className="arc-mono" key={e.ep} style={{ borderTop: "1px solid var(--arc-line)", fontSize: 13, padding: "10px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-ink)" }}>GET /api/x402/{e.ep}?token=0x…</span><span style={{ color: "#22c580" }}>{prices[e.ep] ? `${prices[e.ep]} USDC` : "…"}</span></div>
              <div style={{ color: "var(--arc-muted)", fontSize: 12, marginTop: 4 }}>{e.what}</div>
            </div>
          ))}
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 12 }}>
            Network <code>eip155:5042</code> (Arc) · asset USDC <code>0x3600…0000</code> (EIP-3009, name &quot;USDC&quot;, version &quot;2&quot;) · payTo <code>0xb35c…5c0d</code> · scheme <code>exact</code> · authorization window 60 s.
            The same signed payment re-sent returns the same answer and is never charged twice.
          </p>
        </div>
        <div style={card}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>How a call works</p>
          <ol className="arc-body" style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
            <li><code>GET</code> the endpoint. You get <code>402</code> and a <code>PAYMENT-REQUIRED</code> header: base64 JSON with the price, the asset and where to pay.</li>
            <li>Sign an EIP-712 <code>TransferWithAuthorization</code> (USDC → treasury, the exact amount, a random 32-byte nonce, valid for 60 s). Any EVM key can sign it; no gas needed on your side.</li>
            <li>Retry the same <code>GET</code> with header <code>X-PAYMENT</code>: base64 JSON <code>{"{"} x402Version:1, scheme:&quot;exact&quot;, network, payload:{"{"} signature, authorization {"}"} {"}"}</code>.</li>
            <li>You get <code>200</code> with the data and <code>X-PAYMENT-RESPONSE</code> (payer, settlement status). The relayer pulls the USDC on-chain within seconds.</li>
          </ol>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 10 }}>
            Coinbase&apos;s reference clients (<code>x402-fetch</code>, <code>x402-axios</code>) work after adding the Arc network entry below; or use the 40-line signer from our repo.
          </p>
        </div>
      </div>

      <div style={{ ...card, marginTop: 16 }}>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>Minimal client (TypeScript, @noble only)</p>
        <pre className="arc-mono" style={pre}>{`import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp from "@noble/secp256k1";

const KEY = process.env.AGENT_KEY!;                       // any funded Arc wallet (USDC is the gas token, no separate gas needed)
const url = "https://arctools.fun/api/x402/dev-audit?token=0x7c7489163b1060333e71229bb7a9f8cb7094a7a9";
const hex = (b: Uint8Array) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/.{2}/g)!.map((x) => parseInt(x, 16)));
const kt = (s: string) => keccak_256(new TextEncoder().encode(s));
const pad = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const num = (v: string | bigint) => BigInt(v).toString(16).padStart(64, "0");

const r1 = await fetch(url);                              // 402
const acc = JSON.parse(atob(r1.headers.get("PAYMENT-REQUIRED")!)).accepts[0];
const from = hex(keccak_256(secp.getPublicKey(KEY.slice(2), false).slice(1)).slice(12));
const now = Math.floor(Date.now() / 1000);
const a = { from, to: acc.payTo, value: acc.maxAmountRequired, validAfter: String(now - 60), validBefore: String(now + 60), nonce: hex(crypto.getRandomValues(new Uint8Array(32))) };
const domain = keccak_256(bytes(hex(kt("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")) + hex(kt("USDC")).slice(2) + hex(kt("2")).slice(2) + num(5042n) + pad(acc.asset)));
const struct = keccak_256(bytes(hex(kt("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")) + pad(a.from) + pad(a.to) + num(a.value) + num(a.validAfter) + num(a.validBefore) + pad(a.nonce)));
const sig = await secp.signAsync(keccak_256(new Uint8Array([0x19, 0x01, ...domain, ...struct])), KEY.slice(2), { lowS: true });
const payment = { x402Version: 1, scheme: "exact", network: acc.network, payload: { signature: hex(sig.toBytes()) + (27 + sig.recovery).toString(16), authorization: a } };

const r2 = await fetch(url, { headers: { "X-PAYMENT": btoa(JSON.stringify(payment)) } });   // 200 + data
console.log(await r2.json());`}</pre>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 10 }}>
          Arc network entry for x402 client libraries: <code>{`{ network: "eip155:5042", chainId: 5042, usdc: "0x3600000000000000000000000000000000000000", usdcName: "USDC", usdcVersion: "2", decimals: 6 }`}</code>.
          Full reference: <code>scripts/x402_e2e.ts</code> in the public repo. Stats: <a href="https://bot-production-4200.up.railway.app/api/x402/stats" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">/api/x402/stats</a>.
        </p>
      </div>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 14 }}>
        Fair use: the price you see in the 402 is the price you pay; nothing is charged for a 402, a 4xx, or an upstream error. If a payment cannot be settled (the balance moved after you signed), that address is switched to settle-first mode for 24 h and nothing else happens.
      </p>
    </>
  );
}
