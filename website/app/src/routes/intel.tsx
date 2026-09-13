import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { QuickBuy } from "@/components/quick-buy";
import { Tags, useWalletLabels } from "@/components/risk";
import "../arc-site.css";

const API = "https://bot-production-4200.up.railway.app";
const BOT = "https://t.me/ArcToolsBuyBot";
const SNIPER = "https://t.me/ArcSniper_bot";

type Whale = { tx: string; ts: number; wallet: string; token: string; side: string; usdc: number; tokens: number; price1m: number | null; venue: string; symbol: string | null; rank: number | null };
type Mover = { token: string; n: number; vol: number; p0: number; p1: number; chg: number; symbol: string | null };
type Bridge = { in24: number; out24: number; n_in24: number; wallets_in24: number; net24: number; min_alert_usd: number; latest: { tx: string; ts: number; recipient: string; amount: number; source: string | null; direction: string }[] };
type Insider = { tx: string; ts: number; wallet: string; token: string; side: string; usdc: number; symbol: string | null; rank: number; pnl_total: number; winrate: number };
type Fresh = { wallet: string; ts: number; token: string; usdc: number; tx: string; symbol: string | null; swaps: number; bought: number };
type Cluster = { token: string; symbol: string | null; insiders: number; usd: number; best_rank: number; last_ts: number; ranks: string };
type Rich = { rows: { wallet: string; balance: number; prev: number; pnl_total: number | null; winrate: number | null; swaps: number; last_trade: number | null }[]; wallets: number; total_usdc: number; snapshot_ts: number };
type Move = { wallet: string; ts: number; balance: number; delta: number; pnl_total: number | null; swaps: number };

