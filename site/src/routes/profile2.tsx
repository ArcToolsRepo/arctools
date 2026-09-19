import { createFileRoute } from "@tanstack/react-router";
import { BOT_API } from "@/lib/bot-api";
import { FollowingFeed, ProfileEditor } from "@/components/profile-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { DsRail } from "@/components/ds-rail";
import { WalletPanel } from "@/components/wallet-panel";
import { hotAddress, hotBalance, hotCall, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { getPortfolio } from "@/lib/arc-api";
import { routeSwap } from "@/lib/arc-route";
import { creditRef } from "@/lib/arc-ref";
import { ARC_AGGREGATOR, encodeAggregatorSwap, p32, pnum } from "@/lib/arc-wallet";
import "../arc-site.css";

const API = BOT_API;

export const Route = createFileRoute("/profile2")({
  head: () => ({ meta: [{ title: "ArcTools Profile: trading wallet balance, holdings, trades, PnL" }, { content: "Your in-browser trading wallet on Arc: deposited USDC, open positions with PnL, full trade history, deposits and withdrawals.", name: "description" }] }),
  component: Profile,
});

type Position = { token: string; symbol: string | null; net: number; avg: number; price: number | null; value: number | null; unrealized: number | null; realized: number; cost: number; proceeds: number; n: number; last_ts: number; onchain?: boolean; external?: boolean };
type Trade = { tx: string; ts: number; token: string; side: string; usdc: number; tokens: number; price1m: number | null; venue: string; symbol: string | null };
type Hist = { trades: Trade[]; summary: { n: number; bought: number; sold: number; first_ts: number; tokens: number }; stats: { range: string; pnl_realized: number; pnl_unrealized: number; pnl_total: number; winrate: number; closed: number; volume: number }[] };
type Move = { wallet: string; ts: number; balance: number; delta: number };

const usd = (v: number | null | undefined) => (v == null ? "—" : Math.abs(v) < 0.005 ? "$0.00" : `${v < 0 ? "−" : ""}$${Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e4 ? (Math.abs(v) / 1e3).toFixed(1) + "K" : Math.abs(v) >= 1000 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(2)}`);
const num = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(2));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "short" });
const priceStr = (p: number | null) => (p == null ? "—" : p >= 1 ? `$${p.toFixed(4)}` : `$${p.toFixed(Math.max(2, -Math.floor(Math.log10(p)) + 3))}`);
const UP = "var(--arc-up)", DOWN = "var(--arc-down, #f0534f)";
const card: React.CSSProperties = { background: "var(--arc-paper)", border: "1px solid var(--arc-line)", padding: 16 };
const th: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 10, fontWeight: 400, padding: "0 10px 8px 0", textAlign: "left", textTransform: "uppercase" };
const td: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 13, padding: "9px 10px 9px 0", whiteSpace: "nowrap" };
const SEL = { balanceOf: "0x70a08231", allowance: "0xdd62ed3e", approve: "0x095ea7b3", transfer: "0xa9059cbb" };

