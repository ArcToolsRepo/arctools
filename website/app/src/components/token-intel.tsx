import { useEffect, useState } from "react";

import { type ChartAvatar, type ChartMarker } from "@/components/tv-chart";
import { Tags, useWalletLabels } from "@/components/risk";

const API = "https://bot-production-4200.up.railway.app";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(Math.abs(v) >= 100 ? 0 : 2)}`);
const signed = (v: number) => (v >= 0 ? "+" : "−") + usd(Math.abs(v));
const ago = (ts: number) => { const s = Math.max(0, Date.now() / 1000 - ts); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`; };
const UP = "#22c580", DOWN = "#f0534f";
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : String(n));

export type TokenEvent = { ts: number; side: "buy" | "sell"; usdc: number; wallet: string; kind: "dev" | "insider" | "pro" | "kol"; meta: number | null; tx: string; n: number; text?: string; avatar?: string; name?: string };
export type EventsResp = { events: TokenEvent[]; total: number; devs: string[]; insiders_seen: number; pros_seen: number };

/** Poll notable trades for the chart; returns markers + the raw feed. */
export function useTokenEvents(token: string | null | undefined, limit = 14, since = 0): { markers: ChartMarker[]; avatars: ChartAvatar[]; data: EventsResp | null } {
  const [data, setData] = useState<EventsResp | null>(null);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () => fetch(`${API}/api/token-events?token=${token}&limit=${limit}${since ? `&since=${since - (since % 900)}` : ""}`).then((r) => r.json()).then((j) => alive && j.events && setData(j)).catch(() => null);
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [token, limit, since - (since % 900)]);
  const avatars: ChartAvatar[] = (data?.events ?? []).filter((e) => e.kind === "kol" && e.avatar).map((e) => ({
    t: e.ts, url: e.avatar!, href: e.tx, label: `@${e.wallet}`,
    title: `${e.name || "@" + e.wallet} · @${e.wallet} · ${fmtK(e.meta ?? 0)} followers\n${e.text ?? ""}`,
  }));
  const markers: ChartMarker[] = (data?.events ?? []).filter((e) => !(e.kind === "kol" && e.avatar)).map((e) => ({
    kind: e.kind, side: e.side, t: e.ts,
    text: e.kind === "kol" ? "K" : `${e.kind === "dev" ? "D" : e.kind === "insider" ? "I" : "P"}${e.side === "buy" ? "B" : "S"}`,
    title: e.kind === "kol" ? `@${e.wallet} (${fmtK(e.meta ?? 0)} followers) mentioned this token: ${e.text ?? ""}` : `${e.kind === "dev" ? "deployer" : e.kind === "insider" ? `insider #${e.meta}` : `${e.meta}% win-rate wallet`} ${e.side} ${usd(e.usdc)}${e.n > 1 ? ` (${e.n} fills)` : ""}`,
  }));
  return { markers, avatars, data };
}

export function MarkerLegend({ data, visible }: { data: EventsResp | null; visible?: number | null }) {
  if (!data) return null;
  const Dot = ({ c, t }: { c: string; t: string }) => <span style={{ alignItems: "center", display: "inline-flex", gap: 4 }}><span style={{ background: c, borderRadius: "50%", display: "inline-block", height: 8, width: 8 }} />{t}</span>;
  return (
    <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 10.5, gap: 12, padding: "4px 10px 6px" }}>
      <Dot c="#22c580" t="DB dev buy" /><Dot c="#f0534f" t="DS dev sell" /><Dot c="#2e7cff" t="IB/IS insider (top-100)" /><Dot c="#9b7bff" t="PB/PS pro wallet (75%+ win)" /><Dot c="#ff5fd2" t="KOL avatar = KOL tweeted about this token" />
      <span style={{ marginLeft: "auto" }}>{visible != null ? `${visible} on chart · ` : ""}{data.events.length} of {data.total} notable trades{visible != null && visible < data.events.length ? ` (${data.events.length - visible} older than this timeframe — zoom out)` : ""}{data.devs.length ? ` · deployer ${data.devs.map(short).join(", ")}` : " · deployer unknown"}</span>
    </div>
  );
}

// ---------------- Top traders ----------------
type Trader = { wallet: string; bought: number; sold: number; tok: number; realized: number; unrealized: number; pnl: number; value: number; buys: number; sells: number; last_ts: number; dev: boolean; insider_rank: number | null; winrate: number | null };

