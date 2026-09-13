import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { Tags, useWalletLabels } from "@/components/risk";
import { insiderBoard, type InsiderRow } from "@/lib/arcpad";
import { ARCT, VAULT, connectWallet, ethCall, fmt, onWalletChange, p32 } from "@/lib/arc-wallet";
import "../arc-site.css";

export const Route = createFileRoute("/insiders")({
  loader: async () => {
    try {
      return { rows: await insiderBoard({ data: { range: "30d" } }) };
    } catch {
      return { rows: [] as InsiderRow[] };
    }
  },
  head: () => ({
    meta: [
      { title: "Arc Insiders: the smart-money leaderboard" },
      {
        name: "description",
        content:
          "The most profitable wallets on Arc, ranked by on-chain PnL across every launchpad and DEX. Copy their trades in one tap. Full board unlocks for ARCT stakers.",
      },
    ],
  }),
  component: InsidersPage,
});

const GATE_ARCT = 10_000; // wymagany stake ARCT na pelny leaderboard
const STAKED_SEL = "0x98807d84"; // staked(address)

const RANGES = ["7d", "30d", "all"] as const;
type Range = (typeof RANGES)[number];

function ago(ts: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function InsidersPage() {
  const initial = Route.useLoaderData();
  const [range, setRange] = useState<Range>("30d");
  const [rows, setRows] = useState<InsiderRow[]>(initial?.rows ?? []);
  const labels = useWalletLabels(rows.slice(0, 60).map((r) => r.wallet));
  const [loaded, setLoaded] = useState((initial?.rows?.length ?? 0) > 0);
  const [wallet, setWallet] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const checkGate = async (addr: string | null) => {
    if (!addr) {
      setUnlocked(false);
      return;
    }
    try {
      const r = await ethCall(VAULT, STAKED_SEL + p32(addr));
      const staked = r && r !== "0x" ? Number(BigInt(r) / 10n ** 12n) / 1e6 : 0;
      setUnlocked(staked >= GATE_ARCT);
    } catch {
      setUnlocked(false);
    }
  };

  useEffect(() => {
    let w: string | null = null;
    try {
      w = localStorage.getItem("arctools_wallet");
    } catch { /* ignore */ }
    setWallet(w);
    void checkGate(w);
    return onWalletChange((a) => {
      setWallet(a);
      void checkGate(a);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await insiderBoard({ data: { range } });
        if (alive) {
          setRows(r);
          setLoaded(true);
        }
      } catch { /* next tick */ }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [range]);

  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/insiders" />
      <section className="arc-section" style={{ maxWidth: 980, paddingTop: 130 }}>
        <p className="arc-eyebrow">Smart money</p>
        <h1 className="arc-h2">Arc Insiders</h1>
        <p className="arc-body">
          The most profitable wallets on Arc, ranked by real on-chain PnL across every launchpad and DEX. Watch what
          they buy — or copy them automatically in the sniper. Positions 4-100 unlock when you stake{" "}
          <span className="arc-mono">{GATE_ARCT.toLocaleString()} $ARCT</span> on{" "}
          <a href="/rewards" style={{ color: "var(--arc-cobalt)" }}>/rewards</a>.
        </p>

        <a
          href="https://t.me/ArcToolsInsiders"
          target="_blank"
          rel="noreferrer"
          className="arc-mono"
          style={{
            alignItems: "center",
            border: "1px solid var(--arc-cobalt)",
            borderRadius: 8,
            color: "var(--arc-cobalt)",
            display: "inline-flex",
            fontSize: 12,
            gap: 10,
            marginTop: 16,
            padding: "9px 14px",
            textDecoration: "none",
          }}
        >
          <span style={{ background: "#22c55e", borderRadius: 999, display: "inline-block", height: 8, width: 8 }} />
          LIVE ALERTS: every buy and sell of the top-100 insiders, seconds after the block — t.me/ArcToolsInsiders ↗
        </a>

        <div className="arc-mono" style={{ display: "flex", gap: 12, margin: "22px 0 10px" }}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                background: range === r ? "var(--arc-cobalt)" : "transparent",
                border: "1px solid var(--arc-line)",
                color: range === r ? "var(--arc-on-accent)" : "var(--arc-muted)",
                cursor: "pointer", fontSize: 12, padding: "6px 14px", textTransform: "uppercase",
              }}
              type="button"
            >
              {r}
            </button>
          ))}
          {!unlocked && (
            <button
              className="arc-mono"
              onClick={() => void connectWallet().then((a) => { setWallet(a); void checkGate(a); })}
              style={{ background: "transparent", border: "1px solid var(--arc-cobalt)", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 12, marginLeft: "auto", padding: "6px 14px" }}
              type="button"
            >
              {wallet ? "🔒 Stake to unlock" : "Connect to unlock"}
            </button>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--arc-line)" }}>
          {rows.map((r, i) => {
            const gated = !unlocked && i >= 3;
            return (
              <div
                key={r.wallet}
                style={{
                  alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex",
                  filter: gated ? "blur(6px)" : "none", gap: 14, padding: "12px 4px",
                  pointerEvents: gated ? "none" : "auto", userSelect: gated ? "none" : "auto",
                }}
              >
                <span className="arc-mono" style={{ fontSize: 14, width: 34 }}>{medal(i)}</span>
                <a
                  className="arc-mono"
                  href={`https://arc-scan.org/address/${r.wallet}`}
                  rel="noreferrer"
                  style={{ color: "var(--arc-ink)", fontSize: 13, textDecoration: "none", width: 130 }}
                  target="_blank"
                >
                  {r.wallet.slice(0, 6)}…{r.wallet.slice(-4)}
                </a>
                <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 2, maxWidth: 170 }}><Tags labels={labels} max={2} wallet={r.wallet} /></span>
                <span style={{ width: 118 }}>
                  <span className="arc-mono" style={{ color: r.pnl_total >= 0 ? "var(--arc-up)" : "var(--arc-error)", display: "block", fontSize: 14 }}>
                    {r.pnl_total >= 0 ? "+" : "−"}${fmt(Math.abs(r.pnl_total))}
                  </span>
                  <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>
                    {r.pnl_pct >= 0 ? "+" : ""}{r.pnl_pct.toFixed(0)}% ROI
                  </span>
                </span>
                <span style={{ width: 96 }}>
                  <span className="arc-mono" style={{ color: "var(--arc-muted)", display: "block", fontSize: 11 }}>
                    real ${fmt(r.pnl_realized ?? 0)}
                  </span>
                  <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
                    open ${fmt(r.pnl_unrealized ?? 0)}
                  </span>
                </span>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, width: 72 }}>
                  {r.winrate.toFixed(0)}% win
                </span>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, width: 108 }}>
                  {r.closed}C / {r.open_positions ?? 0}O · {r.trades}tx
                </span>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", flex: 1, fontSize: 12, minWidth: 88 }}>
                  V ${fmt(r.volume)}
                  {r.best_symbol && r.best_symbol !== "?" ? ` · ${r.best_symbol}` : ""}
                </span>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, width: 36 }}>{ago(r.last_trade)}</span>
                <a className="arc-mono" href={`/wallets?add=${r.wallet}`} style={{ border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", fontSize: 11, padding: "6px 9px", textDecoration: "none" }} title="Open positions, last trades, live feed, Telegram alerts">watch</a>
                <a
                  className="arc-cta"
                  href={`https://t.me/ArcSniper_bot?start=copy_${r.wallet.slice(2)}`}
                  rel="noreferrer"
                  style={{ fontSize: 12, padding: "7px 14px", textDecoration: "none" }}
                  target="_blank"
                >
                  Copy
                </a>
              </div>
            );
          })}
          {loaded && rows.length === 0 && (
            <p className="arc-mono" style={{ fontSize: 13, padding: "18px 0" }}>
              Ranking is being computed from on-chain history — check back in a few minutes.
            </p>
          )}
          {!loaded && (
            <p className="arc-mono" style={{ fontSize: 13, padding: "18px 0" }}>Loading the board...</p>
          )}
        </div>

        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 16 }}>
          PnL = realized (avg-cost) + unrealized at the latest on-chain price. Wallets need ≥3 closed positions and
          ≥$200 volume to rank; bots and infrastructure addresses are filtered out. Copy = mirror this wallet's buys
          from your own sniper wallet (1% service fee per trade).
        </p>
      </section>
    </main>
  );
}
