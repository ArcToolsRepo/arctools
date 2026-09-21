/** The "More" pages. Each is small on purpose: one job, real data, no decoration. */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import * as HW from "../lib/arc-hotwallet";
import { api, type Trade } from "../lib/api";
import { usd, num, pct, ago, short, isAddr } from "../lib/fmt";
import { go, type Route } from "../lib/router";
import { getPrefs, setPrefs, toast, useStore, getWatch, loadRisk, getRisk } from "../lib/store";
import { Header, Icon, Logo } from "../components/ui";

export default function Sub({ route }: { route: Route }) {
  switch (route.name) {
    case "insiders": return <Insiders />;
    case "alerts": return <Alerts />;
    case "launchpad": return <Launchpad />;
    case "pay": return <Pay />;
    case "referrals": return <Referrals />;
    case "bridge": return <Bridge />;
    case "rewards": return <Rewards />;
    case "history": return <History />;
    case "profile": return <Profile wallet={route.wallet} />;
    case "settings": return <Settings />;
    default: return <><Header title="ArcTools" back /><div className="empty">Not here.</div></>;
  }
}

// ---------- Insiders ----------
type Insider = { wallet: string; pnl_total: number; pnl_pct: number; winrate: number; trades: number; volume: number; best_symbol: string | null; best_pnl: number; last_trade: number };
function Insiders() {
  const [rows, setRows] = useState<Insider[] | null>(null);
  useEffect(() => { api.insiders(100).then((r) => setRows(r as unknown as Insider[])).catch(() => setRows([])); }, []);
  return (
    <>
      <Header title="Insiders" back />
      <div className="muted" style={{ padding: "0 14px 8px", fontSize: 12.5 }}>Top-100 wallets by realised + unrealised PnL over 30 days. Tap one to see its trades; copy-trade from its profile.</div>
      {rows == null ? <div className="empty">Loading…</div> : rows.map((r, i) => (
        <div key={r.wallet} className="row" style={{ gridTemplateColumns: "28px 1fr auto" }} onClick={() => go(`/profile/${r.wallet}`)}>
          <span className="muted num" style={{ fontWeight: 700 }}>{i + 1}</span>
          <div className="row-main"><div className="row-name"><b className="mono" style={{ fontSize: 13.5 }}>{short(r.wallet, 5)}</b></div><div className="row-sub num"><span>{r.trades} trades</span><span>WR {Math.round((r.winrate ?? 0) * 100)}%</span>{r.best_symbol && <span className="up">best {r.best_symbol} +{usd(r.best_pnl)}</span>}</div></div>
          <div className="row-right"><div className={`row-mc ${r.pnl_total >= 0 ? "up" : "down"}`} style={{ color: undefined }}>{r.pnl_total >= 0 ? "+" : "−"}{usd(Math.abs(r.pnl_total))}</div><div className="row-chg muted">{ago(r.last_trade)} ago</div></div>
        </div>
      ))}
    </>
  );
}

// ---------- Alerts (watchlist-driven: dev sells, big moves, whales) ----------
function Alerts() {
  const watch = useStore(getWatch); const list = [...watch];
  const [feed, setFeed] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => { void loadRisk(list); api.feed(40).then(setFeed).catch(() => setFeed([])); }, [list.length]);
  return (
    <>
      <Header title="Alerts" back />
      <div className="label">Your watchlist · risk right now</div>
      {list.length === 0 ? <div className="empty">Watch a token (★) to get its dev/bundle alerts here.</div> : list.map((ca) => { const rk = getRisk(ca); const dn = rk?.dev_net_usd ?? 0; return (
        <div key={ca} className="row" onClick={() => go(`/token/${ca}`)}><Logo ca={ca} size={36} /><div className="row-main"><div className="row-name"><b>{short(ca)}</b></div><div className="row-sub">{dn > 50 ? <span className="dev">deployer took out {usd(dn)} in 24h</span> : rk?.bundle_net_usd && rk.bundle_net_usd > 50 ? <span className="dev">launch-block wallets sold {usd(rk.bundle_net_usd)}</span> : <span className="up">quiet</span>}</div></div><Icon.chev className="chev muted" /></div>
      ); })}
      <div className="label">Arc feed · X voices and headlines</div>
      {feed == null ? <div className="empty">Loading…</div> : feed.slice(0, 30).map((f, i) => (
        <a key={i} className="card" href={String(f.url ?? "#")} target="_blank" rel="noreferrer" style={{ display: "block", padding: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }} className="muted">{f.avatar ? <img alt="" src={String(f.avatar)} style={{ width: 20, height: 20, borderRadius: 10 }} /> : null}<b style={{ color: "var(--ink)" }}>{String(f.name ?? f.handle ?? f.source ?? "")}</b>{f.symbol ? <span className="pill green">${String(f.symbol)}</span> : null}<span style={{ marginLeft: "auto" }}>{ago(Number(f.ts))}</span></div>
          <div style={{ fontSize: 13.5, marginTop: 6 }}>{String(f.body ?? f.title ?? "").slice(0, 220)}</div>
        </a>
      ))}
    </>
  );
}

