import { loadMeta } from "../lib/token-meta";
import { UpdateBanner } from "../components/UpdateBanner";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tap } from "../lib/native";
import { api, streamUrl, type Trend } from "../lib/api";
import { isAddr } from "../lib/fmt";
import { go } from "../lib/router";
import { allTokens, applyTrendFrame, hasFullList, getPrefs, getToken, getTrend, getHot, getWatch, loadList, loadLogos, loadRisk, loadTrending, orders, setPrefs, toast, useStore } from "../lib/store";
import * as HW from "../lib/arc-hotwallet";
import { quickBuy } from "../lib/trade";
import { BRAND, Header, Icon, Skeleton, TokenRow } from "../components/ui";
import { BuySheet } from "../components/BuySheet";

type Tab = "trending" | "all" | "new" | "new15" | "top" | "gainers" | "alpha" | "insiders" | "holdings" | "watch";
const TABS: [Tab, string][] = [["trending", "Trending"], ["new", "New pairs"], ["new15", "New 15m"], ["all", "All"], ["top", "Top volume"], ["gainers", "Gainers"], ["alpha", "Alpha"], ["insiders", "Insider picks"], ["holdings", "Holdings"], ["watch", "★"]];

export default function Trending() {
  const [tab, setTab] = useState<Tab>("trending");
  const [pad, setPad] = useState<string>(() => new URLSearchParams((location.hash.split("?")[1]) || "").get("pad") ?? "all");
  const [pads, setPads] = useState<{ pad: string; n: number; label?: string; logo?: string | null }[]>([]);
  const [q, setQ] = useState(""); const [searching, setSearching] = useState(false);
  const [buyFor, setBuyFor] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const snapshot = useStore(useCallback(() => ({ o: orders(), n: allTokens().length, w: getWatch().size }), []));
  const prefs = useStore(getPrefs);
  const listRef = useRef<HTMLDivElement>(null);
  const [alphaList, setAlpha] = useState<string[]>([]); const [insiderList, setInsiders] = useState<string[]>([]); const [holdingList, setHoldings] = useState<string[]>([]);
  useEffect(() => { if ((tab === "all" || tab === "new" || pad !== "all") && !hasFullList()) void loadList(true, true); }, [tab, pad]);
  useEffect(() => {
    if (tab === "alpha" && !alphaList.length) api.alpha().then((rows) => setAlpha(rows.map((r) => String(r.token).toLowerCase()))).catch(() => undefined);
    if (tab === "insiders" && !insiderList.length) api.insiderPicks().then(setInsiders).catch(() => undefined);
    if (tab === "holdings") { const a = HW.hotAddress(); if (a) api.holdings(a).then((r) => setHoldings((r.holdings ?? []).filter((h) => h.amount > 0).sort((x, y) => (y.valueUsdc ?? 0) - (x.valueUsdc ?? 0)).map((h) => h.token.toLowerCase()))).catch(() => undefined); }
  }, [tab, alphaList.length, insiderList.length]);

  useEffect(() => { void loadTrending(); void loadList(); api.padcounts().then((r) => setPads([...r].sort((x, y) => (x.pad === "ArcToolsPad" ? -1 : y.pad === "ArcToolsPad" ? 1 : 0)))).catch(() => undefined); }, []);
  // push feed: trending frames arrive as the bot refreshes them; the poller is only the safety net
  useEffect(() => {
    let es: EventSource | null = null; let closed = false; let backoff = 2000; let lastBeat = Date.now(); let lastFrame = 0;
    const open = () => {
      if (closed) return;
      es = new EventSource(streamUrl());
      // `chain` heartbeats prove the socket is open, not that data flows: a connection that only ever carried
      // heartbeats made the poller back off to 60 s and market caps sat still. Only a trending frame counts as live.
      const beat = () => { lastBeat = Date.now(); };
      const frame = () => { lastBeat = Date.now(); lastFrame = Date.now(); setLive(true); };
      es.addEventListener("hello", beat); es.addEventListener("chain", beat);
      es.addEventListener("trending", (ev) => { frame(); try { const q = (ev as MessageEvent).lastEventId || ""; const j = JSON.parse((ev as MessageEvent).data) as { rows?: Trend[] }; if (j.rows?.length) applyTrendFrame(q, j.rows); } catch { /* bad frame */ } });
      es.onerror = () => { setLive(false); es?.close(); es = null; if (!closed) setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15_000); };
    };
    open();
    const pulse = setInterval(() => { if (Date.now() - lastBeat > 40_000) { setLive(false); es?.close(); es = null; if (!closed) open(); } else if (live && Date.now() - lastFrame > 45_000) setLive(false); }, 5000);
    const poll = setInterval(() => { if (!document.hidden) void loadTrending(!live); }, live ? 60_000 : 15_000);
    const list = setInterval(() => { if (!document.hidden) void loadList(); }, 60_000);
    return () => { closed = true; es?.close(); clearInterval(pulse); clearInterval(poll); clearInterval(list); };
  }, [live]);

  const rows = useMemo(() => {
    const { hot, trend, all } = snapshot.o; const hide = getPrefs().hideClones;
    const clone = (ca: string) => !!(getHot(ca)?.clone || getTrend(ca)?.clone);
    let base: string[];
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      if (isAddr(s)) return [s];
      // search the trending rows too (they are here before the 3 MB list finishes on a slow phone), rank exact
      // symbol first, then symbol prefix, then name — ARGUS above Margarita for "arg"
      const cands = new Set<string>([...hot, ...trend, ...all]);
      const score = (ca: string) => {
        const t = getToken(ca); const tr = getHot(ca) ?? getTrend(ca);
        const sym = (t?.symbol || tr?.symbol || "").toLowerCase(); const name = (t?.name || "").toLowerCase();
        if (sym === s) return 0; if (sym.startsWith(s)) return 1; if (name.startsWith(s)) return 2; if (sym.includes(s)) return 3; if (name.includes(s)) return 4; return 9;
      };
      return [...cands].map((ca) => [ca, score(ca)] as const).filter(([, sc]) => sc < 9)
        .sort((a, b) => a[1] - b[1] || ((getHot(b[0]) ?? getTrend(b[0]))?.vol ?? 0) - ((getHot(a[0]) ?? getTrend(a[0]))?.vol ?? 0)).slice(0, 60).map(([ca]) => ca);
    }
    const byAge = (a: string, b: string) => Date.parse(getToken(b)?.createdAt ?? "0") - Date.parse(getToken(a)?.createdAt ?? "0");
    const now = Date.now();
    switch (tab) {
      case "trending": base = hot.length ? hot : trend; break;
      case "all": base = [...all].sort((a, b) => (getTrend(b)?.vol ?? getToken(b)?.volUsd ?? 0) - (getTrend(a)?.vol ?? getToken(a)?.volUsd ?? 0)); break;
      case "new": base = [...all].sort(byAge); break;
      case "new15": base = all.filter((ca) => { const c = getToken(ca)?.createdAt; return c && now - Date.parse(c) < 15 * 60_000; }).sort(byAge); break;
      case "top": base = [...trend].sort((a, b) => (getTrend(b)?.vol ?? 0) - (getTrend(a)?.vol ?? 0)); break;
      case "gainers": base = trend.filter((ca) => (getTrend(ca)?.chg ?? 0) > 0).sort((a, b) => (getTrend(b)?.chg ?? 0) - (getTrend(a)?.chg ?? 0)); break;
      case "alpha": base = alphaList; break;
      case "insiders": base = insiderList; break;
      case "holdings": base = holdingList; break;
      case "watch": base = [...getWatch()]; break;
    }
    // a launchpad chip is a view of the WHOLE list for that pad (newest first), like the site's "All · <pad>" —
    // filtering the current tab's 22 insider rows by pad gave 0 rows and a misleading "Loading…"
    if (pad !== "all") {
      const pl = pad.toLowerCase();
      base = [...all].filter((ca) => (getToken(ca)?.pad ?? "").toLowerCase() === pl).sort(byAge);
    }
    if (hide && tab !== "watch" && tab !== "holdings") base = base.filter((ca) => !clone(ca));
    return base.slice(0, tab === "all" || tab === "new" ? 400 : 150);
  }, [snapshot, tab, pad, q, alphaList, insiderList, holdingList]);

  const [, bump] = useState(0);
  // risk, logos and mint dates for the visible rows; meta resolves the real age (ArcOne showed first-sighting age)
  useEffect(() => { void loadRisk(rows.slice(0, 40)); void loadLogos(rows.slice(0, 40)); loadMeta(rows.slice(0, 60)).then(() => bump((n) => n + 1)).catch(() => undefined); }, [rows]);

  const onBuy = (ca: string) => { if (!HW.hasWallet()) return go("/wallet"); setBuyFor(ca); };
  // one tap = buy the default amount right now. No confirmation: that is what the ⚡ is for. Locked wallet → sheet.
  const onQuick = (ca: string) => {
    if (!HW.hasWallet()) return go("/wallet");
    if (!HW.isUnlocked()) return setBuyFor(ca);
    tap(); const t = getToken(ca); const tr = getHot(ca) ?? getTrend(ca);
    void quickBuy(ca, t?.symbol || tr?.symbol || "token", getPrefs().quickBuy).catch(() => undefined);
  };
  // pull-to-refresh: a touch that starts at scrollTop 0 and drags down 80 px reloads both lists
  const pull = useRef<{ y0: number; armed: boolean }>({ y0: 0, armed: false });
  const [pulling, setPulling] = useState(false);
  const onTS = (e: React.TouchEvent) => { if (window.scrollY <= 0) pull.current = { y0: e.touches[0].clientY, armed: true }; };
  const onTM = (e: React.TouchEvent) => { if (pull.current.armed && e.touches[0].clientY - pull.current.y0 > 80 && !pulling) { setPulling(true); Promise.all([loadTrending(true), loadList(true)]).finally(() => { setPulling(false); pull.current.armed = false; }); } };
  const loading = !snapshot.o.hot.length && !snapshot.o.trend.length && !snapshot.n;

  return (
    <>
      <Header title={BRAND} right={<>
      <UpdateBanner />
        <div className="amts" title="quick-buy amount">{prefs.presets.map((p) => <button key={p} className={prefs.quickBuy === p ? "on" : ""} onClick={() => setPrefs({ quickBuy: p })}>{p}</button>)}</div>
        <span className="pill" style={{ color: live ? "var(--up)" : "var(--dim)" }}>●</span>
        <button className="icon-btn" onClick={() => { setSearching((s) => !s); setQ(""); }}><Icon.search className="" /></button>
      </>} />
      {searching && <div style={{ padding: "0 14px 8px" }}><div className="field"><Icon.search className="" /><input type="search" placeholder="name, symbol or 0x address" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="none" autoCorrect="off" enterKeyHint="search" ref={(el) => { if (el && searching && !q) setTimeout(() => el.focus(), 50); }} /><button className="pill" onClick={() => { setSearching(false); setQ(""); }}>✕</button></div></div>}
      {!q && <>
        <div className="seg">{TABS.map(([k, l]) => <button key={k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => { setTab(k); if (pad !== "all") setPad("all"); }}>{l}{k === "watch" && snapshot.w ? ` ${snapshot.w}` : ""}</button>)}</div>
        <div className="padrow">
          <small className="padrow__lbl">Launchpads</small>
          <div className="seg" style={{ padding: "0 14px 8px" }}>
          <button className={`chip ${pad === "all" ? "on" : ""}`} onClick={() => setPad("all")}>All</button>
          {pads.length === 0 && <button className="chip" onClick={() => api.padcounts().then(setPads).catch(() => toast("Launchpads did not load — tap to retry", "err"))}>Load launchpads…</button>}
          {pads.slice(0, 24).map((p) => <button key={p.pad} className={`chip ${pad === p.pad ? "on" : ""}`} onClick={() => setPad(pad === p.pad ? "all" : p.pad)}>{p.logo && <img alt="" src={p.logo} />}{p.label ?? p.pad}<span className="chip__n">{p.n >= 1000 ? `${(p.n / 1000).toFixed(1)}k` : p.n}</span></button>)}
          </div>
        </div>
      </>}
      <div ref={listRef} onTouchStart={onTS} onTouchMove={onTM}>
        {pulling && <div className="empty" style={{ padding: 10 }}>refreshing…</div>}
        {loading ? <Skeleton /> : rows.length === 0 ? <div className="empty">{tab === "watch" ? "Nothing on your watchlist yet. Tap ★ on a token." : tab === "holdings" ? (HW.hasWallet() ? "You hold no tokens yet." : "Create a wallet to see your holdings here.") : pad !== "all" ? <>No {pad} tokens in the list yet.<br /><button className="chip" style={{ marginTop: 10 }} onClick={() => setPad("all")}>Show all launchpads</button></> : tab === "new15" ? "No launch in the last 15 minutes." : q ? "No match. Paste a contract address to open any token." : snapshot.n === 0 ? "Loading…" : "Nothing here right now."}</div>
          : rows.map((ca) => <TokenRow key={ca} ca={ca} onBuy={onBuy} onQuick={onQuick} />)}
      </div>
      <BuySheet ca={buyFor} onClose={() => setBuyFor(null)} />
    </>
  );
}

export { quickBuy };
