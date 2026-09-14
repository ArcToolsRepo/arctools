import { createFileRoute, Link } from "@tanstack/react-router";
import { BOT_API } from "@/lib/bot-api";
import { useEffect, useMemo, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { QuickBuy } from "@/components/quick-buy";
import { Tags, useWalletLabels } from "@/components/risk";
import "../arc-site.css";

const API = BOT_API;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(Math.abs(v) >= 100 ? 0 : 2)}`);
const signed = (v: number) => (v >= 0 ? "+" : "−") + usd(Math.abs(v));
const ago = (ts: number) => { const s = Math.max(0, Date.now() / 1000 - ts); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`; };

type Stat = { range: string; pnl_realized: number; pnl_unrealized: number; pnl_total: number; pnl_pct: number; winrate: number; trades: number; closed: number; volume: number; best_symbol: string | null; best_token: string | null; best_pnl: number; last_trade: number; open_positions: number };
type Trade = { tx: string; ts: number; token: string; side: "buy" | "sell"; usdc: number; tokens: number; price1m: number; venue: string; symbol?: string | null };
type Position = { token: string; symbol: string | null; bought: number; sold: number; cost: number; proceeds: number; n: number; last_ts: number; price: number; value: number; unrealized: number; realized: number; net: number; avg: number };

export const Route = createFileRoute("/insider/$wallet")({
  head: ({ params }) => ({ meta: [{ title: `Insider ${short(params.wallet)} · ArcTools` }, { name: "description", content: "Real on-chain PnL, open positions, trade history and co-traded tokens of one Arc wallet." }] }),
  component: InsiderPage,
});

