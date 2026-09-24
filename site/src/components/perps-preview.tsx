/** ArcPerps — UI PREVIEW. No contracts yet: live prices from the token list, everything else illustrates the design
 *  (price source schedule, leverage caps by liquidity, P2P + fee-funded insurance fund, OI caps, funding). */
import { useEffect, useMemo, useState } from "react";

type Mkt = { sym: string; token: string; kind: "stock" | "arc"; lp: number; pad: string };
const MARKETS: Mkt[] = [
  { sym: "NVDA", token: "0x65055065", kind: "stock", lp: 0, pad: "long.supply" }, { sym: "TSLA", token: "0x4d1efa7f", kind: "stock", lp: 0, pad: "long.supply" },
  { sym: "CRCL", token: "0x2ba0f44b", kind: "stock", lp: 0, pad: "long.supply" }, { sym: "GME", token: "0x41b386e0", kind: "stock", lp: 0, pad: "long.supply" }, { sym: "HIMS", token: "0x3b26421e", kind: "stock", lp: 0, pad: "long.supply" },
  { sym: "ARGUS", token: "0xece5ca8b", kind: "arc", lp: 4_080_000, pad: "Uniswap V4" }, { sym: "TOLLY", token: "0xbc43ce8d", kind: "arc", lp: 432_000, pad: "Uniswap V4" },
  { sym: "ARCOON", token: "0x4621a0ba", kind: "arc", lp: 222_800, pad: "peach.ag" }, { sym: "WONK", token: "0x548df4bf", kind: "arc", lp: 170_200, pad: "wonk.fun" }, { sym: "ARCT", token: "0x1ea1e4f9", kind: "arc", lp: 131_900, pad: "RadarDex" },
];
const lev = (m: Mkt, src: Src) => m.kind === "stock" ? (src === "weekend" ? 2 : 3) : m.lp >= 1_000_000 ? 3 : m.lp >= 300_000 ? 3 : 2;
type Src = "live" | "after" | "weekend";
/** US equity schedule in ET: 9:30–16:00 live; 20:00–04:00 (Sun–Thu nights) after-hours feed; else weekend/own market. */
function stockSource(now: Date): Src {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })); const d = et.getDay(); const h = et.getHours() + et.getMinutes() / 60;
  if (d >= 1 && d <= 5 && h >= 9.5 && h < 16) return "live";
  if ((d >= 1 && d <= 5 && (h >= 20 || h < 4)) || (d === 0 && h >= 20) || (d === 6 && h < 4) || (d >= 1 && d <= 5 && h >= 4 && h < 9.5) || (d >= 1 && d <= 5 && h >= 16 && h < 20)) return "after";
  return "weekend";
}
const SRC_LABEL: Record<Src, [string, string]> = { live: ["LIVE MARKET", "Pyth equity feed + median of exchanges, 3x"], after: ["AFTER-HOURS FEED", "24/5 ATS pricing (Pyth), fresh ≤ 5 min, 3x"], weekend: ["OWN MARKET · ±7 %", "no equity feed: our long/short balance sets the mark inside a ±7 % corridor around the last close, 2x"] };
const usd = (n: number, d = 2) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

