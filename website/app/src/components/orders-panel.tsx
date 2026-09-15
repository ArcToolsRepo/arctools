import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BOT_API } from "@/lib/bot-api";
import { ARC_ORDERS, hotAddress, hotAllowance, hotApprove, hotSignMessage, hotSignOrder, hotWait, isUnlocked, onHotChange, type ArcOrder } from "@/lib/arc-hotwallet";

/**
 * Limit buy / take-profit / stop-loss for the token page. Non-custodial: the order is an EIP-712 signature from the
 * trading wallet + an allowance to ArcOrders; the keeper fills it through ArcAggregator when the trigger hits and the
 * contract refuses anything worse than the signed minimum rate. Open orders are drawn on the chart (see `useOrderLines`).
 */

export type OrderRow = {
  hash: string; maker: string; token: string; is_buy: boolean; amount_in: string; min_rate: string; expiry: number; kind: "limit" | "tp" | "sl";
  trigger_price: number; trigger_mcap: number | null; symbol: string | null; status: "open" | "filled" | "cancelled" | "expired" | "failed";
  note: string | null; attempts: number; created_ts: number; fill_tx: string | null; fill_out: string | null; fill_price: number | null; fill_ts: number | null;
};
export type OrderEvent = { hash: string; kind: string; symbol: string | null; tx: string; price: number; ts: number };

const USDC = "0x3600000000000000000000000000000000000000";
const MAX = (1n << 256n) - 1n;
const SLIP = { limit: 0.03, tp: 0.05, sl: 0.15 };     // tolerance baked into minRate: how much worse than trigger we still accept
export const ORDER_COLORS = { limit: "#22c580", tp: "#2e7cff", sl: "#f0534f" } as const;