function Profile() {
  const [addr, setAddr] = useState<string | null>(isUnlocked() ? hotAddress() : null);
  const [bal, setBal] = useState<number | null>(null);
  const [pos, setPos] = useState<Position[]>([]);
  const [hist, setHist] = useState<Hist | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [closed, setClosed] = useState<Position[]>([]);
  const [tab, setTab] = useState<"holdings" | "trades" | "flows">("holdings");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const [sendTok, setSendTok] = useState<{ token: string; to: string; pct: number } | null>(null);
  const [tradeFilter, setTradeFilter] = useState("");

  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    const a = isUnlocked() ? hotAddress() : null;
    setAddr(a);
    if (!a) { setPos([]); setHist(null); setBal(null); return; }
    const w = a.toLowerCase();
    // deposits/withdrawals are a chain-wide query and nothing above the fold needs them — never block the page on it
    void fetch(`${API}/api/balance-moves?hours=336&min_usd=1`)
      .then((r) => r.json())
      .then((mv: { rows?: Move[] }) => setMoves((mv?.rows ?? []).filter((x) => x.wallet.toLowerCase() === w)))
      .catch(() => null);
    const [b, p, h, chain] = await Promise.all([
      Promise.resolve<number | null>(null),   // balance has its own reader below
      fetch(`${API}/api/positions?wallet=${w}`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/api/wallet-trades?wallet=${w}&limit=300`).then((r) => r.json()).catch(() => null),
      getPortfolio({ data: { wallet: a } }).catch(() => null),   // arc-scan indexer: EVERY erc20 the wallet holds
    ]);
    if (my !== seq.current) return;
    // merge: on-chain balances are the source of truth for amount/value; the swap index adds avg entry + realized PnL
    const idx = new Map<string, Position>(((p?.positions ?? []) as Position[]).map((x) => [x.token.toLowerCase(), x]));
    const merged: Position[] = [];
    const seen = new Set<string>();
    const holdings = chain && !("error" in chain) ? chain.holdings : [];
    for (const hld of holdings) {
      const k = hld.token.toLowerCase();
      seen.add(k);
      const ix = idx.get(k);
      const amount = hld.amount;
      if (amount <= 0) continue;
      // on-chain quote (quoter / curve / screener via getPortfolio) is the truth; the index price is only a fallback
      const price = hld.valueUsdc != null && amount > 0 ? hld.valueUsdc / amount : (ix?.price ?? null);
      const value = hld.valueUsdc ?? (price ? price * amount : null);
      merged.push({
        token: hld.token, symbol: ix?.symbol ?? hld.symbol, net: amount, avg: ix?.avg ?? 0, price, value,
        unrealized: ix && ix.avg && price ? (price - ix.avg) * amount : null,
        realized: ix?.realized ?? 0, cost: ix?.cost ?? 0, proceeds: ix?.proceeds ?? 0, n: ix?.n ?? 0, last_ts: ix?.last_ts ?? 0,
        onchain: true, external: !ix,
      });
    }
    // index positions the indexer did not list (indexer lag right after a buy): keep them until the next refresh
    for (const [k, ix] of idx) if (!seen.has(k) && ix.net > 0 && (ix.value ?? 0) >= 0.01 && holdings.length === 0) merged.push(ix);
    merged.sort((x, y) => (y.value ?? 0) - (x.value ?? 0));
    const gotSomething = holdings.length > 0 || ((p?.positions ?? []) as Position[]).length > 0;
    if (gotSomething) setPos(merged.filter((x) => (x.value ?? 0) >= 0.005 || x.external));
    if (h) setHist(h);
    // every token the wallet ever traded — closed ones carry realized PnL even with nothing left to show as a holding
    if (p?.positions) {
      setClosed(((p?.positions ?? []) as Position[]).filter((x) => x.net <= 0.000001 && Math.abs(x.realized ?? 0) >= 0.01)
        .sort((x, y) => Math.abs(y.realized ?? 0) - Math.abs(x.realized ?? 0)));
    }
    // one quick retry when a source failed, so the first paint is not stuck on "…" for 20 seconds
    if ((!h || !gotSomething) && my === seq.current) {
      setTimeout(() => { if (my === seq.current) void load(); }, 2500);
    }
  }, []);
  useEffect(() => { void load(); const id = setInterval(load, 20_000); const off = onHotChange(() => void load()); return () => { clearInterval(id); off(); }; }, [load]);
  // The balance gets its own reader. It used to ride along with the big load(), where a single failed round —
  // or the 20 s interval bumping the sequence guard — left the tile on "…" while the wallet panel next to it,
  // which reads on its own, showed the number fine. Retries fast until it has a value, then settles.
  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const a = isUnlocked() ? hotAddress() : null;
      if (!alive) return;
      if (!a) { setBal(null); timer = setTimeout(tick, 4000); return; }
      const b = await hotBalance(a).catch(() => null);
      if (!alive) return;
      if (b != null) { setBal(b); tries = 0; timer = setTimeout(tick, 15_000); }
      else { tries += 1; timer = setTimeout(tick, Math.min(8000, 1500 * tries)); }
    };
    void tick();
    const off = onHotChange(() => { if (timer) clearTimeout(timer); void tick(); });
    return () => { alive = false; if (timer) clearTimeout(timer); off(); };
  }, []);

  const totals = useMemo(() => {
    const value = pos.reduce((s, p) => s + (p.value ?? 0), 0);
    const unreal = pos.reduce((s, p) => s + (p.unrealized ?? 0), 0);
    // realized PnL counts every token the wallet has ever closed, not only what it still holds
    const realOpen = pos.reduce((s, p) => s + (p.realized ?? 0), 0);
    const realClosed = closed.reduce((s, p) => s + (p.realized ?? 0), 0);
    const realized = realOpen + realClosed;
    const s30 = hist?.stats.find((x) => x.range === "30d");
    const sAll = hist?.stats.find((x) => x.range === "all");
    return { value, unreal, realized, total: realized + unreal, s30, sAll, equity: (bal ?? 0) + value };
  }, [pos, closed, hist, bal]);

  const sell = async (p: Position, pct: number) => {
    if (!addr) return;
    setBusy(p.token); setToast(null);
    try {
      const balRaw = BigInt((await hotCall(p.token, SEL.balanceOf + p32(addr))) || "0x0");
      const amt = (balRaw * BigInt(pct)) / 100n;
      if (amt <= 0n) throw new Error("Nothing to sell.");
      const r = await routeSwap({ data: { token: p.token, side: "sell", amount: amt.toString() } });
      if (r.error || r.legs.length === 0) throw new Error("No route to sell this token right now.");
      const al = BigInt((await hotCall(p.token, SEL.allowance + p32(addr) + p32(ARC_AGGREGATOR))) || "0x0");
      if (al < amt) await hotWait(await hotSend({ to: p.token, data: SEL.approve + p32(ARC_AGGREGATOR) + "f".repeat(64), gasLimit: 80_000n }));
      const minOut = (BigInt(r.out) * 985n * 90n) / 100_000n;
      const legs = r.legs.map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
      const h = await hotSend({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("sell", p.token, legs, minOut, addr, 150) });
      setToast({ ok: true, text: `Selling ${pct}% of ${p.symbol ?? short(p.token)}…`, tx: h });
      const rc = await hotWait(h);
      setToast({ ok: rc.status === 1, text: rc.status === 1 ? `Sold ${pct}% of ${p.symbol ?? short(p.token)} → USDC in the wallet.` : "Sell reverted.", tx: h });
      if (rc.status === 1) creditRef(addr, h, (Number(r.out) / 1e18) * 0.015);
      void load();
    } catch (e) { setToast({ ok: false, text: (e as Error).message }); }
    setBusy(null);
  };
  const sendToken = async () => {
    if (!addr || !sendTok || !/^0x[0-9a-fA-F]{40}$/.test(sendTok.to)) { setToast({ ok: false, text: "Enter a valid destination address." }); return; }
    setBusy(sendTok.token); setToast(null);
    try {
      const balRaw = BigInt((await hotCall(sendTok.token, SEL.balanceOf + p32(addr))) || "0x0");
      const amt = (balRaw * BigInt(sendTok.pct)) / 100n;
      const h = await hotSend({ to: sendTok.token, data: SEL.transfer + p32(sendTok.to) + pnum(amt), gasLimit: 90_000n });
      setToast({ ok: true, text: `Sending ${sendTok.pct}% of the token…`, tx: h });
      const rc = await hotWait(h);
      setToast({ ok: rc.status === 1, text: rc.status === 1 ? "Token withdrawal confirmed." : "Transfer reverted.", tx: h });
      setSendTok(null); void load();
    } catch (e) { setToast({ ok: false, text: (e as Error).message }); }
    setBusy(null);
  };

  const trades = (hist?.trades ?? []).filter((t) => !tradeFilter || `${t.symbol ?? ""} ${t.token}`.toLowerCase().includes(tradeFilter.toLowerCase()));

  return (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />
      <section className="arc-dsp__body" style={{ maxWidth: 1360, paddingTop: 118 }}>
        <div className="arc-2col" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
          <div>
            <h1 style={{ fontSize: 26, margin: "0 0 4px" }}>Profile</h1>
            <p style={{ color: "var(--arc-muted)", fontSize: 13, margin: "0 0 14px" }}>Your trading wallet: what is in it, what it is worth, what it did. {addr && <span className="arc-mono">{addr}</span>}</p>


            {!addr && (
              <div style={{ ...card, border: "1px solid var(--arc-cobalt)" }}>
                <p style={{ fontSize: 15, margin: 0 }}>Unlock or create the trading wallet on the right to see your balance, holdings and history.</p>
                <p style={{ color: "var(--arc-muted)", fontSize: 12, margin: "6px 0 0" }}>Everything here is read from the chain and our swap index for that address — nothing is stored on our side.</p>
              </div>
            )}

            {addr && (
              <>
                {/* One card that leads with the number you came for, instead of eight identical boxes mostly
                    printing $0.00. Secondary figures stay, but as a supporting row rather than as peers. */}
                <div style={{ background: "var(--arc-paper, #0f1218)", border: "1px solid var(--arc-line)", borderRadius: 18, marginBottom: 14, padding: "20px 22px" }}>
                  <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between" }}>
                    <div>
                      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, textTransform: "uppercase" }}>total equity</div>
                      <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -0.8 }}>{usd(totals.equity)}</div>
                      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 6 }}>
                        {bal !== null ? `${bal.toFixed(2)} USDC` : "… USDC"} + {usd(totals.value)} in {pos.length} token{pos.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, textTransform: "uppercase" }}>pnl total</div>
                      <div style={{ color: totals.total >= 0 ? UP : DOWN, fontSize: 26, fontWeight: 700 }}>
                        {totals.total >= 0 ? "+" : ""}{usd(totals.total)}
                      </div>
                      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 4 }}>realized + open</div>
                    </div>
                  </div>
                  <div style={{ borderTop: "1px solid var(--arc-line)", display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 18, paddingTop: 14 }}>
                    {([
                      ["realized", usd(totals.realized), `${closed.length} closed`, totals.realized],
                      ["unrealized", usd(totals.unreal), "vs average entry", totals.unreal],
                      ["realized 30d", totals.s30 ? usd(totals.s30.pnl_realized) : "—", totals.s30 ? `win-rate ${Math.round(totals.s30.winrate)}%` : "no closed positions yet", totals.s30?.pnl_realized],
                      ["volume all-time", usd((hist?.summary.bought ?? 0) + (hist?.summary.sold ?? 0)), `${hist?.summary.n ?? 0} trades · ${hist?.summary.tokens ?? 0} tokens`, undefined],
                    ] as Array<[string, string, string, number | undefined]>).map(([k, v, sub, sign]) => (
                      <div key={k}>
                        <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, textTransform: "uppercase" }}>{k}</div>
                        <div className="arc-mono" style={{ color: typeof sign === "number" ? (sign >= 0 ? UP : DOWN) : "var(--arc-ink)", fontSize: 19, fontWeight: 700, margin: "3px 0 2px" }}>{v}</div>
                        <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10 }}>{sub}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* tabs */}
                <div style={{ borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 2, marginBottom: 8 }}>
                  {([["holdings", `Holdings (${pos.length})`], ["trades", `Trades (${hist?.summary.n ?? 0})`], ["flows", "Deposits & withdrawals"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setTab(k)} style={{ background: "transparent", border: "none", borderBottom: "2px solid " + (tab === k ? "var(--arc-cobalt)" : "transparent"), color: tab === k ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 14, fontWeight: tab === k ? 700 : 400, padding: "8px 14px" }} type="button">{l}</button>
                  ))}
                </div>

                <div style={{ overflowX: "auto" }}>
                  {tab === "holdings" && (
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead><tr><th style={th}>token</th><th style={th}>amount</th><th style={th}>avg entry</th><th style={th}>price</th><th style={th}>value</th><th style={th}>unrealized</th><th style={th}>realized</th><th style={th}>sell</th><th style={th}>withdraw</th></tr></thead>
                      <tbody>
                        {pos.length === 0 && closed.length > 0 && <tr><td className="arc-mono" colSpan={9} style={{ ...td, color: "var(--arc-muted)" }}>Nothing open right now — realized PnL from closed positions is below.</td></tr>}
                        {pos.length === 0 && closed.length === 0 && <tr><td className="arc-mono" colSpan={9} style={{ ...td, color: "var(--arc-muted)" }}>No open positions. Buy something in the <a href="/trade2" style={{ color: "var(--arc-cobalt)" }}>Terminal</a>.</td></tr>}
                        {pos.map((p) => (
                          <tr key={p.token}>
                            <td style={td}><a href={`/token2/${p.token}`} style={{ color: "var(--arc-ink)" }}><strong>{p.symbol ?? short(p.token)}</strong></a>{p.external && <span className="arc-mono" style={{ border: "1px solid var(--arc-line)", borderRadius: 3, color: "var(--arc-muted)", fontSize: 9, marginLeft: 6, padding: "0 4px" }} title="Held on-chain but not bought through a swap from this wallet (transferred in) — no entry price, so no PnL">transferred in</span>}</td>
                            <td className="arc-mono" style={td}>{num(p.net)}</td>
                            <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{p.avg ? priceStr(p.avg) : "—"}</td>
                            <td className="arc-mono" style={td}>{priceStr(p.price)}</td>
                            <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(p.value)}</td>
                            <td className="arc-mono" style={{ ...td, color: (p.unrealized ?? 0) >= 0 ? UP : DOWN }}>{p.unrealized != null ? `${usd(p.unrealized)}${p.avg && p.price ? ` (${(((p.price - p.avg) / p.avg) * 100).toFixed(0)}%)` : ""}` : "—"}</td>
                            <td className="arc-mono" style={{ ...td, color: p.realized >= 0 ? UP : DOWN }}>{usd(p.realized)}</td>
                            <td style={td}>{[25, 50, 100].map((pc) => <button key={pc} className="arc-mono" disabled={busy === p.token} onClick={() => void sell(p, pc)} style={{ background: "transparent", border: "1px solid " + DOWN, borderRadius: 4, color: DOWN, cursor: "pointer", fontSize: 11, marginRight: 4, padding: "3px 7px" }} type="button">{pc}%</button>)}</td>
                            <td style={td}><button className="arc-mono" onClick={() => setSendTok({ token: p.token, to: "", pct: 100 })} style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 7px" }} type="button">send</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {tab === "holdings" && closed.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, letterSpacing: "0.08em", marginBottom: 6 }}>
                        CLOSED · realized {usd(closed.reduce((acc, c) => acc + (c.realized ?? 0), 0))}
                      </div>
                      <table style={{ borderCollapse: "collapse", width: "100%" }}>
                        <tbody>
                          {closed.slice(0, 20).map((c) => (
                            <tr key={c.token}>
                              <td style={td}><a href={`/token2/${c.token}`} style={{ color: "var(--arc-ink)" }}>{c.symbol ?? short(c.token)}</a></td>
                              <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{c.n} trades</td>
                              <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>in {usd(c.cost ?? 0)}</td>
                              <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>out {usd(c.proceeds ?? 0)}</td>
                              <td className="arc-mono" style={{ ...td, color: (c.realized ?? 0) >= 0 ? UP : DOWN, fontWeight: 700, textAlign: "right" }}>{usd(c.realized ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {tab === "trades" && (
                    <>
                      <input className="arc-mono" onChange={(e) => setTradeFilter(e.target.value)} placeholder="filter by symbol / CA" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, marginBottom: 8, padding: "6px 10px", width: 260 }} value={tradeFilter} />
                      <table style={{ borderCollapse: "collapse", width: "100%" }}>
                        <thead><tr><th style={th}>time</th><th style={th}>side</th><th style={th}>token</th><th style={th}>USDC</th><th style={th}>tokens</th><th style={th}>price</th><th style={th}>venue</th><th style={th}>tx</th></tr></thead>
                        <tbody>
                          {trades.length === 0 && <tr><td className="arc-mono" colSpan={8} style={{ ...td, color: "var(--arc-muted)" }}>No trades indexed for this wallet yet.</td></tr>}
                          {trades.map((t) => (
                            <tr key={t.tx + t.ts}>
                              <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{when(t.ts)}</td>
                              <td className="arc-mono" style={{ ...td, color: t.side === "buy" ? UP : DOWN, fontWeight: 700 }}>{t.side.toUpperCase()}</td>
                              <td style={td}><a href={`/token2/${t.token}`} style={{ color: "var(--arc-ink)" }}>{t.symbol ?? short(t.token)}</a></td>
                              <td className="arc-mono" style={td}>{usd(t.usdc)}</td>
                              <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{num(t.tokens)}</td>
                              <td className="arc-mono" style={td}>{priceStr(t.price1m ? t.price1m / 1e6 : null)}</td>
                              <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{t.venue}</td>
                              <td style={td}><a className="arc-mono" href={`https://arc-scan.org/tx/${t.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11 }} target="_blank">↗</a></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                  {tab === "flows" && (
                    <>
                      <p style={{ color: "var(--arc-muted)", fontSize: 12, margin: "0 0 8px" }}>USDC balance changes between snapshots (every 10 min) that were not swaps: deposits, withdrawals, bridge arrivals. Snapshots start once the wallet has traded at least once.</p>
                      <table style={{ borderCollapse: "collapse", width: "100%" }}>
                        <thead><tr><th style={th}>time</th><th style={th}>change</th><th style={th}>balance after</th></tr></thead>
                        <tbody>
                          {moves.length === 0 && <tr><td className="arc-mono" colSpan={3} style={{ ...td, color: "var(--arc-muted)" }}>No recorded deposits or withdrawals yet. Use the explorer for the full ledger: <a href={`https://arc-scan.org/address/${addr}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">arc-scan ↗</a></td></tr>}
                          {moves.map((m) => (
                            <tr key={m.ts}>
                              <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{when(m.ts)}</td>
                              <td className="arc-mono" style={{ ...td, color: m.delta >= 0 ? UP : DOWN, fontWeight: 700 }}>{m.delta >= 0 ? "+" : "−"}{Math.abs(m.delta).toFixed(2)} USDC</td>
                              <td className="arc-mono" style={td}>{m.balance.toFixed(2)} USDC</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="arc-aside" style={{ display: "grid", gap: 12, height: "fit-content", position: "sticky", top: 96 }}>
            <WalletPanel onReady={() => void load()} />
            {toast && (
              <div style={{ background: "var(--arc-paper)", border: "1px solid " + (toast.ok ? UP : DOWN), fontSize: 13, padding: 12 }}>
                <p style={{ margin: 0 }}>{toast.text}</p>
                {toast.tx && <a className="arc-mono" href={`https://arc-scan.org/tx/${toast.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 11 }} target="_blank">{toast.tx.slice(0, 18)}… ↗</a>}
              </div>
            )}
            {sendTok && (
              <div style={{ ...card, border: "1px solid var(--arc-cobalt)" }}>
                <p style={{ fontWeight: 700, margin: "0 0 6px" }}>Withdraw token</p>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 8px" }}>{short(sendTok.token)}</p>
                <input className="arc-mono" onChange={(e) => setSendTok({ ...sendTok, to: e.target.value })} placeholder="to 0x…" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 12, marginBottom: 6, padding: "8px 10px", width: "100%" }} value={sendTok.to} />
                <div style={{ display: "flex", gap: 6 }}>
                  {[25, 50, 100].map((pc) => <button key={pc} className="arc-mono" onClick={() => setSendTok({ ...sendTok, pct: pc })} style={{ background: sendTok.pct === pc ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (sendTok.pct === pc ? "var(--arc-cobalt)" : "var(--arc-line)"), color: sendTok.pct === pc ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "3px 8px" }} type="button">{pc}%</button>)}
                  <button className="arc-cta" disabled={!!busy} onClick={() => void sendToken()} style={{ marginLeft: "auto" }} type="button">Send</button>
                  <button className="arc-mono" onClick={() => setSendTok(null)} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer", fontSize: 11 }} type="button">cancel</button>
                </div>
              </div>
            )}
            <div style={{ ...card, fontSize: 12 }}>
              <p style={{ fontWeight: 700, margin: "0 0 6px" }}>Where the numbers come from</p>
              <ul style={{ color: "var(--arc-muted)", margin: 0, paddingLeft: 18 }}>
                <li>USDC balance: live from the chain.</li>
                <li>Positions and trades: our chain-wide swap index for this address (every venue on Arc).</li>
                <li>Prices: last indexed trade per token; PnL uses average cost.</li>
                <li>Holdings: every ERC-20 the wallet holds (arc-scan indexer), so transferred-in tokens appear too — marked "transferred in", sellable and withdrawable, but without entry price.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      {/* the public profile is built AFTER the wallet exists, so it sits below it */}
      <section className="arc-dsp__body" style={{ maxWidth: 1760, paddingTop: 10 }}>
        <ProfileEditor />
        <FollowingFeed />
      </section>
    </main>
  );
}
