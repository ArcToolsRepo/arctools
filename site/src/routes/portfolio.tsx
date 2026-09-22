import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { getPortfolio, type Holding } from "@/lib/arc-api";
import "../arc-site.css";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Arc portfolio: every holding valued in USDC" },
      {
        name: "description",
        content:
          "Paste any Arc wallet and see its USDC balance and token holdings valued live through the Uniswap V3 quoter.",
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
  component: PortfolioPage,
});

function PortfolioPage() {
  const [wallet, setWallet] = useState("");
  // deep link from Intel / Insiders / the bots: /portfolio?w=0x… loads that wallet straight away
  const autoRan = useRef(false);
  const [hidden, setHidden] = useState(0);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [usdc, setUsdc] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(0);
  const STEPS = ["reading USDC balance", "scanning launchpad curves", "scanning Uniswap V3 / V4 pools", "reading token balances", "pricing everything in USDC"];

  // autofill from the connected wallet (Connect wallet in the nav)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("arctools_wallet");
      if (saved) setWallet(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const run = async (override?: string) => {
    const addr = (override ?? wallet).trim();
    if (!addr) return;
    setBusy(true);
    setError(null);
    setHoldings(null);
    // progress feedback: the read walks every pool + balance on-chain (10-40 s when the relay is slow)
    setProgress(2);
    const t0 = Date.now();
    const tick = setInterval(() => setProgress((p) => Math.min(92, p + Math.max(0.4, (92 - p) * 0.06))), 400);
    const stepTimer = setInterval(() => setStep((i) => Math.min(STEPS.length - 1, i + 1)), 3500);
    let res: Awaited<ReturnType<typeof getPortfolio>>;
    try {
      res = await getPortfolio({ data: { wallet: addr } });
      clearInterval(tick); clearInterval(stepTimer); setProgress(100); setTimeout(() => setProgress(0), 600);
      void t0;
    } catch {
      clearInterval(tick); clearInterval(stepTimer); setProgress(0);
      setBusy(false);
      setError("The read timed out (RPC congestion). Try again in a few seconds.");
      return;
    }
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    // dust (< $1) is hidden, counted, never valued into "total" differently — it is still in res.total
    setHidden(res.holdings.filter((h) => (h.valueUsdc ?? 0) < 1).length);
    setHoldings(res.holdings.filter((h) => (h.valueUsdc ?? 0) >= 1));
    setUsdc(res.usdc);
    setTotal(res.total);
  };


  useEffect(() => {

    if (autoRan.current) return;

    const w = new URLSearchParams(window.location.search).get("w");

    if (!w || !/^0x[0-9a-fA-F]{40}$/.test(w)) return;

    autoRan.current = true;

    setWallet(w);

    void run(w);

  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/portfolio" />
      <section className="arc-section" style={{ maxWidth: 760, paddingTop: 130 }}>
        <p className="arc-eyebrow">Everything in dollars</p>
        <h1 className="arc-h2">Portfolio, valued live</h1>
        <p className="arc-body">
          Arc settles in USDC, so a portfolio reads instantly. Paste any wallet: native USDC plus every token it
          holds, valued through the live V3 quoter.
        </p>

        <div style={{ display: "flex", gap: 12, margin: "26px 0" }}>
          <input
            className="arc-mono"
            onChange={(e) => setWallet(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run()}
            placeholder="0x… wallet address"
            style={{ background: "transparent", border: "1px solid var(--arc-line)", flex: 1, fontSize: 14, padding: "12px 14px" }}
            value={wallet}
          />
          <button
            className="arc-cta"
            disabled={busy}
            onClick={() => void run()}
            style={{ border: "none", cursor: busy ? "wait" : "pointer" }}
            type="button"
          >
            {busy ? "Reading..." : "Check"}
          </button>
        </div>

        {busy && (
          <div style={{ margin: "14px 0 4px" }}>
            <div style={{ background: "var(--arc-line)", borderRadius: 3, height: 4, overflow: "hidden" }}>
              <div style={{ background: "linear-gradient(90deg, var(--arc-cobalt), #7cc4ff)", height: "100%", transition: "width 0.4s ease", width: `${progress}%` }} />
            </div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "6px 0 0" }}>
              {STEPS[step]}… this walks every pool and balance on-chain, usually 10–30 s. Results are cached for a minute afterwards.
            </p>
          </div>
        )}
        {error && (
          <p className="arc-mono" style={{ color: "var(--arc-error)", fontSize: 13 }}>
            {error}
          </p>
        )}

        {holdings !== null && (
          <div style={{ border: "1px solid var(--arc-line)", padding: 24 }}>
            <div style={{ display: "flex", gap: 26, marginBottom: 16 }}>
              <div>
                <p className="arc-eyebrow" style={{ marginBottom: 4 }}>Total</p>
                <strong style={{ fontSize: 30 }}>{total.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC</strong>
              </div>
              <div>
                <p className="arc-eyebrow" style={{ marginBottom: 4 }}>Native USDC</p>
                <strong style={{ fontSize: 30 }}>{usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--arc-line)" }}>
              {holdings.map((h) => (
                <div
                  key={h.token}
                  style={{
                    alignItems: "center",
                    borderBottom: "1px solid var(--arc-line)",
                    display: "flex",
                    gap: 14,
                    justifyContent: "space-between",
                    padding: "12px 0",
                  }}
                >
                  <div>
                    <strong>{h.symbol}</strong>
                    <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, marginLeft: 10 }}>
                      {h.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens
                    </span>
                  </div>
                  <span className="arc-mono" style={{ fontSize: 13 }}>
                    {h.valueUsdc === null ? "" : `${h.valueUsdc.toFixed(2)} USDC`}
                  </span>
                </div>
              ))}
              {hidden > 0 && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "8px 0 0" }}>{hidden} holding{hidden > 1 ? "s" : ""} under $1 hidden</p>}
              {holdings.length === 0 && (
                <p className="arc-mono" style={{ fontSize: 13, padding: "14px 0" }}>
                  No tokens found in this wallet.
                </p>
              )}
            </div>
            <p className="arc-body" style={{ fontSize: 13, marginTop: 14 }}>
              Every ERC-20 the wallet holds (arc-scan index), valued live through the V3 quoter; tokens without a USDC
              pool show no value. For live PnL on your own snipes, the bot tracks entries and exits per position.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