const money = (v: number | null | undefined, d = 0) => v == null || !isFinite(v) ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(v < 1 ? 4 : d)}`;
const px = (p: number | null | undefined) => p == null || !isFinite(p) ? "—" : p >= 1 ? `$${p.toFixed(4)}` : p >= 0.0001 ? `$${p.toFixed(6)}` : `$${p.toExponential(2)}`;

export function useMyOrders(token: string, addr: string | null) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const load = useCallback(async () => {
    if (!addr) { setOrders([]); return; }
    try {
      const j = await fetch(`${BOT_API}/api/orders?maker=${addr}&token=${token}`).then((r) => r.json()) as { orders: OrderRow[]; events?: OrderEvent[] };
      setOrders(j.orders ?? []);
      if (j.events?.length) setEvents((e) => [...j.events!, ...e].slice(0, 5));
    } catch { /* keep last */ }
  }, [addr, token]);
  useEffect(() => { void load(); const id = setInterval(() => { if (!document.hidden) void load(); }, 10_000); return () => clearInterval(id); }, [load]);
  return { orders, events, reload: load, dismiss: (h: string) => setEvents((e) => e.filter((x) => x.hash !== h)) };
}

type Props = {
  token: string; symbol: string; price: number | null; supply: number | null; balUsdc: number | null; balTok: number | null;
  onOrdersChange?: (o: OrderRow[]) => void;
};

export function OrdersPanel({ token, symbol, price, supply, balUsdc, balTok, onOrdersChange }: Props) {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => { const f = () => setAddr(hotAddress()); f(); const off = onHotChange(f); return () => { off(); }; }, []);
  const { orders, events, reload, dismiss } = useMyOrders(token, addr);
  useEffect(() => { onOrdersChange?.(orders); }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps

  const [kind, setKind] = useState<"limit" | "tp" | "sl">("limit");
  const [mode, setMode] = useState<"mcap" | "price" | "pct">("mcap");
  const [trig, setTrig] = useState("");
  const [amt, setAmt] = useState("");
  const [ttl, setTtl] = useState(7);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [allow, setAllow] = useState<{ usdc: bigint; tok: bigint } | null>(null);
  const salt = useRef(BigInt(Date.now()));

  const refreshAllow = useCallback(async () => {
    if (!addr) return;
    try { const [u, t] = await Promise.all([hotAllowance(USDC, addr, ARC_ORDERS), hotAllowance(token, addr, ARC_ORDERS)]); setAllow({ usdc: u, tok: t }); } catch { /* ignore */ }
  }, [addr, token]);
  useEffect(() => { void refreshAllow(); }, [refreshAllow]);

  // trigger → absolute price
  const trigPrice = useMemo(() => {
    const v = Number(trig.replace(/[,\s$]/g, "").replace(/k$/i, "e3").replace(/m$/i, "e6"));
    if (!isFinite(v) || v <= 0) return null;
    if (mode === "price") return v;
    if (mode === "mcap") return supply ? v / supply : null;
    if (!price) return null;                                   // pct: relative to the current price
    return kind === "limit" || kind === "sl" ? price * (1 - v / 100) : price * (1 + v / 100);
  }, [trig, mode, supply, price, kind]);
  const trigMcap = trigPrice && supply ? trigPrice * supply : null;

  const sane = useMemo(() => {
    if (!trigPrice || !price) return null;
    if (kind === "limit" && trigPrice >= price) return "a limit buy must be below the current price (use Buy for a market order)";
    if (kind === "tp" && trigPrice <= price) return "take profit must be above the current price";
    if (kind === "sl" && trigPrice >= price) return "stop loss must be below the current price";
    return null;
  }, [trigPrice, price, kind]);

  const amountNum = Number(amt);
  const isBuy = kind === "limit";
  const needApprove = useMemo(() => {
    if (!allow || !isFinite(amountNum) || amountNum <= 0) return false;
    // USDC facade allowance is in 6-decimals units; token allowances in 18
    const need = isBuy ? BigInt(Math.ceil(amountNum * 1.01 * 1e6)) : BigInt(Math.round(amountNum * 1e6)) * 10n ** 12n;
    return (isBuy ? allow.usdc : allow.tok) < need;
  }, [allow, amountNum, isBuy]);

  const approve = async () => {
    if (!addr) return;
    setBusy("approving…"); setMsg(null);
    try {
      const h = await hotApprove(isBuy ? USDC : token, ARC_ORDERS, MAX);
      await hotWait(h); await refreshAllow();
      setMsg({ t: `${isBuy ? "USDC" : symbol} approved for ArcOrders — funds stay in your wallet`, ok: true });
    } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
    setBusy(null);
  };

  const place = async () => {
    if (!addr || !trigPrice || !isFinite(amountNum) || amountNum <= 0) return;
    setBusy("signing…"); setMsg(null);
    try {
      const amountIn = BigInt(Math.round(amountNum * 1e6)) * 10n ** 12n;
      // minRate (1e18 fixed): buy → tokens per USDC at trigger price × (1 − slip); sell → USDC per token × (1 − slip)
      const rate = isBuy ? (1 / trigPrice) * (1 - SLIP[kind]) : trigPrice * (1 - SLIP[kind]);
      const minRate = BigInt(Math.floor(rate * 1e6)) * 10n ** 12n;
      const o: ArcOrder = { maker: addr, token, isBuy, amountIn, minRate, expiry: BigInt(Math.floor(Date.now() / 1000) + ttl * 86400), salt: salt.current++ };
      const sig = await hotSignOrder(o);
      const body = { order: { ...o, amountIn: o.amountIn.toString(), minRate: o.minRate.toString(), expiry: o.expiry.toString(), salt: o.salt.toString() }, sig, kind, trigger_price: trigPrice, trigger_mcap: trigMcap, symbol };
      const j = await fetch(`${BOT_API}/api/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()) as { ok: boolean; error?: string; note?: string | null };
      if (!j.ok) throw new Error(j.error ?? "rejected");
      setMsg({ t: j.note ? `Order placed — ${j.note}` : "Order placed. The keeper fills it when the trigger hits; you can close the tab.", ok: true });
      setTrig(""); setAmt(""); await reload();
    } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
    setBusy(null);
  };

  const cancel = async (h: string) => {
    setBusy("cancelling…");
    try {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await hotSignMessage(`ArcTools cancel order\nhash: ${h}\nts: ${ts}`);
      await fetch(`${BOT_API}/api/orders/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hash: h, ts, sig }) });
      await reload();
    } catch (e) { setMsg({ t: (e as Error).message, ok: false }); }
    setBusy(null);
  };

  const open = orders.filter((o) => o.status === "open");
  const done = orders.filter((o) => o.status !== "open").slice(0, 6);
  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid var(--arc-line)", borderRadius: 6, color: "var(--arc-ink)", fontSize: 13, padding: "7px 9px", width: "100%" };
  const chip = (on: boolean, col = "var(--arc-cobalt)"): React.CSSProperties => ({ background: on ? `${col}22` : "transparent", border: `1px solid ${on ? col : "var(--arc-line)"}`, borderRadius: 6, color: on ? col : "var(--arc-muted)", cursor: "pointer", fontSize: 11, padding: "4px 9px" });

  return (
    <div className="arc-orders" style={{ marginTop: 14 }}>
      {events.map((e) => (
        <div className="arc-mono" key={e.hash + e.ts} style={{ alignItems: "center", background: "rgba(34,197,128,0.10)", border: "1px solid var(--arc-up)", borderRadius: 8, display: "flex", fontSize: 12, gap: 8, marginBottom: 8, padding: "8px 10px" }}>
          <span>✅ {e.kind === "limit" ? "Limit buy" : e.kind === "tp" ? "Take profit" : "Stop loss"} filled at {px(e.price)}</span>
          <a href={`https://arc-scan.org/tx/${e.tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", marginLeft: "auto" }} target="_blank">tx ↗</a>
          <button onClick={() => dismiss(e.hash)} style={{ background: "none", border: "none", color: "var(--arc-muted)", cursor: "pointer" }} type="button">✕</button>
        </div>
      ))}
      <div style={{ alignItems: "center", display: "flex", gap: 6, marginBottom: 8 }}>
        {(["limit", "tp", "sl"] as const).map((k) => (
          <button className="arc-mono" key={k} onClick={() => { setKind(k); setMsg(null); if (k !== "limit" && mode === "mcap") setMode("pct"); if (k === "limit" && mode === "pct") setMode("mcap"); }} style={chip(kind === k, ORDER_COLORS[k])} type="button">
            {k === "limit" ? "Limit buy" : k === "tp" ? "Take profit" : "Stop loss"}
          </button>
        ))}
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginLeft: "auto" }} title="Your funds stay in your wallet. The order is a signature; ArcOrders can only fill it at your price or better.">non-custodial</span>
      </div>
      {!addr ? (
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: 0 }}>Create or unlock the trading wallet above to place orders. Orders run 24/7 from our keeper — no tab needed.</p>
      ) : (
        <>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <div className="arc-mono" style={{ alignItems: "center", color: "var(--arc-muted)", display: "flex", fontSize: 10, gap: 4, marginBottom: 4 }}>
                {kind === "limit" ? "BUY WHEN" : kind === "tp" ? "SELL WHEN" : "SELL IF"}
                {(kind === "limit" ? ["mcap", "price", "pct"] as const : ["pct", "mcap", "price"] as const).map((m) => (
                  <button className="arc-mono" key={m} onClick={() => { setMode(m); setTrig(""); }} style={{ ...chip(mode === m), fontSize: 10, marginLeft: m === "mcap" || (kind !== "limit" && m === "pct") ? "auto" : 0, padding: "1px 6px" }} type="button">{m === "mcap" ? "MC" : m === "price" ? "price" : kind === "tp" ? "+%" : "−%"}</button>
                ))}
              </div>
              <input inputMode="decimal" onChange={(e) => setTrig(e.target.value)} placeholder={mode === "mcap" ? (kind === "limit" ? "MC ≤ e.g. 250k" : "MC e.g. 2m") : mode === "price" ? "price in USDC" : kind === "tp" ? "% above now, e.g. 100" : "% below now, e.g. 30"} style={inp} value={trig} />
              <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginTop: 3 }}>
                {trigPrice ? <>at {px(trigPrice)}{trigMcap ? ` · MC ${money(trigMcap)}` : ""}{price ? ` · ${((trigPrice / price - 1) * 100).toFixed(0)}% vs now` : ""}</> : price ? <>now {px(price)}{supply ? ` · MC ${money(price * supply)}` : ""}</> : " "}
              </div>
            </div>
            <div>
              <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", fontSize: 10, justifyContent: "space-between", marginBottom: 4 }}>
                <span>{isBuy ? "SPEND USDC" : `SELL ${symbol}`}</span>
                <span>{isBuy ? (balUsdc != null ? `bal ${balUsdc.toFixed(2)}` : "") : (balTok != null ? `bal ${balTok.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "")}</span>
              </div>
              <input inputMode="decimal" onChange={(e) => setAmt(e.target.value)} placeholder={isBuy ? "e.g. 20" : "amount"} style={inp} value={amt} />
              <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                {isBuy ? [5, 20, 100].map((v) => <button className="arc-mono" key={v} onClick={() => setAmt(String(v))} style={{ ...chip(false), padding: "1px 6px" }} type="button">{v}</button>)
                  : [25, 50, 100].map((p) => <button className="arc-mono" key={p} onClick={() => balTok != null && setAmt(String(Math.floor(balTok * p / 100 * 1e6) / 1e6))} style={{ ...chip(false), padding: "1px 6px" }} type="button">{p}%</button>)}
                <select className="arc-mono" onChange={(e) => setTtl(Number(e.target.value))} style={{ ...chip(false), marginLeft: "auto", padding: "1px 4px" }} value={ttl}>
                  {[1, 3, 7, 30].map((d) => <option key={d} value={d}>{d}d</option>)}
                </select>
              </div>
            </div>
          </div>
          {sane && <div className="arc-mono" style={{ color: "#f5c542", fontSize: 11, marginTop: 6 }}>{sane}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {needApprove ? (
              <button className="arc-cta" disabled={!!busy} onClick={() => void approve()} style={{ flex: 1, fontSize: 13, padding: "9px 12px" }} type="button">{busy ?? `1. Approve ${isBuy ? "USDC" : symbol} for ArcOrders`}</button>
            ) : (
              <button className="arc-cta" disabled={!!busy || !trigPrice || !!sane || !(amountNum > 0)} onClick={() => void place()} style={{ background: ORDER_COLORS[kind], flex: 1, fontSize: 13, padding: "9px 12px" }} type="button">
                {busy ?? (kind === "limit" ? `Place limit buy${trigMcap ? ` @ ${money(trigMcap)}` : ""}` : kind === "tp" ? `Set take profit${trigMcap ? ` @ ${money(trigMcap)}` : ""}` : `Set stop loss${trigMcap ? ` @ ${money(trigMcap)}` : ""}`)}
              </button>
            )}
          </div>
          <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginTop: 6 }}>
            Fee 1% on fill (same as the sniper). Fill tolerance {Math.round(SLIP[kind] * 100)}% — the contract rejects anything worse. Keeper checks every 8 s.
          </div>
          {msg && <div className="arc-mono" style={{ color: msg.ok ? "var(--arc-up)" : "var(--arc-down)", fontSize: 12, marginTop: 8 }}>{msg.t}</div>}
        </>
      )}

      {(open.length > 0 || done.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, marginBottom: 4 }}>YOUR ORDERS · {symbol}</div>
          {open.map((o) => (
            <div className="arc-mono" key={o.hash} style={{ alignItems: "center", borderTop: "1px solid var(--arc-line)", display: "flex", fontSize: 11, gap: 8, padding: "6px 0" }}>
              <span style={{ background: ORDER_COLORS[o.kind], borderRadius: 3, display: "inline-block", height: 10, width: 3 }} />
              <span style={{ color: ORDER_COLORS[o.kind], minWidth: 62 }}>{o.kind === "limit" ? "LIMIT BUY" : o.kind === "tp" ? "TAKE PROFIT" : "STOP LOSS"}</span>
              <span>{o.is_buy ? `${(Number(o.amount_in) / 1e18).toFixed(2)} USDC` : `${(Number(o.amount_in) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${symbol}`}</span>
              <span style={{ color: "var(--arc-muted)" }}>@ {o.trigger_mcap ? `MC ${money(o.trigger_mcap)}` : px(o.trigger_price)}</span>
              {o.note && <span style={{ color: "#f5c542" }} title={o.note}>⚠ {o.note.replace(/^waiting: /, "")}</span>}
              <button disabled={!!busy} onClick={() => void cancel(o.hash)} style={{ background: "none", border: "1px solid var(--arc-line)", borderRadius: 4, color: "var(--arc-muted)", cursor: "pointer", fontSize: 10, marginLeft: "auto", padding: "2px 6px" }} type="button">cancel</button>
            </div>
          ))}
          {done.map((o) => (
            <div className="arc-mono" key={o.hash} style={{ alignItems: "center", borderTop: "1px solid var(--arc-line)", color: "var(--arc-muted)", display: "flex", fontSize: 11, gap: 8, padding: "5px 0" }}>
              <span style={{ minWidth: 62 }}>{o.kind === "limit" ? "limit buy" : o.kind}</span>
              <span>{o.status}{o.fill_price ? ` @ ${px(o.fill_price)}` : ""}</span>
              {o.fill_tx && <a href={`https://arc-scan.org/tx/${o.fill_tx}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">tx ↗</a>}
              {o.status === "failed" && o.note && <span title={o.note}>· {o.note.slice(0, 40)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