export const Route = createFileRoute("/intel")({
  head: () => ({
    meta: [
      { title: "Arc Intel: whales, movers, insiders, fresh wallets, bridge flows and custom alerts" },
      { content: "On-chain intelligence for Arc in one screen: whale swaps, whales by balance, top movers, insider clusters, fresh wallets, capital bridging in, wallet watchlists and custom alert rules delivered to Telegram.", name: "description" },
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
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

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
const th: React.CSSProperties = { color: "var(--arc-muted)", fontSize: 11, fontWeight: 400, padding: "0 10px 8px 0", textAlign: "left", textTransform: "uppercase" };
const td: React.CSSProperties = { borderTop: "1px solid var(--arc-line)", fontSize: 13, padding: "11px 12px 11px 0", whiteSpace: "nowrap" };
type Section = "money" | "smart" | "new" | "market" | "alerts";
const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "money", label: "Money", blurb: "Where the big USDC is and where it moves: largest swaps, richest wallets, deposits and withdrawals." },
  { id: "smart", label: "Smart money", blurb: "What the 100 most profitable wallets on Arc are doing right now, and where several of them agree." },
  { id: "new", label: "New arrivals", blurb: "Capital entering Arc: wallets making their first trade and USDC crossing the bridge." },
  { id: "market", label: "Market", blurb: "Tokens moving hardest in the window you pick." },
  { id: "alerts", label: "Alerts", blurb: "Turn any of the above into a Telegram alert with your own thresholds." },
];
const PANELS: Record<Section, string[]> = {
  money: ["whales", "rich", "moves"], smart: ["insiders", "clusters"], new: ["fresh", "bridge"], market: ["movers"], alerts: [],
};
const UP = "var(--arc-up)";
const DOWN = "var(--arc-down, #f0534f)";

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className="arc-mono" onClick={onClick} style={{ background: on ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (on ? "var(--arc-cobalt)" : "var(--arc-line)"), color: on ? "var(--arc-cobalt)" : "var(--arc-muted)", cursor: "pointer", fontSize: 10, marginLeft: 4, padding: "2px 7px" }} type="button">{children}</button>;
}

function Title({ children, right, caption }: { children: React.ReactNode; right?: React.ReactNode; caption?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
        <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{children}</p>
        <span className="arc-mono" style={{ fontSize: 11 }}>{right}</span>
      </div>
      {caption && <p style={{ color: "var(--arc-muted)", fontSize: 13, margin: "4px 0 0" }}>{caption}</p>}
    </div>
  );
}

function Intel() {
  const [section, setSection] = useState<Section>("money");
  const show = (k: string) => PANELS[section].includes(k);
  const [whaleMin, setWhaleMin] = useState(250);
  const [whaleWin, setWhaleWin] = useState(60);
  const [moverWin, setMoverWin] = useState(60);
  const [freshMin, setFreshMin] = useState(100);
  const [clusterWin, setClusterWin] = useState(120);
  const whales = useApi<{ rows: Whale[] }>(`/api/whales?minutes=${whaleWin}&min_usd=${whaleMin}&limit=60`, 10_000, [whaleWin, whaleMin]);
  const whaleLabels = useWalletLabels((whales?.rows ?? []).slice(0, 60).map((r) => r.wallet));
  const devSells = useApi<{ rows: { tx: string; ts: number; wallet: string; token: string; usdc: number; symbol: string | null }[] }>("/api/dev-sells-feed?hours=24&limit=30", 20_000, []);
  const movers = useApi<{ rows: Mover[] }>(`/api/movers?minutes=${moverWin}`, 30_000, [moverWin]);
  const bridge = useApi<Bridge>("/api/bridge", 30_000);
  const insiders = useApi<{ rows: Insider[] }>("/api/insider-activity?limit=40", 15_000);
  const fresh = useApi<{ rows: Fresh[] }>(`/api/fresh?hours=24&min_usd=${freshMin}`, 30_000, [freshMin]);
  const clusters = useApi<{ rows: Cluster[] }>(`/api/clusters?minutes=${clusterWin}&n=2`, 30_000, [clusterWin]);
  const rich = useApi<Rich>("/api/rich?limit=40", 60_000);
  const moves = useApi<{ rows: Move[] }>("/api/balance-moves?hours=24&min_usd=1000", 60_000);

  // universal lookup
  const [q, setQ] = useState("");
  const [look, setLook] = useState<{ kind: "wallet" | "token"; data: any } | null>(null);
  useEffect(() => {
    if (!isAddr(q)) { setLook(null); return; }
    const a = q.trim().toLowerCase();
    let alive = true;
    (async () => {
      // token if it has indexed trades or a symbol; else wallet
      const [ts, ins] = await Promise.all([
        fetch(`${API}/api/token-stats?token=${a}`).then((r) => r.json()).catch(() => null),
        fetch(`${API}/api/insider/${a}`).then((r) => r.json()).catch(() => null),
      ]);
      if (!alive) return;
      const isToken = ts && (ts.txns_all ?? 0) > 0 && !(ins && ins.trades && ins.trades.length > 0);
      if (isToken) {
        const [watchers] = await Promise.all([fetch(`${API}/api/watchers?wallet=${a}`).then((r) => r.json()).catch(() => null)]);
        setLook({ kind: "token", data: { ...ts, watchers } });
      } else {
        const bal = await fetch(`${API}/api/rich?limit=1`).then(() => null).catch(() => null);
        const watchers = await fetch(`${API}/api/watchers?wallet=${a}`).then((r) => r.json()).catch(() => null);
        setLook({ kind: "wallet", data: { ...(ins ?? {}), watchers: watchers?.watchers ?? 0, bal } });
      }
    })();
    return () => { alive = false; };
  }, [q]);

  // rule builder
  const [rType, setRType] = useState("price");
  const [rTok, setRTok] = useState("");
  const [rNum1, setRNum1] = useState("-30");
  const [rNum2, setRNum2] = useState("60");
  const ruleLink = useMemo(() => {
    const parts: string[] = [rType];
    if (rType === "price" || rType === "token") { if (!isAddr(rTok)) return null; parts.push(rTok.trim().toLowerCase()); }
    if (rType === "price") parts.push(String(Number(rNum1) || -30), String(Number(rNum2) || 60));
    else if (rType === "cluster") parts.push(String(Number(rNum1) || 3), String(Number(rNum2) || 30));
    else parts.push(String(Math.abs(Number(rNum1)) || 1000));
    return `${BOT}?start=rule_${parts.join("_")}`;
  }, [rType, rTok, rNum1, rNum2]);
  const ruleText = useMemo(() => {
    const n1 = Number(rNum1), n2 = Number(rNum2);
    switch (rType) {
      case "price": return `${isAddr(rTok) ? short(rTok) : "token"} ${n1 < 0 ? "drops" : "pumps"} ${Math.abs(n1) || 30}% within ${n2 || 60} min`;
      case "token": return `any swap ≥ $${Math.abs(n1) || 500} in ${isAddr(rTok) ? short(rTok) : "token"}`;
      case "whale": return `any swap ≥ $${Math.abs(n1) || 5000} on Arc`;
      case "bridge": return `CCTP inflow ≥ $${Math.abs(n1) || 20000}`;
      case "cluster": return `${n1 || 3}+ insiders buy one token within ${n2 || 30} min`;
      case "balance": return `a wallet balance jumps ≥ $${Math.abs(n1) || 25000}`;
      default: return `a brand-new wallet's first buy ≥ $${Math.abs(n1) || 1000}`;
    }
  }, [rType, rTok, rNum1, rNum2]);
  useEffect(() => {
    const d: Record<string, [string, string]> = { price: ["-30", "60"], token: ["500", ""], whale: ["5000", ""], bridge: ["20000", ""], cluster: ["3", "30"], balance: ["25000", ""], fresh: ["1000", ""] };
    setRNum1(d[rType][0]); setRNum2(d[rType][1]);
  }, [rType]);

  const whaleVol = useMemo(() => (whales?.rows ?? []).reduce((s, r) => s + r.usdc, 0), [whales]);
  const buys = useMemo(() => (whales?.rows ?? []).filter((r) => r.side === "buy").reduce((s, r) => s + r.usdc, 0), [whales]);

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/intel" />
      <section className="arc-section" style={{ maxWidth: 1280, paddingTop: 130 }}>
        <p className="arc-eyebrow">On-chain intelligence</p>
        <h1 className="arc-h2">Arc Intel</h1>
        <p className="arc-body">
          One screen over the whole chain: who is buying big, which wallets hold the money, what the top-100 are doing together,
          who just arrived, what is moving, what crosses the bridge — and alerts you define yourself, delivered to Telegram.
        </p>

        {/* CHECK ANYTHING */}
        <div style={{ ...card, border: "1px solid var(--arc-cobalt)", margin: "18px 0 16px", padding: "12px 16px" }}>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12 }}>
            <p style={{ fontSize: 16, fontWeight: 700, margin: 0, whiteSpace: "nowrap" }}>Check anything</p>
            <input className="arc-mono" onChange={(e) => setQ(e.target.value)} placeholder="paste a token contract or a wallet address — 0x…" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 420px", fontSize: 14, padding: "10px 14px" }} value={q} />
          </div>
          {isAddr(q) && !look && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "10px 0 0" }}>Looking up…</p>}
          {look?.kind === "token" && (
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 12 }}>
              {[["Price", price(look.data.price1m)], ["24h vol", usd(look.data.vol24 ?? 0)], ["Buys / sells 24h", `${look.data.buys24} / ${look.data.sells24}`], ["Traders 24h", String(look.data.traders24)], ["1h", look.data.change?.["1h"] != null ? `${look.data.change["1h"].toFixed(1)}%` : "—"], ["24h", look.data.change?.["24h"] != null ? `${look.data.change["24h"].toFixed(1)}%` : "—"]].map(([k, v]) => (
                <div key={k}><p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: 0 }}>{k.toUpperCase()}</p><p className="arc-mono" style={{ fontSize: 18, margin: "2px 0 0" }}>{v}</p></div>
              ))}
              <div style={{ alignSelf: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                <a className="arc-cta" href={`/token/${q.trim().toLowerCase()}`}>Chart & swap →</a>
                <a className="arc-mono" href={`/scan?ca=${q.trim().toLowerCase()}`} style={{ alignSelf: "center", color: "var(--arc-cobalt)", fontSize: 12 }}>rug check</a>
                <a className="arc-mono" href={`${SNIPER}?start=ca_${q.trim().slice(2).toLowerCase()}`} rel="noreferrer" style={{ alignSelf: "center", color: "var(--arc-cobalt)", fontSize: 12 }} target="_blank">snipe</a>
                <button className="arc-mono" onClick={() => { setRType("token"); setRTok(q.trim()); setSection("alerts"); setTimeout(() => document.getElementById("rule-builder")?.scrollIntoView({ behavior: "smooth" }), 50); }} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 12, padding: "4px 8px" }} type="button">alert on this token</button>
              </div>
            </div>
          )}
          {look?.kind === "wallet" && (() => {
            const s = (look.data.stats ?? []).find((x: any) => x.range === "30d");
            const t = look.data.trades ?? [];
            const bought = t.filter((x: any) => x.side === "buy").reduce((a: number, x: any) => a + x.usdc, 0);
            return (
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 12 }}>
                {[["30d PnL", s ? `${s.pnl_total >= 0 ? "+" : "−"}${usd(Math.abs(s.pnl_total))}` : "not ranked"], ["Win-rate", s ? `${Math.round(s.winrate)}%` : "—"], ["Closed", s ? String(s.closed) : "—"], ["Recent trades", String(t.length)], ["Last 25 buys", usd(bought)], ["Watched by", String(look.data.watchers ?? 0)]].map(([k, v]) => (
                  <div key={k}><p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: 0 }}>{k.toUpperCase()}</p><p className="arc-mono" style={{ fontSize: 18, margin: "2px 0 0" }}>{v}</p></div>
                ))}
                <div style={{ alignSelf: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <a className="arc-cta" href={`${BOT}?start=watch_${q.trim().slice(2).toLowerCase()}`} rel="noreferrer" target="_blank">Watch on Telegram →</a>
                  <a className="arc-mono" href={`${SNIPER}?start=copy_${q.trim().slice(2).toLowerCase()}`} rel="noreferrer" style={{ alignSelf: "center", color: "var(--arc-cobalt)", fontSize: 12 }} target="_blank">copy-trade</a>
                  <a className="arc-mono" href={`/portfolio?w=${q.trim().toLowerCase()}`} style={{ alignSelf: "center", color: "var(--arc-cobalt)", fontSize: 12 }}>portfolio</a>
                  <a className="arc-mono" href={`https://arc-scan.org/address/${q.trim().toLowerCase()}`} rel="noreferrer" style={{ alignSelf: "center", color: "var(--arc-cobalt)", fontSize: 12 }} target="_blank">explorer ↗</a>
                </div>
                {t.length > 0 && <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, gridColumn: "1 / -1" }}>last: {t.slice(0, 5).map((x: any) => `${x.side} ${usd(x.usdc)} ${ago(x.ts)} ago`).join(" · ")}</div>}
              </div>
            );
          })()}
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", margin: "0 0 20px" }}>
          {[
            [`Whale vol ${whaleWin < 60 ? whaleWin + "m" : whaleWin / 60 + "h"}`, usd(whaleVol)],
            ["Whale buy share", whaleVol > 0 ? `${Math.round((buys / whaleVol) * 100)}%` : "—"],
            ["Bridge in 24h", bridge ? usd(bridge.in24) : "—"],
            ["Bridge net 24h", bridge ? `${bridge.net24 >= 0 ? "+" : "−"}${usd(Math.abs(bridge.net24))}` : "—"],
            ["Fresh wallets 24h", fresh ? String(fresh.rows.length) + (fresh.rows.length >= 60 ? "+" : "") : "—"],
            ["Tracked wallets", rich ? rich.wallets.toLocaleString() : "—"],
            ["USDC in tracked wallets", rich ? usd(rich.total_usdc) : "—"],
          ].map(([k, v]) => (
            <div key={k} style={card}>
              <p style={{ color: "var(--arc-muted)", fontSize: 13, margin: 0 }}>{k}</p>
              <p className="arc-mono" style={{ fontSize: 24, margin: "8px 0 0" }}>{v}</p>
            </div>
          ))}
        </div>

        {/* SECTION BAR */}
        <div style={{ borderBottom: "1px solid var(--arc-line)", display: "flex", flexWrap: "wrap", gap: 4, margin: "8px 0 0" }}>
          {SECTIONS.map((sec) => (
            <button key={sec.id} onClick={() => setSection(sec.id)} style={{ background: "transparent", border: "none", borderBottom: "2px solid " + (section === sec.id ? "var(--arc-cobalt)" : "transparent"), color: section === sec.id ? "var(--arc-ink)" : "var(--arc-muted)", cursor: "pointer", fontSize: 16, fontWeight: section === sec.id ? 700 : 400, padding: "12px 18px" }} type="button">
              {sec.label}
            </button>
          ))}
        </div>
        <p style={{ color: "var(--arc-muted)", fontSize: 14, margin: "12px 0 18px" }}>{SECTIONS.find((x) => x.id === section)?.blurb}</p>

        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1fr" }}>
          {/* WHALE FEED */}
          {show("whales") && <div style={card}>
            <Title right={<>{[100, 250, 1000, 5000].map((m) => <Pill key={m} on={whaleMin === m} onClick={() => setWhaleMin(m)}>≥${m}</Pill>)}{[15, 60, 360, 1440].map((m) => <Pill key={m} on={whaleWin === m} onClick={() => setWhaleWin(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</Pill>)}</>} caption="Every swap above the threshold, newest first. A rank badge means the wallet is in the top-100 by 30-day PnL. Click a wallet to inspect it.">WHALE FEED · biggest swaps, live</Title>
            <div className="arc-scroll" style={{ maxHeight: 560, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>side</th><th style={th}>USDC</th><th style={th}>token</th><th style={th}>wallet</th><th style={th}>venue</th><th style={th} /></tr></thead>
                <tbody>
                  {(whales?.rows ?? []).sort((a, b) => b.ts - a.ts).map((r) => (
                    <tr key={r.tx + r.ts}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td className="arc-mono" style={{ ...td, color: r.side === "buy" ? UP : DOWN }}>{r.side.toUpperCase()}</td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(r.usdc)}</td>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a> <QuickBuy compact symbol={r.symbol ?? short(r.token)} token={r.token} /></td>
                      <td className="arc-mono" style={td}>
                        <a className="arc-mono" href={`https://arc-scan.org/address/${r.wallet}`} rel="noreferrer" style={{ color: "var(--arc-ink)", textDecoration: "none", fontSize: 12, padding: 0 }} target="_blank" title="Open in Arc Scan">{short(r.wallet)}</a> <button className="arc-mono" onClick={() => setQ(r.wallet)} style={{ background: "none", border: "none", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: 0 }} title="Inspect in Intel" type="button">🔍</button>
                        <Tags labels={whaleLabels} max={2} wallet={r.wallet} />
                        {r.rank && !whaleLabels[r.wallet.toLowerCase()]?.some((l) => l.kind === "insider") && <span style={{ background: "rgba(46,124,255,0.15)", border: "1px solid var(--arc-cobalt)", borderRadius: 3, color: "var(--arc-cobalt)", fontSize: 9, marginLeft: 6, padding: "0 4px" }}>#{r.rank}</span>}
                      </td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.venue}</td>
                      <td style={td}><a className="arc-mono" href={`/wallets?add=${r.wallet}`} style={{ border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, padding: "3px 8px" }} >watch</a></td>
                    </tr>
                  ))}
                  {whales && whales.rows.length === 0 && <tr><td colSpan={7} className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>Quiet: no swaps ≥ ${whaleMin} in this window.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>}

          {/* DEV SELLS — deployers selling their own token (last 24h, chain-wide) */}
          <div style={{ border: "1px solid #f0534f", marginTop: 18, padding: 14 }}>
            <Title caption="Deployers selling the tokens they launched, chain-wide, last 24 h. The same signal the sniper's dump guard fires on.">🚨 DEV SELLS</Title>
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>token</th><th style={th}>sold</th><th style={th}>deployer</th><th style={th} /></tr></thead>
                <tbody>
                  {(devSells?.rows ?? []).map((r) => (
                    <tr key={r.tx + r.ts}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a></td>
                      <td className="arc-mono" style={{ ...td, color: DOWN, fontWeight: 700 }}>{usd(r.usdc)}</td>
                      <td className="arc-mono" style={td}><a className="arc-mono" href={`https://arc-scan.org/address/${r.wallet}`} rel="noreferrer" style={{ color: "var(--arc-ink)", fontSize: 12, textDecoration: "none" }} target="_blank">{short(r.wallet)}</a></td>
                      <td style={td}><a className="arc-mono" href={`/wallets?add=${r.wallet}`} style={{ border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", fontSize: 11, padding: "2px 7px", textDecoration: "none" }}>watch</a></td>
                    </tr>
                  ))}
                  {devSells && devSells.rows.length === 0 && <tr><td colSpan={5} className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>No deployer sold their own token in the last 24 h.</td></tr>}
                  {!devSells && <tr><td colSpan={5} className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>…</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {/* WHALES BY BALANCE */}
          {show("rich") && <div style={card}>
            <Title right={rich?.snapshot_ts ? <span style={{ color: "var(--arc-muted)" }}>snapshot {ago(rich.snapshot_ts)} ago</span> : null} caption="Who holds the most USDC among wallets that ever traded on Arc. Δ snap = change since the last 10-minute snapshot.">WHALES BY BALANCE · native USDC held by wallets the index knows</Title>
            <div className="arc-scroll" style={{ maxHeight: 560, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>#</th><th style={th}>wallet</th><th style={th}>USDC</th><th style={th}>Δ snap</th><th style={th}>30d PnL</th><th style={th}>swaps</th><th style={th}>last</th><th style={th} /></tr></thead>
                <tbody>
                  {(rich?.rows ?? []).map((r, i) => (
                    <tr key={r.wallet}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{i + 1}</td>
                      <td className="arc-mono" style={td}><a className="arc-mono" href={`https://arc-scan.org/address/${r.wallet}`} rel="noreferrer" style={{ color: "var(--arc-ink)", fontSize: 12, textDecoration: "none" }} target="_blank" title="Open in Arc Scan">{short(r.wallet)}</a> <button className="arc-mono" onClick={() => setQ(r.wallet)} style={{ background: "none", border: "none", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: 0 }} title="Inspect in Intel" type="button">🔍</button></td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(r.balance)}</td>
                      <td className="arc-mono" style={{ ...td, color: r.balance - (r.prev ?? r.balance) >= 0 ? UP : DOWN }}>{r.prev != null && Math.abs(r.balance - r.prev) >= 1 ? `${r.balance - r.prev >= 0 ? "+" : "−"}${usd(Math.abs(r.balance - r.prev))}` : ""}</td>
                      <td className="arc-mono" style={{ ...td, color: (r.pnl_total ?? 0) >= 0 ? UP : DOWN }}>{r.pnl_total != null ? `${r.pnl_total >= 0 ? "+" : "−"}${usd(Math.abs(r.pnl_total))}` : "—"}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.swaps}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.last_trade ? ago(r.last_trade) : "—"}</td>
                      <td style={td}><a className="arc-mono" href={`/wallets?add=${r.wallet}`} style={{ border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, padding: "3px 8px" }} >watch</a></td>
                    </tr>
                  ))}
                  {rich && rich.rows.length === 0 && <tr><td colSpan={8} className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>First balance snapshot is running — back in a few minutes.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>}

          {/* INSIDER CLUSTERS */}
          {show("clusters") && <div style={card}>
            <Title right={<>{[30, 120, 360, 1440].map((m) => <Pill key={m} on={clusterWin === m} onClick={() => setClusterWin(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</Pill>)}</>} caption="When two or more ranked wallets buy the same token in the same window, it is the strongest signal this index produces.">INSIDER CLUSTERS · tokens several top-100 wallets bought together</Title>
            <div className="arc-scroll" style={{ maxHeight: 460, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>token</th><th style={th}>insiders</th><th style={th}>ranks</th><th style={th}>bought</th><th style={th}>last</th><th style={th} /></tr></thead>
                <tbody>
                  {(clusters?.rows ?? []).map((r) => (
                    <tr key={r.token}>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a></td>
                      <td className="arc-mono" style={{ ...td, color: UP, fontWeight: 700 }}>{r.insiders}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>#{r.ranks.split(",").slice(0, 5).join(" #")}</td>
                      <td className="arc-mono" style={td}>{usd(r.usd)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.last_ts)}</td>
                      <td style={td}><QuickBuy compact symbol={r.symbol ?? short(r.token)} token={r.token} /> <a className="arc-mono" href={`${SNIPER}?start=ca_${r.token.slice(2)}`} rel="noreferrer" style={{ border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, marginLeft: 4, padding: "3px 8px" }} target="_blank">snipe</a></td>
                    </tr>
                  ))}
                  {clusters && clusters.rows.length === 0 && <tr><td colSpan={6} className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>No token with 2+ insiders in this window.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>}

          {/* FRESH WALLETS */}
          {show("fresh") && <div style={card}>
            <Title right={<>{[50, 100, 500, 2000].map((m) => <Pill key={m} on={freshMin === m} onClick={() => setFreshMin(m)}>≥${m}</Pill>)}</>} caption="Wallets that had never traded on Arc before, sorted by the size of their first buy. Big first buys from new wallets are usually not retail.">FRESH WALLETS · first ever swap on Arc in the last 24h</Title>
            <div className="arc-scroll" style={{ maxHeight: 460, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>wallet</th><th style={th}>first buy</th><th style={th}>token</th><th style={th}>since</th><th style={th} /></tr></thead>
                <tbody>
                  {(fresh?.rows ?? []).map((r) => (
                    <tr key={r.wallet}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td className="arc-mono" style={td}><a className="arc-mono" href={`https://arc-scan.org/address/${r.wallet}`} rel="noreferrer" style={{ color: "var(--arc-ink)", fontSize: 12, textDecoration: "none" }} target="_blank" title="Open in Arc Scan">{short(r.wallet)}</a> <button className="arc-mono" onClick={() => setQ(r.wallet)} style={{ background: "none", border: "none", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: 0 }} title="Inspect in Intel" type="button">🔍</button></td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(r.usdc)}</td>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a></td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.swaps} swaps · {usd(r.bought ?? 0)}</td>
                      <td style={td}><a className="arc-mono" href={`/wallets?add=${r.wallet}`} style={{ border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, padding: "3px 8px" }} >watch</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}

          {/* MOVERS */}
          {show("movers") && <div style={card}>
            <Title right={<>{[15, 60, 360, 1440].map((m) => <Pill key={m} on={moverWin === m} onClick={() => setMoverWin(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</Pill>)}</>} caption="Price change from the first to the last trade in the window. Needs at least 3 trades and $50 of volume to appear.">TOP MOVERS</Title>
            <div className="arc-scroll" style={{ maxHeight: 460, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>token</th><th style={th}>change</th><th style={th}>price</th><th style={th}>vol</th><th style={th}>trades</th></tr></thead>
                <tbody>
                  {(movers?.rows ?? []).map((r) => (
                    <tr key={r.token}>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a> <QuickBuy compact symbol={r.symbol ?? short(r.token)} token={r.token} /></td>
                      <td className="arc-mono" style={{ ...td, color: r.chg >= 0 ? UP : DOWN, fontWeight: 700 }}>{r.chg >= 0 ? "+" : ""}{r.chg.toFixed(1)}%</td>
                      <td className="arc-mono" style={td}>{price(r.p1)}</td>
                      <td className="arc-mono" style={td}>{usd(r.vol)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}

          {/* INSIDER ACTIVITY */}
          {show("insiders") && <div style={card}>
            <Title right={<><a href="/insiders" style={{ color: "var(--arc-cobalt)" }}>leaderboard</a> · <a href="https://t.me/ArcToolsInsiders" rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">channel</a></>} caption="Latest trades of the leaderboard wallets. Copy sends the wallet to the sniper as a copy-trade target.">INSIDER ACTIVITY · top-100 by 30d PnL</Title>
            <div className="arc-scroll" style={{ maxHeight: 460, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>#</th><th style={th}>side</th><th style={th}>USDC</th><th style={th}>token</th><th style={th}>30d PnL</th><th style={th} /></tr></thead>
                <tbody>
                  {(insiders?.rows ?? []).map((r) => (
                    <tr key={r.tx}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-cobalt)" }}>#{r.rank}</td>
                      <td className="arc-mono" style={{ ...td, color: r.side === "buy" ? UP : DOWN }}>{r.side.toUpperCase()}</td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(r.usdc)}</td>
                      <td style={td}><a href={`/token/${r.token}`} style={{ color: "var(--arc-ink)" }}>${r.symbol ?? short(r.token)}</a></td>
                      <td className="arc-mono" style={{ ...td, color: r.pnl_total >= 0 ? UP : DOWN }}>{r.pnl_total >= 0 ? "+" : "−"}{usd(Math.abs(r.pnl_total))}</td>
                      <td style={td}><a className="arc-mono" href={`${SNIPER}?start=copy_${r.wallet.slice(2)}`} rel="noreferrer" style={{ border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, padding: "3px 8px" }} target="_blank">copy</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}

          {/* BALANCE MOVES */}
          {show("moves") && <div style={card}>
            <Title caption="USDC that entered or left a wallet between snapshots without a swap: exchanges, bridges, OTC. Positive = money arrived and has not been used yet.">BALANCE MOVES 24h · deposits & withdrawals that never touched a DEX</Title>
            <div className="arc-scroll" style={{ maxHeight: 460, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>wallet</th><th style={th}>Δ USDC</th><th style={th}>now</th><th style={th}>swaps</th><th style={th} /></tr></thead>
                <tbody>
                  {(moves?.rows ?? []).map((r) => (
                    <tr key={r.wallet + r.ts}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td className="arc-mono" style={td}><a className="arc-mono" href={`https://arc-scan.org/address/${r.wallet}`} rel="noreferrer" style={{ color: "var(--arc-ink)", fontSize: 12, textDecoration: "none" }} target="_blank" title="Open in Arc Scan">{short(r.wallet)}</a> <button className="arc-mono" onClick={() => setQ(r.wallet)} style={{ background: "none", border: "none", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, padding: 0 }} title="Inspect in Intel" type="button">🔍</button></td>
                      <td className="arc-mono" style={{ ...td, color: r.delta >= 0 ? UP : DOWN, fontWeight: 700 }}>{r.delta >= 0 ? "+" : "−"}{usd(Math.abs(r.delta))}</td>
                      <td className="arc-mono" style={td}>{usd(r.balance)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.swaps}</td>
                      <td style={td}><a className="arc-mono" href={`/wallets?add=${r.wallet}`} style={{ border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, padding: "3px 8px" }} >watch</a></td>
                    </tr>
                  ))}
                  {moves && moves.rows.length === 0 && <tr><td colSpan={6} className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>No balance move ≥ $1,000 between snapshots yet (snapshots every 10 min).</td></tr>}
                </tbody>
              </table>
            </div>
          </div>}

          {/* BRIDGE */}
          {show("bridge") && <div style={card}>
            <Title caption="Money crossing into Arc through Circle CCTP, with the chain it came from. Alerts for large inflows go to @ArcToolsInsiders.">BRIDGE WATCH · Circle CCTP into Arc</Title>
            {bridge && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "0 0 8px" }}>24h: <span style={{ color: "var(--arc-ink)" }}>{usd(bridge.in24)}</span> in · {usd(bridge.out24)} out · {bridge.n_in24} inflows from {bridge.wallets_in24} wallets</p>}
            <div className="arc-scroll" style={{ maxHeight: 460, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>age</th><th style={th}>dir</th><th style={th}>USDC</th><th style={th}>from</th><th style={th}>wallet</th><th style={th} /></tr></thead>
                <tbody>
                  {(bridge?.latest ?? []).map((r) => (
                    <tr key={r.tx + r.ts}>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{ago(r.ts)}</td>
                      <td className="arc-mono" style={{ ...td, color: r.direction === "in" ? UP : "var(--arc-muted)" }}>{r.direction.toUpperCase()}</td>
                      <td className="arc-mono" style={{ ...td, fontWeight: 700 }}>{usd(r.amount)}</td>
                      <td className="arc-mono" style={{ ...td, color: "var(--arc-muted)" }}>{r.source ?? "—"}</td>
                      <td className="arc-mono" style={td}><button className="arc-mono" onClick={() => setQ(r.recipient)} style={{ background: "none", border: "none", color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: 0 }} type="button">{short(r.recipient)}</button></td>
                      <td style={td}><a className="arc-mono" href={`${BOT}?start=watch_${r.recipient.slice(2)}`} rel="noreferrer" style={{ border: "1px solid var(--arc-cobalt)", borderRadius: 4, color: "var(--arc-cobalt)", fontSize: 11, padding: "3px 8px" }} >watch</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}
        </div>

        {/* ALERT BUILDER */}
        {section === "alerts" && <div id="rule-builder" style={{ ...card, border: "1px solid var(--arc-cobalt)", marginTop: 0 }}>
          <Title caption="Pick a condition, set the threshold, arm it. The bot checks it every 10 seconds and DMs you when it fires. You can also type /alert in the bot.">Build an alert</Title>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {[["Whale swap ≥ $5k", "whale", "5000", ""], ["Bridge inflow ≥ $20k", "bridge", "20000", ""], ["3 insiders, 30 min", "cluster", "3", "30"], ["Fresh wallet buys ≥ $1k", "fresh", "1000", ""], ["Balance jump ≥ $25k", "balance", "25000", ""]].map(([lab, t, a, b]) => (
              <button key={t} onClick={() => { setRType(t); setTimeout(() => { setRNum1(a); setRNum2(b); }, 0); }} style={{ background: rType === t ? "rgba(46,124,255,0.18)" : "transparent", border: "1px solid " + (rType === t ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 999, color: rType === t ? "var(--arc-cobalt)" : "var(--arc-ink)", cursor: "pointer", fontSize: 13, padding: "6px 14px" }} type="button">{lab}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <select className="arc-mono" onChange={(e) => setRType(e.target.value)} style={{ background: "var(--arc-paper)", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 13, padding: "9px 12px" }} value={rType}>
              <option value="price">Token price moves</option>
              <option value="token">Big swap in a token</option>
              <option value="whale">Whale swap anywhere</option>
              <option value="bridge">Bridge inflow</option>
              <option value="cluster">Insider cluster</option>
              <option value="balance">Wallet balance jump</option>
              <option value="fresh">Fresh wallet first buy</option>
            </select>
            {(rType === "price" || rType === "token") && <input className="arc-mono" onChange={(e) => setRTok(e.target.value)} placeholder="0x… token" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 300px", fontSize: 13, padding: "9px 12px" }} value={rTok} />}
            <input className="arc-mono" onChange={(e) => setRNum1(e.target.value)} placeholder={rType === "price" ? "% (negative = drop)" : rType === "cluster" ? "insiders" : "min USD"} style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 13, padding: "9px 12px", width: 150 }} value={rNum1} />
            {(rType === "price" || rType === "cluster") && <input className="arc-mono" onChange={(e) => setRNum2(e.target.value)} placeholder="minutes" style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 13, padding: "9px 12px", width: 110 }} value={rNum2} />}
            <a className="arc-cta" href={ruleLink ?? undefined} rel="noreferrer" style={{ opacity: ruleLink ? 1 : 0.4, pointerEvents: ruleLink ? "auto" : "none" }} target="_blank">Arm on Telegram →</a>
          </div>
          <p style={{ fontSize: 15, margin: "14px 0 0" }}>
            Rule: <strong>{ruleText}</strong>
          </p>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "6px 0 0" }}>free tier: 5 rules + 3 watched wallets per Telegram account</p>
        </div>}

        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 18 }}>
          Sources: ArcTools chain-wide swap index (Uniswap V3, V4, every launchpad), native USDC balance snapshots every 10 min for every wallet the index has seen, CCTP TokenMessenger events, insider ranking recomputed every 2 minutes. Not financial advice.
        </p>
      </section>
    </main>
  );
}
