import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, streamUrl, type Trend } from "../lib/api";
import { isAddr } from "../lib/fmt";
import { go } from "../lib/router";
import { allTokens, applyTrendFrame, getPrefs, getToken, getTrend, getHot, getWatch, loadList, loadLogos, loadRisk, loadTrending, orders, useStore } from "../lib/store";
import * as HW from "../lib/arc-hotwallet";
import { quickBuy } from "../lib/trade";
import { Header, Icon, Skeleton, TokenRow } from "../components/ui";
import { BuySheet } from "../components/BuySheet";

type Tab = "trending" | "new" | "top" | "gainers" | "watch";
const TABS: [Tab, string][] = [["trending", "Trending"], ["new", "New"], ["top", "Volume"], ["gainers", "Gainers"], ["watch", "★"]];

export default function Trending() {
  const [tab, setTab] = useState<Tab>("trending");
  const [pad, setPad] = useState<string>("all");
  const [pads, setPads] = useState<{ pad: string; n: number; label?: string; logo?: string | null }[]>([]);
  const [q, setQ] = useState(""); const [searching, setSearching] = useState(false);
  const [buyFor, setBuyFor] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const snapshot = useStore(useCallback(() => ({ o: orders(), n: allTokens().length, w: getWatch().size }), []));
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void loadTrending(); void loadList(); api.padcounts().then(setPads).catch(() => undefined); }, []);
  // push feed: trending frames arrive as the bot refreshes them; the poller is only the safety net
  useEffect(() => {
    let es: EventSource | null = null; let closed = false; let backoff = 2000; let lastBeat = Date.now();
    const open = () => {
      if (closed) return;
      es = new EventSource(streamUrl());
      const beat = () => { lastBeat = Date.now(); setLive(true); };
      es.addEventListener("hello", beat); es.addEventListener("chain", beat);
      es.addEventListener("trending", (ev) => { beat(); try { const q = (ev as MessageEvent).lastEventId || ""; const j = JSON.parse((ev as MessageEvent).data) as { rows?: Trend[] }; if (j.rows?.length) applyTrendFrame(q, j.rows); } catch { /* bad frame */ } });
      es.onerror = () => { setLive(false); es?.close(); es = null; if (!closed) setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15_000); };
    };
    open();
    const pulse = setInterval(() => { if (Date.now() - lastBeat > 40_000) { setLive(false); es?.close(); es = null; if (!closed) open(); } }, 5000);
    const poll = setInterval(() => { if (!document.hidden) void loadTrending(!live); }, live ? 60_000 : 15_000);
    return () => { closed = true; es?.close(); clearInterval(pulse); clearInterval(poll); };
  }, [live]);

  const rows = useMemo(() => {
    const { hot, trend, all } = snapshot.o; const hide = getPrefs().hideClones;
    const clone = (ca: string) => !!(getHot(ca)?.clone || getTrend(ca)?.clone);
    let base: string[];
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      if (isAddr(s)) return [s];
      base = all.filter((ca) => { const t = getToken(ca); return t && (t.symbol?.toLowerCase().includes(s) || t.name?.toLowerCase().includes(s)); }).slice(0, 60);
      return base;
    }
    switch (tab) {
      case "trending": base = hot.length ? hot : trend; break;
      case "new": base = [...all].sort((a, b) => Date.parse(getToken(b)?.createdAt ?? "0") - Date.parse(getToken(a)?.createdAt ?? "0")); break;
      case "top": base = [...trend].sort((a, b) => (getTrend(b)?.vol ?? 0) - (getTrend(a)?.vol ?? 0)); break;
      case "gainers": base = trend.filter((ca) => (getTrend(ca)?.chg ?? 0) > 0).sort((a, b) => (getTrend(b)?.chg ?? 0) - (getTrend(a)?.chg ?? 0)); break;
      case "watch": base = [...getWatch()]; break;
    }
    if (pad !== "all") base = base.filter((ca) => (getToken(ca)?.pad ?? "").toLowerCase() === pad.toLowerCase());
    if (hide && tab !== "watch") base = base.filter((ca) => !clone(ca));
    return base.slice(0, 150);
  }, [snapshot, tab, pad, q]);

  useEffect(() => { void loadRisk(rows.slice(0, 40)); void loadLogos(rows.slice(0, 40)); }, [rows]);

  const onBuy = (ca: string) => { if (!HW.hasWallet()) return go("/wallet"); setBuyFor(ca); };
  const loading = !snapshot.o.hot.length && !snapshot.o.trend.length && !snapshot.n;

  return (
    <>
      <Header title="ArcTools" right={<>
        <span className="pill" style={{ color: live ? "var(--up)" : "var(--dim)" }}>● {live ? "live" : "…"}</span>
        <button className="icon-btn" onClick={() => { setSearching((s) => !s); setQ(""); }}><Icon.search className="" /></button>
      </>} />
      {searching && <div style={{ padding: "0 14px 8px" }}><div className="field"><Icon.search className="" /><input autoFocus placeholder="name, symbol or 0x address" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="none" autoCorrect="off" /><button className="pill" onClick={() => { setSearching(false); setQ(""); }}>✕</button></div></div>}
      {!q && <>
        <div className="seg">{TABS.map(([k, l]) => <button key={k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}{k === "watch" && snapshot.w ? ` ${snapshot.w}` : ""}</button>)}</div>
        <div className="seg" style={{ paddingTop: 0 }}>
          <button className={`chip ${pad === "all" ? "on" : ""}`} onClick={() => setPad("all")}>All pads</button>
          {pads.slice(0, 24).map((p) => <button key={p.pad} className={`chip ${pad === p.pad ? "on" : ""}`} onClick={() => setPad(pad === p.pad ? "all" : p.pad)}>{p.logo && <img alt="" src={p.logo} />}{p.label ?? p.pad}</button>)}
        </div>
      </>}
      <div ref={listRef}>
        {loading ? <Skeleton /> : rows.length === 0 ? <div className="empty">{tab === "watch" ? "Nothing on your watchlist yet. Tap ★ on a token." : q ? "No match. Paste a contract address to open any token." : "Nothing here right now."}</div>
          : rows.map((ca) => <TokenRow key={ca} ca={ca} onBuy={onBuy} />)}
      </div>
      <BuySheet ca={buyFor} onClose={() => setBuyFor(null)} />
    </>
  );
}

export { quickBuy };