export function PerpsPreview() {
  const [prices, setPrices] = useState<Record<string, number>>({}); const [sel, setSel] = useState(0); const [side, setSide] = useState<"long" | "short">("long");
  const [size, setSize] = useState(100); const [lv, setLv] = useState(3); const [now, setNow] = useState(() => new Date());
  useEffect(() => { fetch("/api/tokens?lite=1").then((r) => r.json()).then((j: { tokens: { token: string; symbol: string; priceUsd: number | null }[] }) => { const m: Record<string, number> = {}; for (const t of j.tokens) { const k = MARKETS.find((x) => t.token.toLowerCase().startsWith(x.token)); if (k && t.priceUsd) m[k.sym] = t.priceUsd; } setPrices(m); }).catch(() => null); const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const m = MARKETS[sel]; const src: Src = m.kind === "stock" ? stockSource(now) : "live"; const maxLev = lev(m, src); const L = Math.min(lv, maxLev);
  const px = prices[m.sym] ?? 0; const notional = size * L; const fee = notional * 0.001; const liqMove = (1 / L) * 0.85; const liqPx = side === "long" ? px * (1 - liqMove) : px * (1 + liqMove);
  const oiCap = m.kind === "stock" ? 50_000 : Math.round(m.lp * 0.1); const fund = 0; const fees24 = 0;
  const card: React.CSSProperties = { background: "var(--arc-panel, rgba(255,255,255,0.03))", border: "1px solid var(--arc-line)", borderRadius: 8, padding: 14 };
  const chip = (on: boolean): React.CSSProperties => ({ background: on ? "rgba(34,197,128,0.16)" : "transparent", border: "1px solid " + (on ? "var(--arc-up)" : "var(--arc-line)"), borderRadius: 4, color: on ? "var(--arc-up)" : "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "5px 9px" });
  const srcInfo = m.kind === "stock" ? SRC_LABEL[src] : ["ARC POOL TWAP", `5-min TWAP of the ${m.pad} pool, spikes > 10 %/min rejected, ${maxLev}x by liquidity (${usd(m.lp, 0)} LP)`];
  return (
    <div className="arc-mono" style={{ display: "grid", gap: 14 }}>
      <div style={{ ...card, background: "rgba(255,176,32,0.10)", borderColor: "#ffb020", color: "var(--arc-ink)", fontSize: 13 }}>
        <b>PREVIEW.</b> ArcPerps contracts are not deployed. Prices are live from the Terminal; positions, pool and funding below illustrate the design so we can agree on it before writing the contract. Nothing here can be traded.
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "280px minmax(0, 1fr) 320px" }}>
        <div style={card}>
          <p style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 8px" }}>MARKETS · 24/7</p>
          {(["stock", "arc"] as const).map((k) => (<div key={k}>
            <p style={{ color: "var(--arc-up)", fontSize: 11, margin: "8px 0 4px" }}>{k === "stock" ? "TOKENIZED STOCKS (long.supply)" : "ARC TOKENS · LP ≥ 100k"}</p>
            {MARKETS.filter((x) => x.kind === k).map((x) => { const i = MARKETS.indexOf(x); const s: Src = x.kind === "stock" ? stockSource(now) : "live"; return (
              <button key={x.sym} onClick={() => { setSel(i); setLv(Math.min(lv, lev(x, s))); }} style={{ alignItems: "center", background: i === sel ? "rgba(46,124,255,0.14)" : "transparent", border: "1px solid " + (i === sel ? "var(--arc-cobalt)" : "transparent"), borderRadius: 6, color: "var(--arc-ink)", cursor: "pointer", display: "flex", fontSize: 13, justifyContent: "space-between", padding: "7px 8px", width: "100%" }} type="button">
                <span><b>{x.sym}</b><span style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>{lev(x, s)}x</span></span>
                <span style={{ textAlign: "right" }}>{prices[x.sym] ? usd(prices[x.sym], prices[x.sym] < 1 ? 6 : 2) : "…"}<br /><span style={{ color: x.kind === "stock" && s === "weekend" ? "#ffb020" : "var(--arc-muted)", fontSize: 10 }}>{x.kind === "stock" ? SRC_LABEL[s][0].toLowerCase() : "pool twap"}</span></span>
              </button>); })}
          </div>))}
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={card}>
            <div style={{ alignItems: "baseline", display: "flex", gap: 14, justifyContent: "space-between" }}>
              <div><b style={{ fontSize: 26 }}>{m.sym}-USDC</b> <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>perp · {m.kind === "stock" ? "tokenized stock" : m.pad}</span></div>
              <div style={{ textAlign: "right" }}><b style={{ fontSize: 26 }}>{px ? usd(px, px < 1 ? 6 : 2) : "…"}</b><br /><span style={{ color: "var(--arc-muted)", fontSize: 11 }}>mark · funding 8h {side === "long" ? "+0.0100 %" : "−0.0100 %"} (illustrative)</span></div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--arc-line)", borderRadius: 6, fontSize: 12, marginTop: 12, padding: "10px 12px" }}>
              <span style={{ color: m.kind === "stock" && src === "weekend" ? "#ffb020" : "var(--arc-up)", fontWeight: 700 }}>PRICE SOURCE NOW: {srcInfo[0]}</span><br /><span style={{ color: "var(--arc-muted)" }}>{srcInfo[1]}</span>
              {m.kind === "stock" && <div style={{ color: "var(--arc-muted)", marginTop: 6 }}>Schedule (ET): 9:30–16:00 live market · 4:00–9:30 and 16:00–4:00 after-hours feed · Fri 20:00 – Sun 20:00 own market ±7 %. Now: {now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit" })} ET</div>}
            </div>
            <div style={{ alignItems: "center", background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 48px)", border: "1px dashed var(--arc-line)", borderRadius: 6, color: "var(--arc-muted)", display: "flex", fontSize: 12, height: 220, justifyContent: "center", marginTop: 12 }}>chart: mark (oracle) vs our market price, funding history · same chart engine as the token pages</div>
          </div>
          <div style={card}>
            <p style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 8px" }}>OPEN POSITIONS (illustrative)</p>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead><tr style={{ color: "var(--arc-muted)", textAlign: "left" }}><th>market</th><th>side</th><th>size</th><th>entry</th><th>mark</th><th>liq</th><th>PnL</th><th>funding</th><th /></tr></thead>
              <tbody>
                <tr><td>NVDA</td><td style={{ color: "var(--arc-up)" }}>LONG 3x</td><td>300 USDC</td><td>221.10</td><td>{prices.NVDA ? prices.NVDA.toFixed(2) : "…"}</td><td>158.45</td><td style={{ color: "var(--arc-up)" }}>+3.82 (+3.8 %)</td><td>−0.04</td><td><button style={chip(false)} type="button">close</button></td></tr>
                <tr><td>ARGUS</td><td style={{ color: "#f0534f" }}>SHORT 2x</td><td>200 USDC</td><td>0.01930</td><td>{prices.ARGUS ? prices.ARGUS.toFixed(5) : "…"}</td><td>0.02750</td><td style={{ color: "#f0534f" }}>−1.35 (−1.3 %)</td><td>+0.11</td><td><button style={chip(false)} type="button">close</button></td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={card}>
            <div style={{ display: "flex", gap: 6 }}><button onClick={() => setSide("long")} style={{ ...chip(side === "long"), flex: 1, fontWeight: 700 }} type="button">LONG</button><button onClick={() => setSide("short")} style={{ ...chip(side === "short"), borderColor: side === "short" ? "#f0534f" : "var(--arc-line)", color: side === "short" ? "#f0534f" : "var(--arc-ink)", background: side === "short" ? "rgba(240,83,79,0.16)" : "transparent", flex: 1, fontWeight: 700 }} type="button">SHORT</button></div>
            <p style={{ color: "var(--arc-muted)", fontSize: 11, margin: "12px 0 4px" }}>MARGIN (USDC)</p>
            <div style={{ display: "flex", gap: 6 }}>{[50, 100, 250, 500].map((v) => <button key={v} onClick={() => setSize(v)} style={chip(size === v)} type="button">{v}</button>)}</div>
            <p style={{ color: "var(--arc-muted)", fontSize: 11, margin: "12px 0 4px" }}>LEVERAGE · max {maxLev}x {m.kind === "stock" && src === "weekend" ? "(weekend cap)" : ""}</p>
            <div style={{ display: "flex", gap: 6 }}>{[1, 2, 3].map((v) => <button disabled={v > maxLev} key={v} onClick={() => setLv(v)} style={{ ...chip(L === v), opacity: v > maxLev ? 0.35 : 1 }} type="button">{v}x</button>)}</div>
            <div style={{ fontSize: 12, lineHeight: 1.8, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Position size</span><b>{usd(notional, 0)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Entry (mark)</span><b>{px ? usd(px, px < 1 ? 6 : 2) : "…"}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Liquidation ≈</span><b style={{ color: "#f0534f" }}>{px ? usd(liqPx, px < 1 ? 6 : 2) : "…"} ({side === "long" ? "−" : "+"}{(liqMove * 100).toFixed(0)} %)</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Fee 0.1 %</span><b>{usd(fee)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Counterparty</span><b>{fund > 0 ? "fund + traders" : "other traders (P2P)"}</b></div>
            </div>
            <button className="arc-cta" disabled style={{ marginTop: 12, opacity: 0.55, width: "100%" }} type="button">{side === "long" ? "Open long" : "Open short"} — preview</button>
            <p style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 8 }}>If no one takes the other side, the order rests until matched or the insurance fund can absorb it (up to 50 % of the fund).</p>
          </div>
          <div style={card}>
            <p style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 8px" }}>MARKET LIMITS</p>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>OI cap per side</span><b>{usd(oiCap, 0)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Open now</span><b>long 0 · short 0</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Insurance fund</span><b>{usd(fund, 0)} <span style={{ color: "var(--arc-muted)", fontWeight: 400 }}>(30 % of fees + liq. premiums)</span></b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>LP pool (optional)</span><b>{usd(0, 0)} · 70 % of fees</b></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>Fees 24h → burn</span><b>{usd(fees24)}</b></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