export function TopTraders({ token, symbol }: { token: string; symbol: string }) {
  const [d, setD] = useState<{ traders: Trader[]; wallets: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API}/api/token-traders?token=${token}&limit=25`).then((r) => r.json()).then((j) => alive && j.traders && setD(j)).catch(() => null);
    load();
    const id = setInterval(load, 45_000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);
  const labels = useWalletLabels((d?.traders ?? []).map((t) => t.wallet), token);
  const th: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 11, fontWeight: 400, padding: "6px 8px", textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 12, padding: "6px 8px", whiteSpace: "nowrap" };
  return (
    <div style={{ maxHeight: 460, overflow: "auto" }}>
      <table className="arc-mono" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th style={th}>#</th><th style={th}>wallet</th><th style={th}>PnL</th><th style={th}>realized</th><th style={th}>unrealized</th><th style={th}>bought → sold</th><th style={th}>holds</th><th style={th}>tx</th><th style={th}>last</th></tr></thead>
        <tbody>
          {(d?.traders ?? []).map((t, i) => (
            <tr key={t.wallet}>
              <td style={{ ...td, color: "var(--arc-muted)" }}>{i + 1}</td>
              <td style={td}>
                <a href={`/insider/${t.wallet}`} style={{ color: "var(--arc-ink)", textDecoration: "none" }}>{short(t.wallet)}</a>
                {t.dev && <span style={{ background: "rgba(245,197,66,0.16)", border: "1px solid #f5c542", borderRadius: 4, color: "#f5c542", fontSize: 9.5, marginLeft: 5, padding: "2px 5px" }}>DEV</span>}
                {t.winrate != null && !t.insider_rank && <span style={{ background: "rgba(155,123,255,0.16)", border: "1px solid #9b7bff", borderRadius: 4, color: "#9b7bff", fontSize: 9.5, marginLeft: 5, padding: "2px 5px" }}>{t.winrate}% win</span>}
                <Tags labels={labels} max={2} wallet={t.wallet} />
              </td>
              <td style={{ ...td, color: t.pnl >= 0 ? UP : DOWN, fontWeight: 700 }}>{signed(t.pnl)}</td>
              <td style={{ ...td, color: t.realized >= 0 ? UP : DOWN }}>{signed(t.realized)}</td>
              <td style={{ ...td, color: t.unrealized >= 0 ? UP : DOWN }}>{t.tok > 0 ? signed(t.unrealized) : "—"}</td>
              <td style={{ ...td, color: "var(--arc-muted)" }}>{usd(t.bought)} → {usd(t.sold)}</td>
              <td style={td}>{t.tok > 0 ? `${usd(t.value)}` : <span style={{ color: "var(--arc-muted)" }}>sold out</span>}</td>
              <td style={{ ...td, color: "var(--arc-muted)" }}>{t.buys}↑ {t.sells}↓</td>
              <td style={{ ...td, color: "var(--arc-muted)" }}>{ago(t.last_ts)}</td>
            </tr>
          ))}
          {d && d.traders.length === 0 && <tr><td colSpan={9} style={{ ...td, color: "var(--arc-muted)", padding: 18, textAlign: "center" }}>No indexed trades yet.</td></tr>}
          {!d && <tr><td colSpan={9} style={{ ...td, color: "var(--arc-muted)", padding: 18, textAlign: "center" }}>…</td></tr>}
        </tbody>
      </table>
      {d && <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10.5, padding: "6px 8px" }}>{d.wallets} wallets traded {symbol} · PnL = avg-cost realized + open position at last price. Tokens received by transfer count as free.</div>}
    </div>
  );
}

// ---------------- My position ----------------
type Position = { bought: number; sold: number; tok: number; cost: number; realized: number; unrealized: number; pnl: number; value: number; avg: number | null; buys: number; sells: number; first_ts: number; last_ts: number };
type MyTrade = { tx: string; ts: number; side: "buy" | "sell"; usdc: number; tokens: number; price1m: number };

export function MyPosition({ token, symbol, wallet, onchainBalance, onSell }: { token: string; symbol: string; wallet: string | null; onchainBalance: number | null; onSell?: (pct: number) => void }) {
  const [d, setD] = useState<{ position: Position | null; trades: MyTrade[]; price1m: number } | null>(null);
  useEffect(() => {
    if (!wallet) { setD(null); return; }
    let alive = true;
    const load = () => fetch(`${API}/api/token-position?token=${token}&wallet=${wallet}`).then((r) => r.json()).then((j) => alive && setD(j)).catch(() => null);
    load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [token, wallet]);
  if (!wallet) return <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>Connect a wallet or unlock the trading wallet to see your position, PnL and trade history on {symbol}.</p>;
  if (!d) return <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>…</p>;
  const p = d.position;
  const Cell = ({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) => (
    <div style={{ border: "1px solid var(--arc-line)", padding: "8px 10px" }}>
      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, letterSpacing: "0.08em" }}>{k}</div>
      <div className="arc-mono" style={{ color: tone === "up" ? UP : tone === "down" ? DOWN : "var(--arc-ink)", fontSize: 15, fontWeight: 700, marginTop: 2 }}>{v}</div>
    </div>
  );
  const heldValue = onchainBalance != null && d.price1m ? (onchainBalance * d.price1m) / 1e6 : p?.value ?? 0;
  return (
    <div style={{ padding: 12 }}>
      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginBottom: 8 }}>{short(wallet)} on {symbol}{p ? ` · first trade ${ago(p.first_ts)} ago` : ""}</div>
      {!p && (onchainBalance ?? 0) === 0 && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>No trades from this wallet on {symbol} yet. Buy from the panel on the right — it shows up here within a minute.</p>}
      {(p || (onchainBalance ?? 0) > 0) && (
        <>
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
            <Cell k="HOLDING" v={`${(onchainBalance ?? p?.tok ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${symbol}`} />
            <Cell k="VALUE NOW" v={usd(heldValue)} />
            <Cell k="INVESTED" v={p ? usd(p.bought) : "—"} />
            <Cell k="SOLD" v={p ? usd(p.sold) : "—"} />
            <Cell k="REALIZED" tone={p && p.realized >= 0 ? "up" : "down"} v={p ? signed(p.realized) : "—"} />
            <Cell k="UNREALIZED" tone={p && heldValue - (p?.cost ?? 0) >= 0 ? "up" : "down"} v={p ? signed(heldValue - p.cost) : "—"} />
            <Cell k="TOTAL PNL" tone={p && p.realized + heldValue - p.cost >= 0 ? "up" : "down"} v={p ? signed(p.realized + heldValue - p.cost) : "—"} />
            <Cell k="AVG ENTRY → NOW" v={p?.avg ? `$${(p.avg / 1e6).toFixed(8)} → $${(d.price1m / 1e6).toFixed(8)}` : "—"} />
          </div>
          {onSell && (onchainBalance ?? 0) > 0 && (
            <div style={{ alignItems: "center", display: "flex", gap: 6, marginTop: 10 }}>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>SELL</span>
              {[25, 50, 100].map((pct) => <button key={pct} className="arc-mono" onClick={() => onSell(pct)} style={{ background: "transparent", border: "1px solid #f0534f", borderRadius: 4, color: "#f0534f", cursor: "pointer", fontSize: 12, padding: "5px 12px" }}>{pct}%</button>)}
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10.5 }}>fills the swap panel → confirm there</span>
            </div>
          )}
        </>
      )}
      {d.trades.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: 260, overflow: "auto" }}>
          <table className="arc-mono" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["age", "side", "USDC", symbol, "price", "tx"].map((h) => <th key={h} style={{ color: "var(--arc-muted)", fontSize: 11, fontWeight: 400, padding: "4px 8px", textAlign: "left" }}>{h}</th>)}</tr></thead>
            <tbody>
              {d.trades.map((t) => (
                <tr key={t.tx + t.ts}>
                  <td style={{ borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", fontSize: 12, padding: "5px 8px" }}>{ago(t.ts)}</td>
                  <td style={{ borderTop: "1px solid var(--arc-line)", color: t.side === "buy" ? UP : DOWN, fontSize: 12, padding: "5px 8px", textTransform: "uppercase" }}>{t.side}</td>
                  <td style={{ borderTop: "1px solid var(--arc-line)", fontSize: 12, padding: "5px 8px" }}>{usd(t.usdc)}</td>
                  <td style={{ borderTop: "1px solid var(--arc-line)", fontSize: 12, padding: "5px 8px" }}>{t.tokens.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td style={{ borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", fontSize: 12, padding: "5px 8px" }}>${(t.price1m / 1e6).toFixed(8)}</td>
                  <td style={{ borderTop: "1px solid var(--arc-line)", fontSize: 12, padding: "5px 8px" }}><a href={`https://arc-scan.org/tx/${t.tx}`} rel="noreferrer" style={{ color: "var(--arc-muted)" }} target="_blank">↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Dev tokens ----------------
type DevTok = { token: string; symbol: string | null; dev_sold_usd: number; drawdown: number | null; dumped: boolean; first_ts: number; swaps: number; buy_volume_usd: number };
export function DevTokens({ dev, current }: { dev: string | null | undefined; current: string }) {
  const [h, setH] = useState<{ launches: number; rugs: number; tokens: DevTok[] } | null | undefined>(undefined);
  useEffect(() => {
    if (!dev) { setH(null); return; }
    let alive = true;
    fetch(`${API}/api/dev-history?dev=${dev}`).then((r) => r.json()).then((j) => alive && setH(j.tokens ? j : null)).catch(() => alive && setH(null));
    return () => { alive = false; };
  }, [dev]);
  if (!dev) return <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>Deployer unknown for this token (no factory event indexed).</p>;
  if (h === undefined) return <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>…</p>;
  if (!h) return <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 16 }}>No history for <a href={`/insider/${dev}`} style={{ color: "var(--arc-ink)" }}>{short(dev)}</a>.</p>;
  const td: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 12, padding: "6px 8px", whiteSpace: "nowrap" };
  return (
    <div style={{ padding: "0 0 8px" }}>
      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11.5, padding: "10px 12px 4px" }}>
        Deployer <a href={`/insider/${dev}`} style={{ color: "var(--arc-ink)" }}>{short(dev)}</a> · {h.launches} launch{h.launches === 1 ? "" : "es"} · <span style={{ color: h.rugs ? DOWN : UP }}>{h.rugs} dumped</span>
      </div>
      <div style={{ maxHeight: 400, overflow: "auto" }}>
        <table className="arc-mono" style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["token", "launched", "dev sold", "of buy vol", "drawdown", "trades", "outcome"].map((x) => <th key={x} style={{ color: "var(--arc-muted)", fontSize: 11, fontWeight: 400, padding: "4px 8px", textAlign: "left" }}>{x}</th>)}</tr></thead>
          <tbody>
            {h.tokens.map((t) => (
              <tr key={t.token} style={{ background: t.token.toLowerCase() === current.toLowerCase() ? "rgba(46,124,255,0.08)" : undefined }}>
                <td style={td}><a href={`/token/${t.token}`} style={{ color: "var(--arc-ink)", fontWeight: 700, textDecoration: "none" }}>{t.symbol ?? short(t.token)}</a>{t.token.toLowerCase() === current.toLowerCase() && <span style={{ color: "var(--arc-muted)", marginLeft: 6 }}>this</span>}</td>
                <td style={{ ...td, color: "var(--arc-muted)" }}>{t.first_ts ? `${ago(t.first_ts)} ago` : "—"}</td>
                <td style={{ ...td, color: t.dev_sold_usd > 0 ? DOWN : "var(--arc-muted)" }}>{usd(t.dev_sold_usd)}</td>
                <td style={{ ...td, color: "var(--arc-muted)" }}>{t.buy_volume_usd > 0 ? `${((t.dev_sold_usd / t.buy_volume_usd) * 100).toFixed(0)}%` : "—"}</td>
                <td style={{ ...td, color: t.drawdown != null && t.drawdown <= 0.25 ? DOWN : "var(--arc-muted)" }}>{t.drawdown != null ? `${((1 - t.drawdown) * 100).toFixed(0)}% off peak` : "—"}</td>
                <td style={{ ...td, color: "var(--arc-muted)" }}>{t.swaps}</td>
                <td style={{ ...td, color: t.dumped ? DOWN : UP, fontWeight: 700 }}>{t.dumped ? "DUMPED" : "alive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ---------------- KOL mentions ----------------
type Mention = { tweet_id: string; kol: string; ts: number; text: string; url: string; likes: number; retweets: number; views: number; match: string; followers: number | null; name: string | null; avatar: string | null };
export function KolMentions({ token }: { token: string }) {
  const [d, setD] = useState<{ mentions: Mention[]; enabled: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API}/api/kol-mentions?token=${token}&limit=20`).then((r) => r.json()).then((j) => alive && j.mentions && setD(j)).catch(() => null);
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);
  if (!d || !d.enabled || d.mentions.length === 0) return null;
  return (
    <section style={{ border: "1px solid #ff5fd2", marginTop: 14, padding: "12px 14px" }}>
      <div className="arc-mono" style={{ color: "#ff5fd2", fontSize: 11, letterSpacing: "0.08em" }}>KOL MENTIONS · {d.mentions.length}</div>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {d.mentions.slice(0, 6).map((m) => (
          <a key={m.tweet_id} href={m.url} rel="noreferrer" style={{ border: "1px solid var(--arc-line)", borderRadius: 6, color: "var(--arc-ink)", display: "block", padding: "8px 10px", textDecoration: "none" }} target="_blank">
            <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
              {m.avatar ? <img alt="" height={22} src={m.avatar} style={{ borderRadius: "50%" }} width={22} /> : <span style={{ background: "var(--arc-line)", borderRadius: "50%", display: "inline-block", height: 22, width: 22 }} />}
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{m.name ?? `@${m.kol}`}</span>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>@{m.kol} · {fmtK(m.followers ?? 0)} followers · {ago(m.ts)} ago</span>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: "auto" }}>♥ {fmtK(m.likes)} · {fmtK(m.views)} views</span>
            </div>
            <div style={{ color: "var(--arc-ink)", fontSize: 12.5, lineHeight: 1.45, marginTop: 6, opacity: 0.9 }}>{m.text.length > 220 ? m.text.slice(0, 220) + "…" : m.text}</div>
          </a>
        ))}
      </div>
      <div style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 8 }}>Tweets by tracked Arc KOLs (10k+ followers) that name this token by contract, unique $cashtag or its X handle. Also drawn as K badges on the chart.</div>
    </section>
  );
}