// ---------- Launchpad ----------
function Launchpad() {
  return (
    <>
      <Header title="ArcToolsPad" back />
      <div className="card"><b style={{ fontSize: 16 }}>Launch a token on Arc</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>30 USDC, instant. The launch flow needs an image upload and a few fields — it opens in the built-in browser with your app wallet's address prefilled.</p></div>
      <div style={{ padding: "0 14px" }}><a className="btn primary" href={`https://arctools.fun/launchpad2?from=${HW.hotAddress() ?? ""}`} target="_blank" rel="noreferrer">Open launchpad</a></div>
      <div className="label">Recent launches</div>
      <div className="empty" style={{ padding: 20 }}>Trending → chip "ArcToolsPad" shows every token launched here.</div>
    </>
  );
}

// ---------- Pay links ----------
function Pay() {
  const addr = HW.hotAddress();
  const [links, setLinks] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => { if (addr) api.claimsBySender(addr).then(setLinks).catch(() => setLinks([])); }, [addr]);
  return (
    <>
      <Header title="Pay links" back />
      <div className="card"><b style={{ fontSize: 16 }}>Send USDC with a link</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>Lock USDC in ArcClaim, share one link; the receiver claims to any wallet. 2% collection fee. Unclaimed links can be reclaimed.</p></div>
      <div style={{ padding: "0 14px" }}><a className="btn primary" href="https://arctools.fun/pay2" target="_blank" rel="noreferrer">Create a pay link</a></div>
      <div className="label">Your links</div>
      {!addr ? <div className="empty">Create a wallet first.</div> : links == null ? <div className="empty">Loading…</div> : links.length === 0 ? <div className="empty">No links yet.</div> : links.map((l, i) => (
        <div key={i} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span className="num">{usd(Number(l.amount ?? l.usdc ?? 0), 2)}</span><span className={String(l.state ?? l.status) === "claimed" ? "up" : "muted"}>{String(l.state ?? l.status ?? "")}</span><span className="muted">{ago(Number(l.ts ?? l.created))}</span></div>
      ))}
    </>
  );
}

// ---------- Referrals ----------
function Referrals() {
  const addr = HW.hotAddress(); const link = addr ? `https://arctools.fun/?ref=${addr}` : "";
  const [qr, setQr] = useState("");
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 200 }).then(setQr); }, [link]);
  return (
    <>
      <Header title="Referrals" back />
      <div className="card"><b style={{ fontSize: 16 }}>Earn 25% of the fees your invites generate</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>Paid in USDC, claimable any time on the site. Share your link or the QR.</p></div>
      {!addr ? <div className="empty">Create a wallet first.</div> : (
        <div className="card" style={{ textAlign: "center" }}>
          {qr && <img alt="" src={qr} style={{ width: 160, height: 160, borderRadius: 10, background: "#fff", padding: 6 }} />}
          <div className="mono" style={{ fontSize: 12, wordBreak: "break-all", margin: "10px 0" }}>{link}</div>
          <div className="grid2"><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(link); toast("Link copied", "ok"); }}>Copy link</button><button className="btn ghost sm" onClick={() => (navigator as { share?: (d: { url: string; text: string }) => Promise<void> }).share?.({ url: link, text: "Trade every Arc launchpad in one tap — ArcTools" })}>Share</button></div>
        </div>
      )}
      <div style={{ padding: "0 14px" }}><a className="btn ghost" href="https://arctools.fun/referrals2" target="_blank" rel="noreferrer">Earnings & claim ↗</a></div>
    </>
  );
}