function InsiderPage() {
  const { wallet } = Route.useParams();
  const w = wallet.toLowerCase();
  const [stats, setStats] = useState<Stat[] | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [range, setRange] = useState<"30d" | "all">("30d");
  const labels = useWalletLabels([w]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`${API}/api/insider/${w}`).then((r) => r.json()).then((j) => { if (!alive) return; setStats(j.stats ?? []); setTrades(j.trades ?? []); }).catch(() => alive && setStats([]));
      fetch(`${API}/api/positions?wallet=${w}`).then((r) => r.json()).then((j) => alive && setPositions((j.positions ?? j.rows ?? j) as Position[])).catch(() => alive && setPositions([]));
      fetch(`${API}/api/insiders?range=30d`).then((r) => r.json()).then((j) => { if (!alive) return; const i = (j.rows ?? []).findIndex((r: { wallet: string }) => r.wallet.toLowerCase() === w); setRank(i >= 0 ? i + 1 : null); }).catch(() => null);
    };
    load();
    const id = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [w]);

  // not ranked (too few closed trades / volume) → derive the headline numbers from the live positions so the cards are never empty
  const derived = useMemo<Stat | null>(() => {
    if (!positions || positions.length === 0) return null;
    const closed = positions.filter((p) => p.value <= 1 && p.n > 0);
    const wins = closed.filter((p) => p.realized > 0).length;
    const best = [...positions].sort((a, b) => (b.realized + b.unrealized) - (a.realized + a.unrealized))[0];
    const cost = positions.reduce((s, p) => s + p.cost, 0);
    const realized = positions.reduce((s, p) => s + p.realized, 0);
    const unrealized = positions.reduce((s, p) => s + p.unrealized, 0);
    return { range: "live", pnl_realized: realized, pnl_unrealized: unrealized, pnl_total: realized + unrealized, pnl_pct: cost > 0 ? ((realized + unrealized) / cost) * 100 : 0,
      winrate: closed.length ? (wins / closed.length) * 100 : 0, trades: positions.reduce((s, p) => s + p.n, 0), closed: closed.length, volume: positions.reduce((s, p) => s + p.cost + p.proceeds, 0),
      best_symbol: best?.symbol ?? null, best_token: best?.token ?? null, best_pnl: best ? best.realized + best.unrealized : 0, last_trade: Math.max(0, ...positions.map((p) => p.last_ts)), open_positions: positions.filter((p) => p.value > 1).length };
  }, [positions]);
  const st = useMemo(() => stats?.find((x) => x.range === range) ?? stats?.[0] ?? derived, [stats, range, derived]);
  const open = useMemo(() => (positions ?? []).filter((p) => p.value > 1).sort((a, b) => b.value - a.value), [positions]);
  const closed = useMemo(() => (positions ?? []).filter((p) => p.value <= 1 && p.n > 0).sort((a, b) => b.realized - a.realized), [positions]);
  // what this wallet trades most: token → number of trades + net USD
  const symOf = useMemo(() => { const m = new Map<string, string>(); for (const p of positions ?? []) if (p.symbol) m.set(p.token.toLowerCase(), p.symbol); return m; }, [positions]);
  const byToken = useMemo(() => {
    const m = new Map<string, { symbol: string | null; n: number; net: number; last: number }>();
    for (const t of trades) { const k = t.token.toLowerCase(); const c = m.get(k) ?? { symbol: t.symbol ?? symOf.get(k) ?? null, n: 0, net: 0, last: 0 }; c.n++; c.net += t.side === "buy" ? -t.usdc : t.usdc; c.last = Math.max(c.last, t.ts); m.set(k, c); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }, [trades, symOf]);
  const Cell = ({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) => (
    <div style={{ border: "1px solid var(--arc-line)", padding: "10px 12px" }}>
      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10.5, letterSpacing: "0.08em" }}>{k}</div>
      <div className="arc-mono" style={{ color: tone === "up" ? "var(--arc-up)" : tone === "down" ? "#f0534f" : "var(--arc-ink)", fontSize: 18, fontWeight: 700, marginTop: 3 }}>{v}</div>
    </div>
  );
  const th: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 11, fontWeight: 400, padding: "6px 8px", textAlign: "left" };
  const td: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 12.5, padding: "7px 8px", whiteSpace: "nowrap" };

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/insiders" />
      <section className="arc-section" style={{ maxWidth: 1180, paddingTop: 118 }}>
        <Link className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, textDecoration: "none" }} to="/insiders">← Insiders board</Link>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
          <h1 className="arc-mono" style={{ fontSize: 24, margin: 0 }}>{short(w)}</h1>
          {rank && <span className="arc-mono" style={{ background: "rgba(46,124,255,0.18)", border: "1px solid var(--arc-cobalt)", borderRadius: 5, color: "var(--arc-cobalt)", fontSize: 12, padding: "2px 8px" }}>insider #{rank} · 30d</span>}
          <Tags labels={labels} max={4} wallet={w} />
          <span style={{ flex: 1 }} />
          <a className="arc-mono" href={`https://arc-scan.org/address/${w}`} rel="noreferrer" style={{ border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", fontSize: 12, padding: "6px 10px", textDecoration: "none" }} target="_blank">explorer ↗</a>
          <Link className="arc-mono" search={{ add: w } as never} style={{ border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-ink)", fontSize: 12, padding: "6px 10px", textDecoration: "none" }} to="/wallets">watch (live feed + TG alerts)</Link>
          <a className="arc-cta" href={`https://t.me/ArcSniper_bot?start=copy_${w.slice(2)}`} rel="noreferrer" style={{ fontSize: 12, padding: "7px 14px", textDecoration: "none" }} target="_blank">Copy-trade</a>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
          {(["30d", "all"] as const).map((r) => <button key={r} className="arc-mono" onClick={() => setRange(r)} style={{ background: range === r ? "rgba(255,255,255,0.08)" : "transparent", border: "1px solid " + (range === r ? "var(--arc-line)" : "transparent"), borderRadius: 4, color: range === r ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "4px 10px" }}>{r.toUpperCase()}</button>)}
        </div>
        <div className="arc-grid-3" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 8 }}>
          <Cell k="PNL TOTAL" tone={st ? (st.pnl_total >= 0 ? "up" : "down") : undefined} v={st ? signed(st.pnl_total) : "—"} />
          <Cell k="REALIZED" tone={st ? (st.pnl_realized >= 0 ? "up" : "down") : undefined} v={st ? signed(st.pnl_realized) : "—"} />
          <Cell k="UNREALIZED" tone={st ? (st.pnl_unrealized >= 0 ? "up" : "down") : undefined} v={st ? signed(st.pnl_unrealized) : "—"} />
          <Cell k="ROI" tone={st ? (st.pnl_pct >= 0 ? "up" : "down") : undefined} v={st ? `${st.pnl_pct >= 0 ? "+" : ""}${st.pnl_pct.toFixed(0)}%` : "—"} />
          <Cell k="WIN RATE" v={st ? `${st.winrate.toFixed(0)}% · ${st.closed} closed` : "—"} />
          <Cell k="VOLUME" v={st ? `${usd(st.volume)} · ${st.trades} tx` : "—"} />
          <Cell k="BEST TRADE" tone="up" v={st?.best_symbol ? `${st.best_symbol} ${signed(st.best_pnl)}` : "—"} />
          <Cell k="LAST TRADE" v={st?.last_trade ? `${ago(st.last_trade)} ago` : "—"} />
        </div>
        {stats && stats.length === 0 && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, marginTop: 10 }}>Not on the leaderboard yet (fewer than 3 closed trades or under $200 volume) — numbers above are computed live from this wallet\u2019s open and closed positions.</p>}

        <div className="arc-2col" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", marginTop: 20 }}>
          <div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em", marginBottom: 6 }}>OPEN POSITIONS ({open.length})</div>
            <div className="arc-scroll" style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>token</th><th style={th}>value</th><th style={th}>unrealized</th><th style={th}>realized</th><th style={th}>avg → now</th><th style={th}>last</th><th style={th} /></tr></thead>
                <tbody>
                  {open.map((p) => (
                    <tr key={p.token}>
                      <td style={td}><a href={`/token/${p.token}`} style={{ color: "var(--arc-ink)", fontWeight: 700 }}>{p.symbol ?? short(p.token)}</a></td>
                      <td className="arc-mono" style={td}>{usd(p.value)}</td>
                      <td className="arc-mono" style={{ ...td, color: p.unrealized >= 0 ? "var(--arc-up)" : "#f0534f" }}>{signed(p.unrealized)}</td>
                      <td className="arc-mono" style={{ ...td, color: p.realized >= 0 ? "var(--arc-up)" : "#f0534f" }}>{signed(p.realized)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>${p.avg.toFixed(6)} → ${p.price.toFixed(6)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(p.last_ts)}</td>
                      <td style={td}><QuickBuy compact symbol={p.symbol ?? short(p.token)} token={p.token} /></td>
                    </tr>
                  ))}
                  {positions && open.length === 0 && <tr><td className="arc-mono" colSpan={7} style={{ ...td, color: "var(--arc-muted)" }}>No open positions.</td></tr>}
                  {!positions && <tr><td className="arc-mono" colSpan={7} style={{ ...td, color: "var(--arc-muted)" }}>…</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em", margin: "18px 0 6px" }}>CLOSED (top by realized)</div>
            <div className="arc-scroll" style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>token</th><th style={th}>realized</th><th style={th}>cost → proceeds</th><th style={th}>trades</th><th style={th}>last</th></tr></thead>
                <tbody>
                  {closed.slice(0, 12).map((p) => (
                    <tr key={p.token}>
                      <td style={td}><a href={`/token/${p.token}`} style={{ color: "var(--arc-ink)" }}>{p.symbol ?? short(p.token)}</a></td>
                      <td className="arc-mono" style={{ ...td, color: p.realized >= 0 ? "var(--arc-up)" : "#f0534f", fontWeight: 700 }}>{signed(p.realized)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{usd(p.cost)} → {usd(p.proceeds)}</td>
                      <td className="arc-mono" style={td}>{p.n}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(p.last_ts)}</td>
                    </tr>
                  ))}
                  {positions && closed.length === 0 && <tr><td className="arc-mono" colSpan={5} style={{ ...td, color: "var(--arc-muted)" }}>Nothing closed yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em", marginBottom: 6 }}>MOST TRADED</div>
            <div style={{ border: "1px solid var(--arc-line)", padding: "4px 10px" }}>
              {byToken.map(([t, c]) => (
                <div key={t} style={{ alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex", fontSize: 12.5, gap: 8, padding: "7px 0" }}>
                  <a href={`/token/${t}`} style={{ color: "var(--arc-ink)", fontWeight: 700, minWidth: 90 }}>{c.symbol ?? short(t)}</a>
                  <span className="arc-mono" style={{ color: "var(--arc-muted)" }}>{c.n} tx</span>
                  <span style={{ flex: 1 }} />
                  <span className="arc-mono" style={{ color: c.net >= 0 ? "var(--arc-up)" : "#f0534f" }} title="net USDC taken out (+) or put in (−) across the visible trades">{signed(c.net)}</span>
                  <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>{ago(c.last)}</span>
                </div>
              ))}
              {trades.length === 0 && <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "8px 0" }}>{stats ? "No indexed trades." : "…"}</div>}
            </div>
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em", margin: "18px 0 6px" }}>LAST TRADES</div>
            <div style={{ maxHeight: 520, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>side</th><th style={th}>USDC</th><th style={th}>token</th><th style={th}>venue</th><th style={th} /></tr></thead>
                <tbody>
                  {trades.slice(0, 80).map((t) => (
                    <tr key={t.tx + t.ts}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(t.ts)}</td>
                      <td className="arc-mono" style={{ ...td, color: t.side === "buy" ? "var(--arc-up)" : "#f0534f" }}>{t.side.toUpperCase()}</td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(t.usdc)}</td>
                      <td style={td}><a href={`/token/${t.token}`} style={{ color: "var(--arc-ink)" }}>{t.symbol ?? symOf.get(t.token.toLowerCase()) ?? short(t.token)}</a></td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{t.venue}</td>
                      <td style={td}><a href={`https://arc-scan.org/tx/${t.tx}`} rel="noreferrer" style={{ color: "var(--arc-muted)" }} target="_blank">↗</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
