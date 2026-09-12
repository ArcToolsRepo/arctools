import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import "../arc-site.css";

/**
 * Wallet watchlist. The list itself lives in this browser (localStorage); each wallet card shows its 30-day
 * record from the swap index, open positions and last trades, and a one-tap "alert me in Telegram" deep link
 * into the buy bot (/start watch_<addr>) which DMs every swap of that wallet.
 */
const API = "https://bot-production-4200.up.railway.app";
const BOT = "https://t.me/ArcToolsBuyBot";
const KEY = "arctools_wallets";
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number | null | undefined) => n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}K` : Math.abs(n).toFixed(2)}`;
const ago = (ts: number) => { const s = Math.max(0, Date.now() / 1000 - ts); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`; };

type Stat = { range: string; pnl_total: number | null; pnl_realized: number | null; winrate: number | null; trades: number | null; closed: number | null; volume: number | null; best_symbol: string | null; best_pnl: number | null; rank?: number | null };
type Trade = { ts: number; tx?: string; token: string; symbol: string | null; side: string; usdc: number; venue: string };
type Pos = { token: string; symbol: string | null; net: number; cost: number; value: number | null; pnl: number | null };
type Card = { wallet: string; stats: Stat[]; trades: Trade[]; positions: Pos[]; watchers: number; loading: boolean };

export const Route = createFileRoute("/wallets")({
  head: () => ({ meta: [{ title: "Wallet watchlist: ArcTools" }, { name: "description", content: "Follow any Arc wallet: 30-day PnL, open positions, live trades and Telegram alerts on every swap." }] }),
  component: Wallets,
});

function load(): string[] { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } }
function save(w: string[]) { try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* ignore */ } }

function Wallets() {
  const [wallets, setWallets] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const w = load();
    const q = new URLSearchParams(window.location.search).get("add");
    if (q && isAddr(q) && !w.includes(q.toLowerCase())) { w.unshift(q.toLowerCase()); save(w); }
    setWallets(w);
  }, []);

  const refresh = useCallback(async (w: string) => {
    setCards((c) => ({ ...c, [w]: { ...(c[w] ?? { wallet: w, stats: [], trades: [], positions: [], watchers: 0 }), loading: true } }));
    const [ins, tr, pos, wc] = await Promise.all([
      fetch(`${API}/api/insider/${w}`).then((r) => r.json()).catch(() => ({})),
      fetch(`${API}/api/wallet-trades?wallet=${w}&limit=8`).then((r) => r.json()).catch(() => ({})),
      fetch(`${API}/api/positions?wallet=${w}`).then((r) => r.json()).catch(() => ({})),
      fetch(`${API}/api/watchers?wallet=${w}`).then((r) => r.json()).catch(() => ({})),
    ]);
    setCards((c) => ({ ...c, [w]: { wallet: w, stats: ins.stats ?? [], trades: tr.trades ?? [], positions: (pos.positions ?? []).filter((p: Pos) => p.net > 0), watchers: wc.watchers ?? 0, loading: false } }));
  }, []);
  useEffect(() => { wallets.forEach((w) => { if (!cards[w]) void refresh(w); }); }, [wallets, cards, refresh]);
  useEffect(() => { const id = setInterval(() => wallets.forEach((w) => void refresh(w)), 30_000); return () => clearInterval(id); }, [wallets, refresh]);

  const add = () => {
    const a = input.trim().toLowerCase();
    if (!isAddr(a)) { setErr("That is not a wallet address (0x + 40 hex chars)."); return; }
    if (wallets.includes(a)) { setErr("Already on the list."); return; }
    const w = [a, ...wallets]; setWallets(w); save(w); setInput(""); setErr(null);
  };
  const remove = (a: string) => { const w = wallets.filter((x) => x !== a); setWallets(w); save(w); };

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/wallets" />
      <section className="arc-section" style={{ maxWidth: 1100, paddingTop: 112 }}>
        <p className="arc-eyebrow">WALLET WATCHLIST</p>
        <h1 className="arc-h2" style={{ fontSize: 30 }}>Follow the wallets that matter</h1>
        <p className="arc-body" style={{ maxWidth: 720 }}>
          Paste any Arc address. You get its 30-day record from our chain-wide swap index, open positions and last trades here — and one tap sends every future swap of that wallet to your Telegram through the buy bot.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0 6px" }}>
          <input className="arc-mono" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="0x… wallet address" style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 6, color: "var(--arc-ink)", flex: "1 1 360px", fontSize: 13, padding: "10px 12px" }} value={input} />
          <button className="arc-cta" onClick={add} type="button">Add wallet</button>
          <Link className="arc-mono" style={{ alignSelf: "center", color: "var(--arc-cobalt)", fontSize: 12 }} to="/insiders">pick from the insider leaderboard →</Link>
        </div>
        {err && <p className="arc-mono" style={{ color: "#f0534f", fontSize: 12 }}>{err}</p>}
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "6px 0 18px" }}>
          The list is stored in this browser. Telegram alerts: first {3} wallets free per account, min trade size adjustable in the bot (<code>/watching</code>, <code>/unwatch</code>).
        </p>

        {wallets.length === 0 && (
          <div style={{ border: "1px dashed var(--arc-line)", borderRadius: 10, color: "var(--arc-muted)", padding: 28, textAlign: "center" }}>
            No wallets yet. Add one above, or click <strong>watch</strong> next to any wallet on <Link style={{ color: "var(--arc-cobalt)" }} to="/intel">Intel</Link> or a token page.
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {wallets.map((w) => {
            const c = cards[w]; const s30 = c?.stats.find((x) => x.range === "30d") ?? c?.stats[0];
            const pnl = s30?.pnl_total ?? null; const up = (pnl ?? 0) >= 0;
            return (
              <div key={w} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 12, padding: 16 }}>
                <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <a className="arc-mono" href={`https://arc-scan.org/address/${w}`} rel="noreferrer" style={{ color: "var(--arc-ink)", fontSize: 15, fontWeight: 700, textDecoration: "none" }} target="_blank" title="Open in Arc Scan">{short(w)}</a>
                    <button className="arc-mono" onClick={() => void navigator.clipboard.writeText(w)} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "2px 8px" }} type="button">copy</button>
                    <a className="arc-mono" href={`https://arc-scan.org/address/${w}`} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 11 }} target="_blank">explorer ↗</a>
                    {s30?.rank != null && <span className="arc-mono" style={{ background: "rgba(46,124,255,0.18)", border: "1px solid var(--arc-cobalt)", borderRadius: 4, fontSize: 10, padding: "1px 6px" }}>INSIDER #{s30.rank}</span>}
                    {c && c.watchers > 0 && <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>👁 {c.watchers} watching</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <a className="arc-mono" href={`${BOT}?start=watch_${w.slice(2)}`} rel="noreferrer" style={{ background: "var(--arc-up)", border: "1px solid var(--arc-up)", borderRadius: 6, color: "#06130b", fontSize: 12, fontWeight: 700, padding: "6px 12px", textDecoration: "none" }} target="_blank">🔔 Alert me in Telegram</a>
                    <a className="arc-mono" href={`https://t.me/ArcSniper_bot?start=copy_${w.slice(2)}`} rel="noreferrer" style={{ background: "transparent", border: "1px solid var(--arc-cobalt)", borderRadius: 6, color: "var(--arc-cobalt)", fontSize: 12, padding: "6px 12px", textDecoration: "none" }} target="_blank">copy-trade</a>
                    <button className="arc-mono" onClick={() => remove(w)} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 6, color: "var(--arc-muted)", cursor: "pointer", fontSize: 12, padding: "6px 10px" }} type="button">remove</button>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", marginTop: 14 }}>
                  {[["30d PnL", usd(pnl), up ? "var(--arc-up)" : "#f0534f"], ["Realized", usd(s30?.pnl_realized), undefined], ["Win rate", s30?.winrate != null ? `${Math.round(s30.winrate * (s30.winrate <= 1 ? 100 : 1))}%` : "—", undefined], ["Trades", s30?.trades ?? "—", undefined], ["Volume", usd(s30?.volume), undefined], ["Best", s30?.best_symbol ? `${s30.best_symbol} ${usd(s30.best_pnl)}` : "—", undefined]].map(([k, v, col]) => (
                    <div key={k as string} style={{ background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 8, padding: "8px 10px" }}>
                      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: 0, textTransform: "uppercase" }}>{k as string}</p>
                      <p className="arc-mono" style={{ color: (col as string) ?? "var(--arc-ink)", fontSize: 15, fontWeight: 700, margin: "2px 0 0" }}>{c?.loading && !c.stats.length ? "…" : String(v)}</p>
                    </div>
                  ))}
                </div>
                <div className="arc-2col" style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
                  <div>
                    <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "0 0 6px", textTransform: "uppercase" }}>Open positions</p>
                    {c?.positions.length ? c.positions.slice(0, 6).map((p) => (
                      <div className="arc-mono" key={p.token} style={{ display: "flex", fontSize: 12, gap: 8, justifyContent: "space-between", padding: "3px 0" }}>
                        <span><Link params={{ ca: p.token }} preload="intent" style={{ color: "var(--arc-ink)", fontWeight: 700, textDecoration: "none" }} to="/token/$ca">{p.symbol ?? short(p.token)}</Link> <Link params={{ ca: p.token }} preload="intent" style={{ color: "var(--arc-cobalt)", fontSize: 11, textDecoration: "none" }} to="/token/$ca">chart ↗</Link></span>
                        <span style={{ color: (p.pnl ?? 0) >= 0 ? "var(--arc-up)" : "#f0534f" }}>{p.value != null ? usd(p.value) : "—"}{p.pnl != null ? ` (${p.pnl >= 0 ? "+" : ""}${usd(p.pnl)})` : ""}</span>
                      </div>
                    )) : <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0 }}>{c?.loading ? "…" : "none tracked"}</p>}
                  </div>
                  <div>
                    <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "0 0 6px", textTransform: "uppercase" }}>Last trades</p>
                    {c?.trades.length ? c.trades.slice(0, 6).map((t, i) => (
                      <div className="arc-mono" key={i} style={{ alignItems: "baseline", display: "flex", fontSize: 12, gap: 8, justifyContent: "space-between", padding: "3px 0", whiteSpace: "nowrap" }}>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}><span style={{ color: t.side === "buy" ? "var(--arc-up)" : "#f0534f", display: "inline-block", width: 36 }}>{t.side.toUpperCase()}</span> <Link params={{ ca: t.token }} preload="intent" style={{ color: "var(--arc-ink)", fontWeight: 700, textDecoration: "none" }} to="/token/$ca">{t.symbol ?? short(t.token)}</Link> <Link params={{ ca: t.token }} preload="intent" style={{ color: "var(--arc-cobalt)", fontSize: 11, textDecoration: "none" }} to="/token/$ca">chart ↗</Link></span>
                        <span style={{ color: "var(--arc-muted)", flex: "none" }}>{usd(t.usdc)} · {ago(t.ts)}{t.tx && <> · <a href={`https://arc-scan.org/tx/${t.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", textDecoration: "none" }} target="_blank" title={t.tx}>tx ↗</a></>}</span>
                      </div>
                    )) : <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0 }}>{c?.loading ? "…" : "no swaps indexed"}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