// ---------- Bridge ----------
function Bridge() {
  return (
    <>
      <Header title="Bridge" back />
      <div className="card"><b style={{ fontSize: 16 }}>USDC from another chain → Arc</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>Circle CCTP. Ethereum, Base, Arbitrum, Polygon, Avalanche, Optimism. 2% fee → ARCT buyback. You need the source-chain wallet (MetaMask etc.), so this opens in the browser; paste your app address as the destination:</p>
        <button className="field" style={{ marginTop: 10, width: "100%" }} onClick={() => { navigator.clipboard?.writeText(HW.hotAddress() ?? ""); toast("Address copied", "ok"); }}><span className="mono" style={{ fontSize: 12.5, flex: 1, textAlign: "left" }}>{HW.hotAddress() ?? "create a wallet first"}</span><Icon.copy className="" /></button>
      </div>
      <div style={{ padding: "0 14px" }}><a className="btn primary" href="https://arctools.fun/bridge2" target="_blank" rel="noreferrer">Open bridge</a></div>
    </>
  );
}

// ---------- Rewards / ARCT ----------
function Rewards() {
  const [burn, setBurn] = useState<Record<string, number> | null>(null); const [bb, setBb] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { api.burn().then((r) => setBurn(r as Record<string, number>)).catch(() => undefined); api.buyback().then(setBb).catch(() => undefined); }, []);
  const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";
  return (
    <>
      <Header title="ARCT" back />
      <div className="tiles" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="tile"><small>Burned</small><b className="up">{burn ? `${num(burn.burned)} (${burn.pct?.toFixed(2)}%)` : "…"}</b></div>
        <div className="tile"><small>Buybacks</small><b>{bb ? `${bb.runs} runs · ${usd(Number(bb.usdc_spent), 0)}` : "…"}</b></div>
      </div>
      <div className="card"><b>How it works</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>Every fee — 0.5% swap, 1% sniper, 1% pad trade, 2% bridge, 2% pay-link — lands in the treasury. A keeper buys ARCT and sends it to the burn address in the same transaction, on schedule. Nothing is held; everything is verifiable on chain.</p></div>
      <div className="grid2" style={{ padding: "0 14px" }}><button className="btn primary" onClick={() => go(`/token/${ARCT}`)}>Trade ARCT</button><a className="btn ghost" href="https://arctools.fun/rewards2" target="_blank" rel="noreferrer">Staking ↗</a></div>
    </>
  );
}

// ---------- History ----------
function History() {
  const addr = HW.hotAddress();
  const [rows, setRows] = useState<(Trade & { token: string; symbol?: string })[] | null>(null);
  useEffect(() => { if (addr) api.walletTrades(addr, 100).then((r) => setRows(r as (Trade & { token: string; symbol?: string })[])).catch(() => setRows([])); }, [addr]);
  return (
    <>
      <Header title="History" back />
      {!addr ? <div className="empty">Create a wallet first.</div> : rows == null ? <div className="empty">Loading…</div> : rows.length === 0 ? <div className="empty">No trades yet.</div> : rows.map((x) => (
        <div key={x.tx + x.ts} className="trade-row" style={{ gridTemplateColumns: "44px 1fr auto" }} onClick={() => go(`/token/${x.token}`)}>
          <span className="muted num">{ago(x.ts)}</span>
          <div><b className={x.side === "buy" ? "up" : "down"}>{x.side.toUpperCase()}</b> <b>{x.symbol ?? short(x.token)}</b><div className="muted num" style={{ fontSize: 12 }}>{num(x.tokens)} · {x.venue}</div></div>
          <b className="num">{usd(x.usdc, 2)}</b>
        </div>
      ))}
    </>
  );
}

