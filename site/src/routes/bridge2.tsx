import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { DsRail } from "@/components/ds-rail";
import "../arc-site.css";

export const Route = createFileRoute("/bridge2")({
  head: () => ({
    meta: [
      { title: "Bridge USDC to Arc: ArcTools" },
      {
        name: "description",
        content:
          "Move native USDC from Ethereum, Base or Arbitrum to Arc with Circle CCTP v2. Burn on the source chain, mint on Arc, same address.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: BridgePage,
});

/** Server-side attestation poll (avoids browser CORS against Circle Iris). */
const getAttestation = createServerFn({ method: "POST" })
  .inputValidator((input: { domain: number; txHash: string }) => input)
  .handler(async ({ data }) => {
    const url = `https://iris-api.circle.com/v2/messages/${data.domain}?transactionHash=${data.txHash}`;
    const res = await fetch(url);
    if (!res.ok) return { status: "pending" as const };
    const json = (await res.json()) as {
      messages?: { status?: string; message?: string; attestation?: string }[];
    };
    const m = json.messages?.[0];
    if (m?.status === "complete" && m.message && m.attestation) {
      return { status: "complete" as const, message: m.message, attestation: m.attestation };
    }
    return { status: "pending" as const };
  });

// ---- chain + contract constants (CCTP v2; Arc values from docs.arc.io) ----

const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
const ARC_DOMAIN = 26;
// ArcBridgeFeeProxy: atomic receiveMessage + 2% service fee in ONE transaction.
// Mint goes to the proxy; it forwards 98% to the ORIGINAL source-chain sender
// (read from the CCTP message itself) and 2% to the fee wallet.
// v2 (16.09): points at Arc's real MessageTransmitterV2 0x81D40F21…; v1 0xA42c… had the canonical 0xE737… address, which does not exist on Arc
const BRIDGE_PROXY = "0x292DDAeD9B959Cbe4df5ac35c52da1977E29916e";

const ARC_CHAIN = {
  chainId: "0x13b2",
  chainName: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.arc-scan.org"],
  blockExplorerUrls: ["https://arc-scan.org"],
};

const SOURCES = {
  arb: {
    chain: {
      chainId: "0xa4b1",
      chainName: "Arbitrum One",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://arb1.arbitrum.io/rpc"],
      blockExplorerUrls: ["https://arbiscan.io"],
    },
    domain: 3,
    label: "Arbitrum",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  base: {
    chain: {
      chainId: "0x2105",
      chainName: "Base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://mainnet.base.org"],
      blockExplorerUrls: ["https://basescan.org"],
    },
    domain: 6,
    label: "Base",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  eth: {
    chain: {
      chainId: "0x1",
      chainName: "Ethereum",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://eth.merkle.io"],
      blockExplorerUrls: ["https://etherscan.io"],
    },
    domain: 0,
    label: "Ethereum",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
} as const;

type SourceKey = keyof typeof SOURCES;

// ---- minimal ABI encoding helpers (fixed shapes only) ----

const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const padNum = (n: bigint) => n.toString(16).padStart(64, "0");

function encodeDepositForBurn(amount: bigint, burnToken: string): string {
  // maxFee has to be non-zero for Circle to use the FAST path: with 0 the transfer is "finalized only", which is
  // 13-19 minutes from Ethereum and several from Arbitrum — longer than any browser tab stays open. 2 bps (floor
  // 0.01 USDC) covers Circle's fast fee, which is charged out of the bridged amount.
  const maxFee = amount / 5000n > 10_000n ? amount / 5000n : 10_000n;
  return (
    "0x8e0250ee" +
    padNum(amount) +
    padNum(BigInt(ARC_DOMAIN)) +
    pad(BRIDGE_PROXY) + // mint to the fee proxy; it forwards to the sender atomically
    pad(burnToken) +
    pad(BRIDGE_PROXY) + // destinationCaller = the proxy: nobody else (e.g. a public relayer) can mint, so funds never park in the proxy
    padNum(maxFee) +
    padNum(1000n)       // 1000 = confirmed/fast; 2000 would force the slow finalized path
  );
}

function encodeBridgeReceive(message: string, attestation: string): string {
  const m = message.replace(/^0x/, "");
  const a = attestation.replace(/^0x/, "");
  const mPadded = m.padEnd(Math.ceil(m.length / 64) * 64, "0");
  const aPadded = a.padEnd(Math.ceil(a.length / 64) * 64, "0");
  const headSize = 64n;
  const offset1 = headSize;
  const offset2 = headSize + 32n + BigInt(mPadded.length / 2);
  return (
    "0xb2f22f3e" + // bridgeReceive(bytes,bytes)
    padNum(offset1) +
    padNum(offset2) +
    padNum(BigInt(m.length / 2)) +
    mPadded +
    padNum(BigInt(a.length / 2)) +
    aPadded
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Eip1193 = { request: (args: { method: string; params?: any[] | object }) => Promise<any> };

function getEth(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((window as any).ethereum as Eip1193 | undefined) ?? null;
}

type AddChain = {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: readonly string[];
  blockExplorerUrls: readonly string[];
};

async function switchChain(eth: Eip1193, chain: AddChain) {
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  } catch {
    await eth.request({ method: "wallet_addEthereumChain", params: [chain] });
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  }
}

async function waitForReceipt(eth: Eip1193, txHash: string): Promise<void> {
  for (let i = 0; i < 240; i++) {
    const r = await eth.request({ method: "eth_getTransactionReceipt", params: [txHash] });
    if (r) {
      if (r.status !== "0x1") throw new Error("transaction reverted");
      return;
    }
    await new Promise((res) => setTimeout(res, 2500));
  }
  throw new Error("timed out waiting for the transaction");
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ---- page ----

const STEPS = ["Approve USDC", "Burn on source", "Circle attestation", "Mint + 2% fee (one tx)"] as const;

function BridgePage() {
  const [account, setAccount] = useState<string | null>(null);
  const [source, setSource] = useState<SourceKey>("base");
  const [amount, setAmount] = useState("100");
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setError(null);
    const eth = getEth();
    if (!eth) {
      setError("No wallet found. Open this page in a browser with MetaMask or a compatible wallet.");
      return;
    }
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    setAccount(accounts[0] ?? null);
  };

  const bridge = async () => {
    const eth = getEth();
    if (!eth || !account) return;
    const src = SOURCES[source];
    const units = BigInt(Math.round(parseFloat(amount || "0") * 1e6));
    if (units <= 0n) {
      setError("Enter an amount above zero.");
      return;
    }
    setBusy(true);
    setError(null);
    setMintTx(null);
    try {
      await switchChain(eth, src.chain);

      // 1) allowance / approve
      setStep(0);
      const allowanceHex = (await eth.request({
        method: "eth_call",
        params: [
          { to: src.usdc, data: "0xdd62ed3e" + pad(account) + pad(TOKEN_MESSENGER_V2) },
          "latest",
        ],
      })) as string;
      if (BigInt(allowanceHex === "0x" ? "0x0" : allowanceHex) < units) {
        const approveTx = (await eth.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: account,
              to: src.usdc,
              data: "0x095ea7b3" + pad(TOKEN_MESSENGER_V2) + padNum(units),
            },
          ],
        })) as string;
        await waitForReceipt(eth, approveTx);
      }

      // 2) depositForBurn (mint goes to the fee proxy)
      setStep(1);
      // remembered before we even wait for the attestation, so a closed tab (or a failed mint) can be resumed
      const remember = (txh: string) => {
        try {
          localStorage.setItem("arctools_bridge_pending", JSON.stringify({ amount, domain: src.domain, src: src.label, ts: Date.now(), tx: txh }));
        } catch { /* private mode */ }
      };
      const burnTx = (await eth.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: TOKEN_MESSENGER_V2,
            data: encodeDepositForBurn(units, src.usdc),
          },
        ],
      })) as string;
      await waitForReceipt(eth, burnTx);
      remember(burnTx);           // from here the keeper can finish the transfer even if this tab closes

      // 3) attestation
      setStep(2);
      let message = "";
      let attestation = "";
      for (let i = 0; i < 200; i++) {
        const res = await getAttestation({ data: { domain: src.domain, txHash: burnTx } });
        if (res.status === "complete") {
          message = res.message;
          attestation = res.attestation;
          break;
        }
        await sleep(3000);
      }
      if (!message) throw new Error("Circle has not attested this burn yet. Your USDC is safe — our keeper finishes the transfer automatically, usually within 20 minutes. You can close this page.");

      // 4) atomic mint + fee via the proxy on Arc (one transaction)
      setStep(3);
      await switchChain(eth, ARC_CHAIN);
      const mint = (await eth.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: BRIDGE_PROXY,
            data: encodeBridgeReceive(message, attestation),
          },
        ],
      })) as string;
      await waitForReceipt(eth, mint);
      setMintTx(mint);
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "bridge failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />

      <section className="arc-dsp__body" style={{ paddingTop: 140, maxWidth: 720 }}>
        <p className="arc-eyebrow">CCTP v2 bridge</p>
        <h1 className="arc-h2">USDC in. Same address. Native.</h1>

        <p className="arc-body">
          Circle burns your USDC on the source chain and mints it natively on Arc, straight back to your address. No
          wrapped tokens, no third-party bridge. The 2% service fee is taken atomically inside the mint transaction.
        </p>

        <div style={{ border: "1px solid var(--arc-line)", padding: 28, marginTop: 36 }}>
          {!account ? (
            <button className="arc-cta" onClick={connect} style={{ border: "none", cursor: "pointer" }} type="button">
              Connect wallet
            </button>
          ) : (
            <>
              <p className="arc-mono" style={{ fontSize: 13, color: "var(--arc-muted)", margin: "0 0 18px" }}>
                {account}
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
                {(Object.keys(SOURCES) as SourceKey[]).map((k) => (
                  <button
                    className="arc-mono"
                    key={k}
                    onClick={() => setSource(k)}
                    style={{
                      background: source === k ? "var(--arc-cobalt)" : "transparent",
                      border: "1px solid " + (source === k ? "var(--arc-cobalt)" : "var(--arc-line)"),
                      color: source === k ? "var(--arc-paper)" : "var(--arc-ink)",
                      cursor: "pointer",
                      fontSize: 13,
                      padding: "10px 18px",
                    }}
                    type="button"
                  >
                    {SOURCES[k].label}
                  </button>
                ))}
              </div>
              <label className="arc-mono" htmlFor="amount" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                AMOUNT (USDC)
              </label>
              <input
                className="arc-mono"
                id="amount"
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--arc-line)",
                  fontSize: 18,
                  marginBottom: 20,
                  padding: "12px 14px",
                  width: "100%",
                }}
                value={amount}
              />
              <button
                className="arc-cta"
                disabled={busy}
                onClick={bridge}
                style={{ border: "none", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}
                type="button"
              >
                {busy ? "Bridging..." : "Bridge to Arc"}
              </button>
            </>
          )}

          {step >= 0 && (
            <ol style={{ listStyle: "none", margin: "26px 0 0", padding: 0 }}>
              {STEPS.map((s, i) => (
                <li
                  className="arc-mono"
                  key={s}
                  style={{
                    color: i < step ? "var(--arc-cobalt)" : i === step ? "var(--arc-ink)" : "var(--arc-muted)",
                    fontSize: 13,
                    padding: "6px 0",
                  }}
                >
                  {i < step ? "[done] " : i === step ? "[....] " : "[    ] "}
                  {s}
                </li>
              ))}
            </ol>
          )}
          {mintTx && (
            <p className="arc-mono" style={{ fontSize: 13, marginTop: 18 }}>
              Minted on Arc:{" "}
              <a className="arc-link-dotted" href={`https://arc-scan.org/tx/${mintTx}`} rel="noreferrer" target="_blank">
                view the transaction
              </a>
            </p>
          )}
          {error && (
            <p className="arc-mono" style={{ color: "var(--arc-error)", fontSize: 13, marginTop: 18 }}>
              {error}
            </p>
          )}
        </div>

        <p className="arc-body" style={{ fontSize: 14, marginTop: 22 }}>
          Prefer Telegram? The same bridge runs inside the bot: create a wallet, tap Bridge, pick a chain. Your USDC
          lands ready to snipe.
        </p>
      </section>
    </main>
  );
}
