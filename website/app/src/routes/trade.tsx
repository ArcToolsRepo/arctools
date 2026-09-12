import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { listTokens, type PadToken } from "@/lib/arc-api";
import { padList } from "@/lib/arcpad";
import { ARC_AGGREGATOR, encodeAggregatorSwap, p32 } from "@/lib/arc-wallet";
import { hotAddress, hotCall, hotSend, hotWait } from "@/lib/arc-hotwallet";
import { WalletPanel } from "@/components/wallet-panel";
import { routeSwap, type RouteResult } from "@/lib/arc-route";
import { quickAmount, setQuickAmount } from "@/components/quick-buy";
import "../arc-site.css";

const API = "https://bot-production-4200.up.railway.app";
const SNIPER = "https://t.me/ArcSniper_bot";

export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "ArcTools Trade: one-click buys on every Arc launchpad" },
      { content: "GMGN-style terminal for Arc: new pairs, trending, insider picks, one-click buy and sell from an in-browser wallet, best price across every venue.", name: "description" },
    ],
  }),
  component: Trade,
});

type Mover = { token: string; n: number; vol: number; p1: number; chg: number; symbol: string | null };
type Cluster = { token: string; symbol: string | null; insiders: number; usd: number; ranks: string; last_ts: number };
type Position = { token: string; symbol: string | null; net: number; avg: number; price: number | null; value: number | null; unrealized: number | null; realized: number; cost: number; n: number; last_ts: number };

const usd = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);
const num = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (iso: string | null | number) => {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso * 1000 : new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const priceStr = (p: number | null) => (p == null ? "—" : p >= 1 ? `$${p.toFixed(4)}` : `$${p.toFixed(Math.max(2, -Math.floor(Math.log10(p)) + 3))}`);

const SEL = { balanceOf: "0x70a08231", allowance: "0xdd62ed3e", approve: "0x095ea7b3" };
const UP = "var(--arc-up)", DOWN = "var(--arc-down, #f0534f)";
const cell: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 13, padding: "9px 10px 9px 0", verticalAlign: "middle", whiteSpace: "nowrap" };
const hd: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 10, fontWeight: 400, padding: "0 10px 8px 0", textAlign: "left", textTransform: "uppercase" };