// ---------- Profile ----------
function Profile({ wallet }: { wallet?: string }) {
  const w = (wallet ?? HW.hotAddress() ?? "").toLowerCase();
  const [p, setP] = useState<{ profile?: Record<string, unknown>; stats?: Record<string, number | null> } | null>(null);
  const [rows, setRows] = useState<(Trade & { token: string; symbol?: string })[]>([]);
  useEffect(() => { if (!isAddr(w)) return; fetch(`https://bot-production-4200.up.railway.app/api/profile?wallet=${w}`).then((r) => r.json()).then(setP).catch(() => setP({})); api.walletTrades(w, 40).then((r) => setRows(r as typeof rows)).catch(() => undefined); }, [w]);
  const s = p?.stats ?? {}; const pr = p?.profile ?? {};
  return (
    <>
      <Header title={String(pr.display ?? pr.handle ?? short(w, 5))} back right={<button className="icon-btn" onClick={() => { navigator.clipboard?.writeText(w); toast("Address copied", "ok"); }}><Icon.copy className="" /></button>} />
      {!isAddr(w) ? <div className="empty">No wallet.</div> : (
        <>
          <div className="tiles"><div className="tile"><small>PnL</small><b className={(s.pnl_total ?? 0) >= 0 ? "up" : "down"}>{s.pnl_total != null ? `${s.pnl_total >= 0 ? "+" : "−"}${usd(Math.abs(s.pnl_total))}` : "—"}</b></div><div className="tile"><small>Volume</small><b>{usd(s.volume)}</b></div><div className="tile"><small>Trades</small><b>{num(s.trades)}</b></div><div className="tile"><small>Win</small><b>{s.winrate != null ? `${Math.round(s.winrate * 100)}%` : "—"}</b></div></div>
          {pr.bio ? <div className="card muted" style={{ fontSize: 13.5 }}>{String(pr.bio)}</div> : null}
          {w !== (HW.hotAddress() ?? "").toLowerCase() && <div style={{ padding: "0 14px 10px" }}><a className="btn primary" href={`https://t.me/ArcSniper_bot?start=copy_${w.replace(/^0x/, "")}`} target="_blank" rel="noreferrer">Copy-trade in @ArcSniper_bot</a></div>}
          <div className="label">Recent trades</div>
          {rows.map((x) => <div key={x.tx + x.ts} className="trade-row" style={{ gridTemplateColumns: "44px 1fr auto" }} onClick={() => go(`/token/${x.token}`)}><span className="muted num">{ago(x.ts)}</span><div><b className={x.side === "buy" ? "up" : "down"}>{x.side.toUpperCase()}</b> <b>{x.symbol ?? short(x.token)}</b></div><b className="num">{usd(x.usdc, 2)}</b></div>)}
        </>
      )}
    </>
  );
}

// ---------- Settings ----------
function Settings() {
  const prefs = useStore(getPrefs);
  const [pre, setPre] = useState(prefs.presets.join(", "));
  return (
    <>
      <Header title="Settings" back />
      <div className="label">Trading</div>
      <div className="card">
        <div className="kv" style={{ borderTop: 0 }}><span>Sell slippage</span><div style={{ display: "flex", gap: 6 }}>{[1, 3, 5, 10].map((s) => <button key={s} className={`pill ${prefs.slippage === s ? "green" : ""}`} onClick={() => setPrefs({ slippage: s })}>{s}%</button>)}</div></div>
        <div className="kv"><span>Quick-buy default</span><div style={{ display: "flex", gap: 6 }}>{prefs.presets.map((s) => <button key={s} className={`pill ${prefs.quickBuy === s ? "green" : ""}`} onClick={() => setPrefs({ quickBuy: s })}>{s}</button>)}</div></div>
        <div className="kv" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}><span>Preset amounts (USDC)</span><div className="field" style={{ padding: "8px 12px" }}><input value={pre} onChange={(e) => setPre(e.target.value)} onBlur={() => { const v = pre.split(",").map((x) => Number(x.trim())).filter((x) => x > 0).slice(0, 4); if (v.length) setPrefs({ presets: v, quickBuy: v.includes(prefs.quickBuy) ? prefs.quickBuy : v[0] }); }} inputMode="decimal" /></div></div>
        <div className="kv"><span>Buy slippage</span><b className="muted">none — buys fill at any price</b></div>
      </div>
      <div className="label">Lists</div>
      <div className="card">
        <div className="kv" style={{ borderTop: 0 }}><span>Hide clone farms</span><button className={`pill ${prefs.hideClones ? "green" : ""}`} onClick={() => setPrefs({ hideClones: !prefs.hideClones })}>{prefs.hideClones ? "on" : "off"}</button></div>
      </div>
      <div className="label">About</div>
      <div className="card muted" style={{ fontSize: 12.5 }}>ArcTools for Android v1.1 · arctools.fun · Fees fund ARCT buybacks that burn in the same transaction. Your key never leaves this phone. Internal review only — no third-party audit.</div>
    </>
  );
}
