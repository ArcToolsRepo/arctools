import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import "../arc-site.css";

const API = "https://bot-production-4200.up.railway.app";
const BOT = "https://t.me/ArcToolsBuyBot";
const SNIPER = "https://t.me/ArcSniper_bot";

type Whale = { tx: string; ts: number; wallet: string; token: string; side: string; usdc: number; tokens: number; price1m: number | null; venue: string; symbol: string | null; rank: number | null };
type Mover = { token: string; n: number; vol: number; p0: number; p1: number; chg: number; symbol: string | null };
type Bridge = { in24: number; out24: number; n_in24: number; wallets_in24: number; net24: number; latest: { tx: string; ts: number; recipient: string; amount: number; source: string | null; direction: string }[] };
type Insider = { tx: string; ts: number; wallet: string; token: string; side: string; usdc: number; symbol: string | null; rank: number; pnl_total: number; winrate: number };

export const Route = createFileRoute("/intel")({
  head: () => ({
    meta: [
      { title: "Arc Intel: whales, movers, insiders and bridge flows, live" },
      { content: "On-chain intelligence for Arc in one screen: whale swaps, top movers, insider trades, capital bridging in, and wallet watchlists with Telegram alerts.", name: "description" },
    ],
  }),
  component: Intel,
});

const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (ts: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const price = (p1m: number | null) => {
  if (!p1m) return "—";
  const p = p1m / 1e6;
  return p >= 1 ? `$${p.toFixed(4)}` : `$${p.toFixed(Math.max(2, -Math.floor(Math.log10(p)) + 3))}`;
};

function useApi<T>(path: string, every: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API}${path}`).then((r) => r.json()).then((j) => alive && setData(j)).catch(() => null);
    void load();
    const id = setInterval(load, every);
    return () => { alive = false; clearInterval(id); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

const card: React.CSSProperties = { background: "var(--arc-paper)", border: "1px solid var(--arc-line)", padding: 16 };
const th: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 10, fontWeight: 400, padding: "0 6px 6px 0", textAlign: "left", textTransform: "uppercase" };
const td: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 12, padding: "6px 6px 6px 0", whiteSpace: "nowrap" };

function Intel() {
  const [whaleMin, setWhaleMin] = useState(250);
  const [whaleWin, setWhaleWin] = useState(60);
  const [moverWin, setMoverWin] = useState(60);
  const whales = useApi<{ rows: Whale[] }>(`/api/whales?minutes=${whaleWin}&min_usd=${whaleMin}&limit=60`, 10_000, [whaleWin, whaleMin]);
  const movers = useApi<{ rows: Mover[] }>(`/api/movers?minutes=${moverWin}`, 30_000, [moverWin]);
  const bridge = useApi<Bridge>("/api/bridge", 30_000);
  const insiders = useApi<{ rows: Insider[] }>("/api/insider-activity?limit=40", 15_000);
  const [w, setW] = useState("");
  const [prof, setProf] = useState<{ stats: { range: string; pnl_total: number; winrate: number; closed: number; volume: number }[]; trades: { ts: number; token: string; side: string; usdc: number }[] } | null>(null);
  const [watchers, setWatchers] = useState<number | null>(null);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(w.trim());
  useEffect(() => {
    if (!valid) { setProf(null); setWatchers(null); return; }
    const a = w.trim().toLowerCase();
    fetch(`${API}/api/insider/${a}`).then((r) => r.json()).then(setProf).catch(() => setProf(null));
    fetch(`${API}/api/watchers?wallet=${a}`).then((r) => r.json()).then((j) => setWatchers(j.watchers ?? 0)).catch(() => null);
  }, [w, valid]);

  const whaleVol = useMemo(() => (whales?.rows ?? []).reduce((s, r) => s + r.usdc, 0), [whales]);
  const buys = useMemo(() => (whales?.rows ?? []).filter((r) => r.side === "buy").reduce((s, r) => s + r.usdc, 0), [whales]);

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/intel" />
      <section className="arc-section" style={{ maxWidth: 1240, paddingTop: 130 }}>
        <p className="arc-eyebrow">On-chain intelligence</p>
        <h1 className="arc-h2">Arc Intel</h1>
        <p className="arc-body">
          Everything the chain-wide index sees, on one screen: the largest swaps as they land, tokens moving hardest,
          what the top-100 wallets are doing, capital crossing the bridge, and any wallet you want watched with a Telegram DM on every trade.
        </p>

        {/* KPI strip */}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", margin: "22px 0" }}>
          {[
            [`Whale volume ${whaleWin}m`, usd(whaleVol)],
            [`Whale buy share`, whaleVol > 0 ? `${Math.round((buys / whaleVol) * 100)}%` : "—"],
            ["Bridge in 24h", bridge ? usd(bridge.in24) : "—"],
            ["Bridge net 24h", bridge ? `${bridge.net24 >= 0 ? "+" : "−"}${usd(Math.abs(bridge.net24))}` : "—"],
            ["Wallets bridged in", bridge ? String(bridge.wallets_in24) : "—"],
          ].map(([k, v]) => (
            <div key={k} style={card}>
              <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: 0 }}>{k.toUpperCase()}</p>
              <p className="arc-mono" style={{ fontSize: 22, margin: "6px 0 0" }}>{v}</p>
            </div>
          ))}
        </div>

        {/* watch a wallet */}
        <div style={{ ...card, marginBottom: 18 }}>
          <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 11, margin: "0 0 8px" }}>WATCH A WALLET</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <input className="arc-mono" onChange={(e) => setW(e.target.value)} placeholder="0x… any wallet on Arc" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 320px", fontSize: 13, padding: "9px 12px" }} value={w} />
            <a className="arc-cta" href={valid ? `${BOT}?start=watch_${w.trim().slice(2).toLowerCase()}` : undefined} rel="noreferrer" style={{ opacity: valid ? 1 : 0.4, pointerEvents: valid ? "auto" : "none" }} target="_blank">
              Watch on Telegram →
            </a>
            <a className="arc-mono" href={valid ? `${SNIPER}?start=copy_${w.trim().slice(2).toLowerCase()}` : undefined} rel="noreferrer" style={{ alignSelf: "center", color: "var(--arc-cobalt)", fontSize: 12, opacity: valid ? 1 : 0.4 }} target="_blank">
              copy-trade in sniper ↗
            </a>
          </div>
          {valid && prof && (
            <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, marginTop: 10 }}>
              {(() => {
                const s = prof.stats.find((x) => x.range === "30d");
                return s
                  ? <>30d PnL <span style={{ color: s.pnl_total >= 0 ? "var(--arc-up)" : "var(--arc-down, #f0534f)" }}>{s.pnl_total >= 0 ? "+" : "−"}{usd(Math.abs(s.pnl_total))}</span> · win-rate {Math.round(s.winrate)}% · {s.closed} closed · vol {usd(s.volume)}</>
                  : <>not ranked in the last 30 days</>;
              })()}
              {" · "}{prof.trades.length} recent trades{watchers !== null ? ` · watched by ${watchers}` : ""}
              {prof.trades[0] && <> · last: {prof.trades[0].side} {usd(prof.trades[0].usdc)} {ago(prof.trades[0].ts)} ago</>}
            </div>
          )}
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "10px 0 0" }}>
            Free: 3 wallets per Telegram account, DM on every buy and sell within seconds of the block. More slots with $ARCT staking soon.
          </p>
        </div>

        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
          {/* whale feed */}
          <div style={card}>
            <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 11, margin: 0 }}>WHALE FEED · live</p>
              <span className="arc-mono" style={{ fontSize: 11 }}>
                {[100, 250, 1000, 5000].map((m) => <button key={m} onClick={() => setWhaleMin(m)} style={{ background: whaleMin === m ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid var(--arc-line)", color: whaleMin === m ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, marginLeft: 4, padding: "2px 6px" }} type="button">≥${m}</button>)}
                {[15, 60, 360, 1440].map((m) => <button key={m} onClick={() => setWhaleWin(m)} style={{ background: whaleWin === m ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid var(--arc-line)", color: whaleWin === m ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, marginLeft: 4, padding: "2px 6px" }} type="button">{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}
              </span>
            </div>
            <div style={{ maxHeight: 520, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>side</th><th style={th}>USDC</th><th style={th}>token</th><th style={th}>wallet</th><th style={th}>venue</th><th style={th} /></tr></thead>
                <tbody>
                  {(whales?.rows ?? []).sort((a, b) => b.ts - a.ts).map((r) => (
                    <tr key={r.tx + r.ts}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td className="arc-mono" style={{ ...td, color: r.side === "buy" ? "var(--arc-up)" : "var(--arc-down, #f0534f)" }}>{r.side.toUpperCase()}</td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(r.usdc)}</td>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a></td>
                      <td className="arc-mono" style={td}>
                        <a href={`https://arc-scan.org/address/${r.wallet}`} rel="noreferrer" style={{ color: "var(--arc-muted)" }} target="_blank">{short(r.wallet)}</a>
                        {r.rank && <span style={{ background: "rgba(46,124,255,0.15)", border: "1px solid var(--arc-cobalt)", borderRadius: 3, color: "var(--arc-cobalt)", fontSize: 9, marginLeft: 6, padding: "0 4px" }}>INSIDER #{r.rank}</span>}
                      </td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.venue}</td>
                      <td style={td}><a className="arc-mono" href={`${BOT}?start=watch_${r.wallet.slice(2)}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11 }} target="_blank">watch</a></td>
                    </tr>
                  ))}
                  {whales && whales.rows.length === 0 && <tr><td colSpan={7} className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>Quiet: no swaps ≥ ${whaleMin} in the last {whaleWin} minutes.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* movers */}
          <div style={card}>
            <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 11, margin: 0 }}>TOP MOVERS</p>
              <span className="arc-mono" style={{ fontSize: 11 }}>
                {[15, 60, 360, 1440].map((m) => <button key={m} onClick={() => setMoverWin(m)} style={{ background: moverWin === m ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid var(--arc-line)", color: moverWin === m ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, marginLeft: 4, padding: "2px 6px" }} type="button">{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}
              </span>
            </div>
            <div style={{ maxHeight: 520, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>token</th><th style={th}>change</th><th style={th}>price</th><th style={th}>vol</th><th style={th}>trades</th></tr></thead>
                <tbody>
                  {(movers?.rows ?? []).map((r) => (
                    <tr key={r.token}>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a></td>
                      <td className="arc-mono" style={{ ...td, color: r.chg >= 0 ? "var(--arc-up)" : "var(--arc-down, #f0534f)", fontWeight: 700 }}>{r.chg >= 0 ? "+" : ""}{r.chg.toFixed(1)}%</td>
                      <td className="arc-mono" style={td}>{price(r.p1)}</td>
                      <td className="arc-mono" style={td}>{usd(r.vol)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* insider activity */}
          <div style={card}>
            <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 11, margin: "0 0 8px" }}>INSIDER ACTIVITY · top-100 by 30d PnL · <a href="/insiders" style={{ color: "var(--arc-cobalt)" }}>leaderboard</a> · <a href="https://t.me/ArcToolsInsiders" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">alerts channel</a></p>
            <div style={{ maxHeight: 460, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>#</th><th style={th}>side</th><th style={th}>USDC</th><th style={th}>token</th><th style={th}>30d PnL</th><th style={th} /></tr></thead>
                <tbody>
                  {(insiders?.rows ?? []).map((r) => (
                    <tr key={r.tx}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-cobalt)" }}>#{r.rank}</td>
                      <td className="arc-mono" style={{ ...td, color: r.side === "buy" ? "var(--arc-up)" : "var(--arc-down, #f0534f)" }}>{r.side.toUpperCase()}</td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(r.usdc)}</td>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a></td>
                      <td className="arc-mono" style={{ ...td, color: r.pnl_total >= 0 ? "var(--arc-up)" : "var(--arc-down, #f0534f)" }}>{r.pnl_total >= 0 ? "+" : "−"}{usd(Math.abs(r.pnl_total))}</td>
                      <td style={td}><a className="arc-mono" href={`${SNIPER}?start=copy_${r.wallet.slice(2)}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11 }} target="_blank">copy</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* bridge */}
          <div style={card}>
            <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 11, margin: "0 0 8px" }}>BRIDGE WATCH · Circle CCTP into Arc</p>
            {bridge && (
              <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "0 0 8px" }}>
                24h: <span style={{ color: "var(--arc-ink)" }}>{usd(bridge.in24)}</span> in · {usd(bridge.out24)} out · {bridge.n_in24} inflows from {bridge.wallets_in24} wallets · alerts from ${bridge ? Math.round((bridge as unknown as { min_alert_usd: number }).min_alert_usd) : 5000} in <a href="https://t.me/ArcToolsInsiders" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">@ArcToolsInsiders</a>
              </p>
            )}
            <div style={{ maxHeight: 420, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>dir</th><th style={th}>USDC</th><th style={th}>from</th><th style={th}>wallet</th><th style={th} /></tr></thead>
                <tbody>
                  {(bridge?.latest ?? []).map((r) => (
                    <tr key={r.tx + r.ts}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td className="arc-mono" style={{ ...td, color: r.direction === "in" ? "var(--arc-up)" : "var(--arc-muted)" }}>{r.direction.toUpperCase()}</td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(r.amount)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.source ?? "—"}</td>
                      <td className="arc-mono" style={td}><a href={`https://arc-scan.org/address/${r.recipient}`} rel="noreferrer" style={{ color: "var(--arc-muted)" }} target="_blank">{short(r.recipient)}</a></td>
                      <td style={td}><a className="arc-mono" href={`${BOT}?start=watch_${r.recipient.slice(2)}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11 }} target="_blank">watch</a></td>
                    </tr>
                  ))}
                  {bridge && bridge.latest.length === 0 && <tr><td colSpan={6} className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>No bridge transfers ≥ $100 indexed yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 18 }}>
          Source: ArcTools chain-wide swap index (Uniswap V3, V4, every launchpad), CCTP TokenMessenger events, insider ranking recomputed every 2 minutes. Not financial advice.
        </p>
      </section>
    </main>
  );
}