// ---------------- page ----------------
function Trade() {
  const [addr, setAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState(5);
  const [custom, setCustom] = useState("");
  const [slip, setSlip] = useState(5);
  const [tab, setTab] = useState<"new" | "trending" | "insiders" | "holdings">("new");
  const [rows, setRows] = useState<PadToken[]>([]);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const [q, setQ] = useState("");
  const lastRoute = useRef<Map<string, RouteResult>>(new Map());
  const buyAmt = custom && Number(custom) > 0 ? Number(custom) : amount;
  useEffect(() => { setQuickAmount(buyAmt); }, [buyAmt]);
  useEffect(() => {
    const a = quickAmount();
    if ([1, 5, 20, 100].includes(a)) setAmount(a); else setCustom(String(a));
    const ca = new URLSearchParams(window.location.search).get("buy");
    if (ca && /^0x[0-9a-fA-F]{40}$/.test(ca)) setQ(ca);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [radar, arcpad, warp, tolly, uni, pad, arch, v4, argus] = await Promise.all(
          ["RadarDex", "ArcPad", "Warp", "Tolly", "UniswapV3", "__pad", "Archemist", "UniswapV4", "Arguspad"].map((p) =>
            p === "__pad" ? padList().then((ps) => ps.map((x) => ({ createdAt: x.createdAt ? new Date(x.createdAt * 1000).toISOString() : null, logo: x.image, mcapUsd: x.pricePer1M > 0 ? x.pricePer1M * 1000 : null, name: x.name, pad: "ArcToolsPad", pool: null, priceUsd: null, symbol: x.symbol, telegram: x.telegram, token: x.token, twitter: x.twitter, venueUrl: `/token/${x.token}`, volUsd: x.volumeUsdc, website: x.website }) as PadToken)).catch(() => [] as PadToken[])
              : listTokens({ data: { pad: p } }).catch(() => [] as PadToken[])),
        );
        const seen = new Set<string>();
        const all = [...pad, ...radar, ...arcpad, ...warp, ...tolly, ...arch, ...argus, ...v4, ...uni].filter((t) => { const k = t.token.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        if (alive) setRows(all);
      } catch { /* ignore */ }
      fetch(`${API}/api/movers?minutes=1440`).then((r) => r.json()).then((j) => alive && setMovers(j.rows ?? [])).catch(() => null);
      fetch(`${API}/api/clusters?minutes=1440&n=2`).then((r) => r.json()).then((j) => alive && setClusters(j.rows ?? [])).catch(() => null);
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const loadPositions = useCallback(async () => {
    if (!addr) { setPositions([]); return; }
    const j = await fetch(`${API}/api/positions?wallet=${addr.toLowerCase()}`).then((r) => r.json()).catch(() => null);
    setPositions((j?.positions ?? []).filter((p: Position) => p.net > 0));
  }, [addr]);
  useEffect(() => { void loadPositions(); const id = setInterval(loadPositions, 20_000); return () => clearInterval(id); }, [loadPositions]);

  const byToken = useMemo(() => new Map(rows.map((r) => [r.token.toLowerCase(), r])), [rows]);
  const clusterMap = useMemo(() => new Map(clusters.map((c) => [c.token.toLowerCase(), c])), [clusters]);

  // ---- one-click buy / sell through the aggregator, signed by the hot wallet
  const buy = async (token: string, symbol: string) => {
    if (!addr) { setToast({ ok: false, text: "Create or unlock the trading wallet first." }); return; }
    setBusy(token); setToast(null);
    try {
      const spend = (BigInt(Math.round(buyAmt * 1e6)) * 10n ** 12n * 100n) / 101n;
      const r = await routeSwap({ data: { token, side: "buy", amount: spend.toString() } });
      if (r.error || r.legs.length === 0) throw new Error(r.error === "no venue" ? "No pool found for this token yet." : r.error ?? "No route.");
      lastRoute.current.set(token, r);
      const minOut = (BigInt(r.out) * BigInt(100 - slip)) / 100n;
      const legs = r.legs.map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
      const value = spend + spend / 100n;
      const h = await hotSend({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("buy", token, legs, minOut, addr, 100), value });
      setToast({ ok: true, text: `Buying ${symbol} for ${buyAmt} USDC via ${r.legs.map((l) => l.label).join(" + ")}…`, tx: h });
      const rc = await hotWait(h);
      setToast({ ok: rc.status === 1, text: rc.status === 1 ? `Bought ${symbol} for ${buyAmt} USDC.` : `Buy of ${symbol} reverted (slippage?).`, tx: h });
      void loadPositions();
    } catch (e) { setToast({ ok: false, text: (e as Error).message }); }
    setBusy(null);
  };
  const sell = async (p: Position, pct: number) => {
    if (!addr) return;
    setBusy(p.token); setToast(null);
    try {
      const balHex = await hotCall(p.token, SEL.balanceOf + p32(addr));
      const bal = BigInt(balHex || "0x0");
      const amt = (bal * BigInt(pct)) / 100n;
      if (amt <= 0n) throw new Error("Nothing to sell.");
      const r = await routeSwap({ data: { token: p.token, side: "sell", amount: amt.toString() } });
      if (r.error || r.legs.length === 0) throw new Error("No route to sell.");
      const al = BigInt((await hotCall(p.token, SEL.allowance + p32(addr) + p32(ARC_AGGREGATOR))) || "0x0");
      if (al < amt) {
        setToast({ ok: true, text: `Approving ${p.symbol ?? short(p.token)}…` });
        await hotWait(await hotSend({ to: p.token, data: SEL.approve + p32(ARC_AGGREGATOR) + "f".repeat(64), gasLimit: 80_000n }));
      }
      const minOut = (BigInt(r.out) * 99n * BigInt(100 - slip)) / 10_000n;   // post-fee native USDC
      const legs = r.legs.map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
      const h = await hotSend({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("sell", p.token, legs, minOut, addr, 100) });
      setToast({ ok: true, text: `Selling ${pct}% of ${p.symbol ?? short(p.token)}…`, tx: h });
      const rc = await hotWait(h);
      setToast({ ok: rc.status === 1, text: rc.status === 1 ? `Sold ${pct}% of ${p.symbol ?? short(p.token)}.` : "Sell reverted (slippage?).", tx: h });
      void loadPositions();
    } catch (e) { setToast({ ok: false, text: (e as Error).message }); }
    setBusy(null);
  };

  const BuyBtn = ({ token, symbol }: { token: string; symbol: string }) => (
    <button className="arc-mono" disabled={busy === token} onClick={() => void buy(token, symbol)} style={{ background: busy === token ? "transparent" : "var(--arc-up)", border: "1px solid var(--arc-up)", borderRadius: 4, color: busy === token ? "var(--arc-up)" : "#06130b", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 10px", whiteSpace: "nowrap" }} type="button">
      {busy === token ? "…" : `⚡ ${buyAmt} USDC`}
    </button>
  );
  const Socials = ({ t }: { t: PadToken }) => (
    <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
      {t.twitter && <a href={t.twitter} rel="noreferrer" style={{ color: "var(--arc-muted)", marginRight: 6 }} target="_blank">𝕏</a>}
      {t.telegram && <a href={t.telegram} rel="noreferrer" style={{ color: "var(--arc-muted)", marginRight: 6 }} target="_blank">✈︎</a>}
      {t.website && <a href={t.website} rel="noreferrer" style={{ color: "var(--arc-muted)" }} target="_blank">web</a>}
    </span>
  );
  const Logo = ({ t }: { t: { logo?: string | null; symbol: string } }) => (
    <span style={{ alignItems: "center", background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 6, display: "inline-flex", height: 30, justifyContent: "center", marginRight: 8, overflow: "hidden", verticalAlign: "middle", width: 30 }}>
      {t.logo ? <img alt="" height={30} src={t.logo} style={{ objectFit: "cover" }} width={30} /> : <span className="arc-mono" style={{ fontSize: 12 }}>{t.symbol.slice(0, 1)}</span>}
    </span>
  );

  const filtered = rows.filter((r) => !q || `${r.name} ${r.symbol} ${r.token}`.toLowerCase().includes(q.toLowerCase()));
  const newest = [...filtered].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()).slice(0, 80);
  const trending = movers.filter((m) => !q || `${m.symbol ?? ""} ${m.token}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.vol - a.vol).slice(0, 60);

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/trade" />
      <section className="arc-section" style={{ maxWidth: 1360, paddingTop: 118 }}>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
          {/* LEFT: terminal */}
          <div>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <h1 style={{ fontSize: 26, margin: 0 }}>Trade</h1>
              <span style={{ color: "var(--arc-muted)", fontSize: 13 }}>every Arc launchpad · one click · best price across venues · <a href="/profile" style={{ color: "var(--arc-cobalt)" }}>profile & history →</a></span>
            </div>
            {/* quick-buy bar */}
            <div style={{ alignItems: "center", background: "var(--arc-paper)", border: "1px solid var(--arc-line)", display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, padding: "8px 12px" }}>
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>QUICK BUY</span>
              {[1, 5, 20, 100].map((a) => <button key={a} className="arc-mono" onClick={() => { setAmount(a); setCustom(""); }} style={{ background: amount === a && !custom ? "rgba(34,197,128,0.18)" : "transparent", border: "1px solid " + (amount === a && !custom ? UP : "var(--arc-line)"), color: amount === a && !custom ? UP : "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "4px 10px" }} type="button">{a} USDC</button>)}
              <input className="arc-mono" inputMode="decimal" onChange={(e) => setCustom(e.target.value)} placeholder="custom" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, padding: "4px 8px", width: 80 }} value={custom} />
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>SLIPPAGE</span>
              {[1, 5, 15, 30].map((s) => <button key={s} className="arc-mono" onClick={() => setSlip(s)} style={{ background: slip === s ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (slip === s ? "var(--arc-cobalt)" : "var(--arc-line)"), color: slip === s ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 8px" }} type="button">{s}%</button>)}
              <input className="arc-mono" onChange={(e) => setQ(e.target.value)} placeholder="filter / paste CA" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 160px", fontSize: 12, marginLeft: "auto", padding: "4px 8px" }} value={q} />
            </div>
            {/* tabs */}
            <div style={{ borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 2, marginBottom: 8 }}>
              {([["new", "New pairs"], ["trending", "Trending 24h"], ["insiders", "Insider picks"], ["holdings", `Holdings${positions.length ? ` (${positions.length})` : ""}`]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={{ background: "transparent", border: "none", borderBottom: "2px solid " + (tab === k ? "var(--arc-cobalt)" : "transparent"), color: tab === k ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 14, fontWeight: tab === k ? 700 : 400, padding: "8px 14px" }} type="button">{l}</button>
              ))}
            </div>
            {/* paste CA quick action */}
            {/^0x[0-9a-fA-F]{40}$/.test(q.trim()) && !byToken.has(q.trim().toLowerCase()) && (
              <div style={{ alignItems: "center", background: "var(--arc-paper)", border: "1px solid var(--arc-cobalt)", display: "flex", gap: 10, marginBottom: 8, padding: "8px 12px" }}>
                <span className="arc-mono" style={{ fontSize: 12 }}>{short(q.trim())}</span>
                <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>not in the lists — buy it anyway (router finds the pool)</span>
                <BuyBtn symbol={short(q.trim())} token={q.trim().toLowerCase()} />
                <a className="arc-mono" href={`/token/${q.trim().toLowerCase()}`} style={{ color: "var(--arc-cobalt)", fontSize: 12 }}>chart</a>
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              {tab === "new" && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr><th style={hd}>token</th><th style={hd}>pad</th><th style={hd}>age</th><th style={hd}>MC</th><th style={hd}>vol 24h</th><th style={hd}>insiders</th><th style={hd}>links</th><th style={hd} /></tr></thead>
                  <tbody>
                    {newest.map((t) => { const c = clusterMap.get(t.token.toLowerCase()); return (
                      <tr key={t.token}>
                        <td style={cell}><a href={`/token/${t.token}`} style={{ color: "var(--arc-ink)", textDecoration: "none" }}><Logo t={t} /><strong>{t.symbol}</strong> <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>{t.name.slice(0, 22)}</span></a></td>
                        <td className="arc-mono" style={{ ...cell, color: "var(--arc-muted)", fontSize: 11 }}>{t.pad}</td>
                        <td className="arc-mono" style={{ ...cell, color: "var(--arc-muted)" }}>{ago(t.createdAt)}</td>
                        <td className="arc-mono" style={cell}>{usd(t.mcapUsd)}</td>
                        <td className="arc-mono" style={cell}>{usd(t.volUsd)}</td>
                        <td className="arc-mono" style={{ ...cell, color: c ? UP : "var(--arc-muted)" }}>{c ? `${c.insiders} · ${usd(c.usd)}` : "—"}</td>
                        <td style={cell}><Socials t={t} /></td>
                        <td style={{ ...cell, textAlign: "right" }}><BuyBtn symbol={t.symbol} token={t.token} /></td>
                      </tr>); })}
                  </tbody>
                </table>
              )}
              {tab === "trending" && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr><th style={hd}>token</th><th style={hd}>24h</th><th style={hd}>price</th><th style={hd}>vol 24h</th><th style={hd}>trades</th><th style={hd}>insiders</th><th style={hd} /></tr></thead>
                  <tbody>
                    {trending.map((m) => { const t = byToken.get(m.token.toLowerCase()); const c = clusterMap.get(m.token.toLowerCase()); const sym = m.symbol ?? t?.symbol ?? short(m.token); return (
                      <tr key={m.token}>
                        <td style={cell}><a href={`/token/${m.token}`} style={{ color: "var(--arc-ink)", textDecoration: "none" }}><Logo t={{ logo: t?.logo, symbol: sym }} /><strong>{sym}</strong> {t && <span style={{ color: "var(--arc-muted)", fontSize: 11 }}>{t.pad}</span>}</a></td>
                        <td className="arc-mono" style={{ ...cell, color: m.chg >= 0 ? UP : DOWN, fontWeight: 700 }}>{m.chg >= 0 ? "+" : ""}{m.chg.toFixed(1)}%</td>
                        <td className="arc-mono" style={cell}>{priceStr(m.p1 / 1e6)}</td>
                        <td className="arc-mono" style={cell}>{usd(m.vol)}</td>
                        <td className="arc-mono" style={{ ...cell, color: "var(--arc-muted)" }}>{m.n}</td>
                        <td className="arc-mono" style={{ ...cell, color: c ? UP : "var(--arc-muted)" }}>{c ? `${c.insiders}` : "—"}</td>
                        <td style={{ ...cell, textAlign: "right" }}><BuyBtn symbol={sym} token={m.token} /></td>
                      </tr>); })}
                  </tbody>
                </table>
              )}
              {tab === "insiders" && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr><th style={hd}>token</th><th style={hd}>insiders</th><th style={hd}>ranks</th><th style={hd}>bought</th><th style={hd}>last</th><th style={hd}>MC</th><th style={hd} /></tr></thead>
                  <tbody>
                    {clusters.map((c) => { const t = byToken.get(c.token.toLowerCase()); const sym = c.symbol ?? t?.symbol ?? short(c.token); return (
                      <tr key={c.token}>
                        <td style={cell}><a href={`/token/${c.token}`} style={{ color: "var(--arc-ink)", textDecoration: "none" }}><Logo t={{ logo: t?.logo, symbol: sym }} /><strong>{sym}</strong></a></td>
                        <td className="arc-mono" style={{ ...cell, color: UP, fontWeight: 700 }}>{c.insiders}</td>
                        <td className="arc-mono" style={{ ...cell, color: "var(--arc-muted)" }}>#{c.ranks.split(",").slice(0, 5).join(" #")}</td>
                        <td className="arc-mono" style={cell}>{usd(c.usd)}</td>
                        <td className="arc-mono" style={{ ...cell, color: "var(--arc-muted)" }}>{ago(c.last_ts)}</td>
                        <td className="arc-mono" style={cell}>{usd(t?.mcapUsd ?? null)}</td>
                        <td style={{ ...cell, textAlign: "right" }}><BuyBtn symbol={sym} token={c.token} /></td>
                      </tr>); })}
                    {clusters.length === 0 && <tr><td className="arc-mono" colSpan={7} style={{ ...cell, color: "var(--arc-muted)" }}>No token with 2+ insiders in the last 24h.</td></tr>}
                  </tbody>
                </table>
              )}
              {tab === "holdings" && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr><th style={hd}>token</th><th style={hd}>amount</th><th style={hd}>avg entry</th><th style={hd}>price</th><th style={hd}>value</th><th style={hd}>unrealized</th><th style={hd}>realized</th><th style={hd}>sell</th></tr></thead>
                  <tbody>
                    {!addr && <tr><td className="arc-mono" colSpan={8} style={{ ...cell, color: "var(--arc-muted)" }}>Unlock the trading wallet to see holdings.</td></tr>}
                    {addr && positions.length === 0 && <tr><td className="arc-mono" colSpan={8} style={{ ...cell, color: "var(--arc-muted)" }}>No open positions yet (positions come from your on-chain swaps; new buys appear within seconds).</td></tr>}
                    {positions.map((p) => { const t = byToken.get(p.token.toLowerCase()); const sym = p.symbol ?? t?.symbol ?? short(p.token); return (
                      <tr key={p.token}>
                        <td style={cell}><a href={`/token/${p.token}`} style={{ color: "var(--arc-ink)", textDecoration: "none" }}><Logo t={{ logo: t?.logo, symbol: sym }} /><strong>{sym}</strong></a></td>
                        <td className="arc-mono" style={cell}>{num(p.net)}</td>
                        <td className="arc-mono" style={{ ...cell, color: "var(--arc-muted)" }}>{priceStr(p.avg || null)}</td>
                        <td className="arc-mono" style={cell}>{priceStr(p.price)}</td>
                        <td className="arc-mono" style={{ ...cell, fontWeight: 700 }}>{usd(p.value)}</td>
                        <td className="arc-mono" style={{ ...cell, color: (p.unrealized ?? 0) >= 0 ? UP : DOWN }}>{p.unrealized != null ? `${p.unrealized >= 0 ? "+" : "−"}${usd(Math.abs(p.unrealized))}${p.avg && p.price ? ` (${(((p.price - p.avg) / p.avg) * 100).toFixed(0)}%)` : ""}` : "—"}</td>
                        <td className="arc-mono" style={{ ...cell, color: p.realized >= 0 ? UP : DOWN }}>{p.realized >= 0 ? "+" : "−"}{usd(Math.abs(p.realized))}</td>
                        <td style={cell}>{[25, 50, 100].map((pc) => <button key={pc} className="arc-mono" disabled={busy === p.token} onClick={() => void sell(p, pc)} style={{ background: "transparent", border: "1px solid " + DOWN, borderRadius: 4, color: DOWN, cursor: "pointer", fontSize: 11, marginRight: 4, padding: "3px 7px" }} type="button">{pc}%</button>)}</td>
                      </tr>); })}
                  </tbody>
                </table>
              )}
            </div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 14 }}>
              Buys route through ArcAggregator (Uniswap V3 tiers, V4 pools, ArcToolsPad and Warp curves, split when it wins) with a 1% fee, 10% of it to $ARCT stakers. Need TP/SL, limit orders or copy-trade? <a href={SNIPER} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">Sniper bot</a>. Not financial advice.
            </p>
          </div>

          {/* RIGHT: wallet + toast */}
          <div style={{ display: "grid", gap: 12, height: "fit-content", position: "sticky", top: 96 }}>
            <WalletPanel onReady={setAddr} />
            {toast && (
              <div style={{ background: "var(--arc-paper)", border: "1px solid " + (toast.ok ? UP : DOWN), fontSize: 13, padding: 12 }}>
                <p style={{ margin: 0 }}>{toast.text}</p>
                {toast.tx && <a className="arc-mono" href={`https://arc-scan.org/tx/${toast.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11 }} target="_blank">{toast.tx.slice(0, 18)}… ↗</a>}
              </div>
            )}
            <div style={{ background: "var(--arc-paper)", border: "1px solid var(--arc-line)", fontSize: 12, padding: 12 }}>
              <p style={{ fontWeight: 700, margin: "0 0 6px" }}>How it works</p>
              <ol style={{ color: "var(--arc-muted)", margin: 0, paddingLeft: 18 }}>
                <li>Create a trading wallet (key stays in this browser, encrypted with your passcode).</li>
                <li>Deposit USDC on Arc to its address, or <a href="/bridge" style={{ color: "var(--arc-cobalt)" }}>bridge</a> from another chain.</li>
                <li>Pick an amount, hit ⚡ on any row. The aggregator finds the best venue; the tx signs locally, no popup.</li>
                <li>Sell 25/50/100% from Holdings. Withdraw or export the key any time.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
