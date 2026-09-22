import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WalletPanel } from "@/components/wallet-panel";
import { PREDICT_MARKETS, big as bn, encodeBet, encodeClaim, fetchHistory, fetchState, fmtPrice, fmtUsd, multiplier, userBets, type HistRound, type MarketState, type PredictState, type RoundState, type UserBet } from "@/lib/arc-predict";
import { hotAddress, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { connectWallet, getStoredWallet, onWalletChange, sendTx, waitReceipt } from "@/lib/arc-wallet";

/** ArcPredict — the PancakeSwap-Prediction shape (Expired · Live · Next · Later cards) in the Terminal's language:
 *  one ⚡ click with the trading wallet, pools and multipliers live, the price the operator will post drawn on the card,
 *  every lock/close price auditable on /api/predict/price. */
const U = 10n ** 18n;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const card: React.CSSProperties = { background: "var(--arc-paper-deep)", border: "1px solid var(--arc-line)", borderRadius: 16, overflow: "hidden", position: "relative" };
const chip = (on: boolean, color = "var(--arc-cobalt)"): React.CSSProperties => ({ background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : "transparent", border: `1px solid ${on ? color : "var(--arc-line)"}`, borderRadius: 8, color: "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "6px 12px" });

export function PredictContent({ v2 = false }: { v2?: boolean }) {
  const [market, setMarket] = useState(PREDICT_MARKETS[0].key);
  const [state, setState] = useState<PredictState | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [err, setErr] = useState<string | null>(null);
  // wallet
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setAddr(isUnlocked() && hotAddress() ? hotAddress() : getStoredWallet());
    sync(); const a = onHotChange(sync); const b = onWalletChange(() => sync());
    return () => { a(); b(); };
  }, []);
  const useHot = !!addr && isUnlocked() && hotAddress()?.toLowerCase() === addr.toLowerCase();
  const send = useCallback(async (to: string, data: string, value = 0n) => {
    if (!addr) throw new Error("no wallet");
    const h = useHot ? await hotSend({ to, data, value }) : await sendTx({ to, data, value, from: addr });
    const rc = useHot ? await hotWait(h) : await waitReceipt(h);
    if ((rc as { status?: number | string }).status !== 1 && (rc as { status?: number | string }).status !== "0x1") throw new Error("transaction reverted");
    return h;
  }, [addr, useHot]);

  // state poll (1 s) + clock
  useEffect(() => {
    let alive = true;
    const pull = () => fetchState().then((s) => { if (alive) { setState(s); setErr(null); } }).catch((e) => alive && setErr(String(e)));
    pull(); const t = setInterval(pull, 1000); const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 250);
    return () => { alive = false; clearInterval(t); clearInterval(c); };
  }, []);
  const ms = state?.markets[market]; const price = state?.prices[market]?.price ?? null;
  const m = PREDICT_MARKETS.find((x) => x.key === market)!;

  // price tape for the sparkline (client-side ring buffer of the operator's live price)
  const tape = useRef<{ t: number; p: number }[]>([]);
  useEffect(() => { if (price != null) { const a = tape.current; if (!a.length || a[a.length - 1].p !== price || now - a[a.length - 1].t >= 1) { a.push({ t: now, p: price }); if (a.length > 240) a.shift(); } } }, [price, now]);
  useEffect(() => { tape.current = []; }, [market]);

  // my bets
  const [mine, setMine] = useState<{ bets: UserBet[]; claimable: Record<number, string> }>({ bets: [], claimable: {} });
  const reloadMine = useCallback(() => { if (addr) userBets(market, addr).then(setMine).catch(() => null); }, [addr, market]);
  useEffect(() => { reloadMine(); const t = setInterval(reloadMine, 8000); return () => clearInterval(t); }, [reloadMine]);
  const [hist, setHist] = useState<HistRound[]>([]);
  useEffect(() => { let alive = true; const pull = () => fetchHistory(market, 40).then((h) => alive && setHist(h)).catch(() => null); pull(); const t = setInterval(pull, 10_000); return () => { alive = false; clearInterval(t); }; }, [market]);

  const [amount, setAmount] = useState("5"); const [busy, setBusy] = useState<string | null>(null); const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const say = (ok: boolean, text: string) => { setToast({ ok, text }); setTimeout(() => setToast(null), 6000); };
  const bet = async (up: boolean, epoch: number) => {
    if (!ms) return;
    const v = BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 12n;
    if (v < bn(ms.minBet)) { say(false, `minimum ${fmtUsd(ms.minBet, 0)} USDC`); return; }
    if (bn(ms.maxBet) > 0n && v > bn(ms.maxBet)) { say(false, `maximum ${fmtUsd(ms.maxBet, 0)} USDC per round`); return; }
    setBusy(`${up ? "UP" : "DOWN"} #${epoch}…`);
    try { const h = await send(ms.address, encodeBet(up, epoch), v); say(true, `${up ? "UP" : "DOWN"} ${amount} USDC on round #${epoch} · ${h.slice(0, 10)}…`); reloadMine(); }
    catch (e) { say(false, String((e as Error).message ?? e)); }
    setBusy(null);
  };
  const claimAll = async () => {
    const epochs = Object.keys(mine.claimable).map(Number); if (!epochs.length || !ms) return;
    setBusy("Claiming…");
    try { const h = await send(ms.address, encodeClaim(epochs)); const total = epochs.reduce((a, e) => a + bn(mine.claimable[e]), 0n); say(true, `Claimed ${fmtUsd(total)} USDC from ${epochs.length} round${epochs.length > 1 ? "s" : ""} · ${h.slice(0, 10)}…`); reloadMine(); }
    catch (e) { say(false, String((e as Error).message ?? e)); }
    setBusy(null);
  };

  const cur = ms?.currentEpoch ?? 0;
  const rounds = ms?.rounds ?? {};
  const live = rounds[String(cur - 1)]; const next = rounds[String(cur)];
  const claimableTotal = Object.values(mine.claimable).reduce((a, v) => a + bn(v), 0n);

  return (
    <>
      <div style={{ alignItems: "flex-end", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between" }}>
        <div>
          <p className="arc-eyebrow">ARCPREDICT</p>
          <h1 className="arc-h2" style={{ fontSize: 30, margin: 0 }}>Up or down. Two minutes. USDC.</h1>
          <p className="arc-body" style={{ margin: "8px 0 0", maxWidth: 760 }}>
            Pick a side before the round locks. When it closes, everyone on the winning side splits the whole pool, minus a 3 % fee that buys and burns ARCT.
            The lock and close prices are a median of Hyperliquid, Binance, Coinbase and Kraken, posted on-chain by the ArcTools operator and <a href={`${v2 ? "/predict2" : "/predict"}#audit`} style={{ color: "var(--arc-cobalt)" }}>auditable per round</a>.
            Tie or an empty side refunds everyone. A late operator refunds everyone. No admin can touch the pool.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {PREDICT_MARKETS.map((x) => (
            <button className="arc-mono" key={x.key} onClick={() => setMarket(x.key)} style={{ ...chip(market === x.key), alignItems: "center", display: "flex", gap: 8, padding: "8px 14px" }} type="button">
              <img alt="" src={x.logo} style={{ height: 18, width: 18 }} />{x.symbol}
              <span style={{ color: "var(--arc-muted)" }}>{state?.prices[x.key]?.price != null ? fmtPrice(state.prices[x.key].price! * 1e8, x.key) : "…"}</span>
            </button>
          ))}
        </div>
      </div>

      {err && <p className="arc-mono" style={{ color: "var(--arc-error)", fontSize: 12 }}>state feed: {err}</p>}
      {ms?.paused && <p className="arc-mono" style={{ color: "var(--arc-warn)", fontSize: 12 }}>This market is paused. Claims and refunds still work.</p>}
      {ms && ms.checked && now - ms.checked > 30 && <p className="arc-mono" style={{ color: "var(--arc-warn)", fontSize: 12 }}>Operator heartbeat is {now - ms.checked} s old — if a round is not closed within {ms.buffer} s of its time, it is refunded.</p>}

      {/* bet controls */}
      <div className="arc-mono" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
        <span style={{ color: "var(--arc-muted)", fontSize: 11, textTransform: "uppercase" }}>Stake</span>
        {["1", "5", "20", "100"].map((v) => <button key={v} onClick={() => setAmount(v)} style={chip(amount === v)} type="button">{v} USDC</button>)}
        <input inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="custom" style={{ ...chip(false), width: 90 }} value={amount} />
        <span style={{ color: "var(--arc-muted)", fontSize: 11 }}>min {ms ? fmtUsd(ms.minBet, 0) : "1"} · max {ms && bn(ms.maxBet) > 0n ? fmtUsd(ms.maxBet, 0) : "∞"} per round · one side per wallet</span>
        <span style={{ flex: 1 }} />
        {!addr ? <button className="arc-cta" onClick={() => void connectWallet().catch(() => null)} type="button">Connect wallet</button>
          : <span style={{ color: "var(--arc-muted)", fontSize: 12 }}>{useHot ? "⚡ trading wallet" : "🦊 browser wallet"} · {short(addr)}</span>}
      </div>
      {!addr && <div style={{ marginTop: 10, maxWidth: 520 }}><WalletPanel onReady={(a) => setAddr(a)} /></div>}

      {/* cards */}
      <div className="arc-predict-cards" style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", marginTop: 16 }}>
        {cur >= 3 && <ExpiredCard r={rounds[String(cur - 2)]} hist={hist} market={market} epoch={cur - 2} mine={mine} />}
        {live && <LiveCard r={live} price={price} now={now} market={market} tape={tape.current} mine={mine} />}
        {next && <NextCard r={next} now={now} ms={ms!} market={market} amount={amount} busy={busy} onBet={bet} mine={mine} canBet={!!addr} />}
        <LaterCard epoch={cur + 1} lockAt={next ? next.lockTime + (ms?.interval ?? 120) : 0} now={now} interval={ms?.interval ?? 120} />
      </div>

      {/* claims + my bets */}
      <div className="arc-pay-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", marginTop: 22 }}>
        <div style={{ ...card, padding: 16 }}>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0, textTransform: "uppercase" }}>My rounds · {m.symbol}</p>
            {claimableTotal > 0n && <button className="arc-cta" disabled={!!busy} onClick={() => void claimAll()} type="button">{busy ?? `Claim ${fmtUsd(claimableTotal)} USDC`}</button>}
          </div>
          {!addr ? <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13 }}>Connect to see your rounds.</p>
            : mine.bets.length === 0 ? <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13 }}>No bets on this market yet.</p>
            : <div style={{ display: "grid", gap: 6, marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                {mine.bets.map((b) => {
                  const r = rounds[String(b.epoch)] ?? hist.find((h) => h.epoch === b.epoch);
                  const status = r ? ("status" in r ? r.status : (r as HistRound).status) : null; const winner = r ? ("winner" in r ? r.winner : null) : null;
                  const won = status === 2 && winner === b.position; const lost = status === 2 && winner !== 0 && winner !== b.position; const refund = status === 3 || (status === 2 && winner === 0);
                  const cl = mine.claimable[b.epoch];
                  return (
                    <div className="arc-mono" key={b.epoch} style={{ display: "flex", fontSize: 12, gap: 10, justifyContent: "space-between" }}>
                      <span>#{b.epoch} <span style={{ color: b.position === 1 ? "var(--arc-up)" : "var(--arc-error)" }}>{b.position === 1 ? "UP" : "DOWN"}</span> {fmtUsd(b.amount)} USDC</span>
                      <span style={{ color: won ? "var(--arc-up)" : lost ? "var(--arc-error)" : "var(--arc-muted)" }}>
                        {b.claimed ? "claimed" : cl ? `${won ? "won" : "refund"} ${fmtUsd(cl)}` : won ? "won" : lost ? "lost" : refund ? "refund" : status === 1 ? "live" : status === 0 ? "open" : "pending"}
                      </span>
                    </div>
                  );
                })}
              </div>}
        </div>
        <div id="audit" style={{ ...card, padding: 16 }}>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0, textTransform: "uppercase" }}>Recent rounds · {m.symbol}</p>
          <div style={{ display: "grid", gap: 4, marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
            {hist.length === 0 && <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13 }}>No resolved rounds yet.</p>}
            {hist.map((h) => {
              const pool = bn(h.up_amount) + bn(h.down_amount);
              return (
                <div className="arc-mono" key={h.epoch} style={{ alignItems: "center", display: "grid", fontSize: 12, gap: 8, gridTemplateColumns: "48px 1fr 1fr 70px 80px" }}>
                  <span style={{ color: "var(--arc-muted)" }}>#{h.epoch}</span>
                  <span>{fmtPrice(Math.round(h.lock_price * 1e8), market)} → {fmtPrice(Math.round(h.close_price * 1e8), market)}</span>
                  <span style={{ color: h.status === 3 || h.winner === 0 ? "var(--arc-muted)" : h.winner === 1 ? "var(--arc-up)" : "var(--arc-error)" }}>{h.status === 3 ? "cancelled · refunds" : h.winner === 0 ? (pool === 0n ? "no bets" : "tie · refunds") : h.winner === 1 ? (bn(h.down_amount) === 0n ? "UP · one side · refund" : "UP") : (bn(h.up_amount) === 0n ? "DOWN · one side · refund" : "DOWN")}</span>
                  <span style={{ color: "var(--arc-muted)", textAlign: "right" }}>{fmtUsd(pool, 0)} USDC</span>
                  <a href={`https://arc-scan.org/address/${ms?.address}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", textAlign: "right" }} target="_blank">contract</a>
                </div>
              );
            })}
          </div>
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 10 }}>
            Every posted price with its four sources: <a href={`https://bot-production-4200.up.railway.app/api/predict/price?market=${encodeURIComponent(market)}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">price log</a> · contract <a href={`https://arc-scan.org/address/${ms?.address}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{ms ? short(ms.address) : "…"}</a> · operator {state?.operator ? short(state.operator) : "…"} · source on GitHub
          </p>
        </div>
      </div>

      {toast && <div className="arc-mono" style={{ background: toast.ok ? "rgba(34,197,94,0.14)" : "rgba(255,107,94,0.14)", border: `1px solid ${toast.ok ? "var(--arc-up)" : "var(--arc-error)"}`, borderRadius: 10, bottom: 20, fontSize: 13, maxWidth: 420, padding: "10px 14px", position: "fixed", right: 20, zIndex: 40 }}>{toast.text}</div>}
    </>
  );
}

// ───────────────────────── cards ─────────────────────────
function Head({ label, epoch, color, right }: { label: string; epoch: number; color: string; right?: React.ReactNode }) {
  return (
    <div className="arc-mono" style={{ alignItems: "center", background: `color-mix(in srgb, ${color} 14%, transparent)`, borderBottom: "1px solid var(--arc-line)", display: "flex", fontSize: 11, justifyContent: "space-between", padding: "8px 14px", textTransform: "uppercase" }}>
      <span style={{ color }}>{label}</span><span style={{ color: "var(--arc-muted)" }}>#{epoch}</span>{right}
    </div>
  );
}
const cd = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

function Pools({ r, feeBps, big }: { r: RoundState; feeBps: number; big?: boolean }) {
  const mu = multiplier(r.upAmount, r.downAmount, "up", feeBps), md = multiplier(r.upAmount, r.downAmount, "down", feeBps);
  const pool = bn(r.upAmount) + bn(r.downAmount);
  const upPct = pool > 0n ? Number((bn(r.upAmount) * 1000n) / pool) / 10 : 50;
  return (
    <div className="arc-mono" style={{ fontSize: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--arc-up)" }}>UP {mu ? `${mu.toFixed(2)}×` : "—"}</span><span style={{ color: "var(--arc-muted)" }}>pool {fmtUsd(pool, big ? 2 : 0)} USDC</span><span style={{ color: "var(--arc-error)" }}>{md ? `${md.toFixed(2)}×` : "—"} DOWN</span></div>
      <div style={{ background: "var(--arc-line)", borderRadius: 4, height: 6, margin: "6px 0", overflow: "hidden" }}><div style={{ background: "var(--arc-up)", height: "100%", width: `${upPct}%` }} /></div>
      <div style={{ color: "var(--arc-muted)", display: "flex", justifyContent: "space-between" }}><span>{fmtUsd(r.upAmount, 0)}</span><span>{fmtUsd(r.downAmount, 0)}</span></div>
    </div>
  );
}

function MyMark({ mine, epoch }: { mine: { bets: UserBet[] }; epoch: number }) {
  const b = mine.bets.find((x) => x.epoch === epoch); if (!b) return null;
  return <span className="arc-mono" style={{ background: b.position === 1 ? "rgba(34,197,94,0.16)" : "rgba(255,107,94,0.16)", borderRadius: 6, color: b.position === 1 ? "var(--arc-up)" : "var(--arc-error)", fontSize: 10, padding: "2px 6px" }}>you: {b.position === 1 ? "UP" : "DOWN"} {fmtUsd(b.amount, 0)}</span>;
}

function ExpiredCard({ r, hist, market, epoch, mine }: { r?: RoundState; hist: HistRound[]; market: string; epoch: number; mine: { bets: UserBet[] } }) {
  const h = hist.find((x) => x.epoch === epoch);
  const lock = r?.lockPrice ?? (h ? Math.round(h.lock_price * 1e8) : 0); const close = r?.closePrice ?? (h ? Math.round(h.close_price * 1e8) : 0);
  const winner = r?.winner ?? h?.winner ?? 0; const status = r?.status ?? h?.status ?? 0;
  const up = r?.upAmount ?? h?.up_amount ?? "0", down = r?.downAmount ?? h?.down_amount ?? "0";
  const color = status === 3 || winner === 0 ? "var(--arc-muted)" : winner === 1 ? "var(--arc-up)" : "var(--arc-error)";
  return (
    <div style={{ ...card, opacity: 0.75 }}>
      <Head color="var(--arc-muted)" epoch={epoch} label="Expired" right={<MyMark epoch={epoch} mine={mine} />} />
      <div style={{ padding: 14 }}>
        <div className="arc-mono" style={{ color, fontSize: 22, fontWeight: 700 }}>{status === 3 ? "Cancelled" : winner === 0 ? (bn(up) + bn(down) === 0n ? "No bets" : bn(up) === 0n || bn(down) === 0n ? "One side · refund" : "Tie · refund") : winner === 1 ? "UP won" : "DOWN won"}</div>
        <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "6px 0 12px" }}>{lock ? fmtPrice(lock, market) : "—"} → <span style={{ color: "var(--arc-ink)" }}>{close ? fmtPrice(close, market) : "—"}</span>{lock && close ? <span style={{ color, marginLeft: 8 }}>{((close - lock) / lock * 100).toFixed(3)} %</span> : null}</div>
        {r ? <Pools feeBps={300} r={r} /> : <Pools feeBps={300} r={{ epoch, startTime: 0, lockTime: 0, closeTime: 0, lockPrice: lock, closePrice: close, upAmount: up, downAmount: down, rewardBase: "0", rewardAmount: "0", fee: "0", status, winner }} />}
      </div>
    </div>
  );
}

function LiveCard({ r, price, now, market, tape, mine }: { r: RoundState; price: number | null; now: number; market: string; tape: { t: number; p: number }[]; mine: { bets: UserBet[] } }) {
  const lock = r.lockPrice; const cur = price != null ? Math.round(price * 1e8) : null;
  const up = cur != null && cur > lock; const down = cur != null && cur < lock;
  const color = up ? "var(--arc-up)" : down ? "var(--arc-error)" : "var(--arc-muted)";
  const left = r.closeTime - now;
  const pts = tape.filter((x) => x.t >= r.lockTime - 5);
  return (
    <div style={{ ...card, boxShadow: `0 0 0 1px ${color}, 0 10px 40px color-mix(in srgb, ${color} 22%, transparent)` }}>
      <Head color={color} epoch={r.epoch} label="Live" right={<span style={{ color: left <= 10 ? "var(--arc-warn)" : "var(--arc-ink)", fontVariantNumeric: "tabular-nums" }}>{left > 0 ? cd(left) : "closing…"}</span>} />
      <div style={{ padding: 14, position: "relative" }}>
        <Spark color={color} lock={lock} pts={pts} />
        <div className="arc-mono" style={{ alignItems: "baseline", display: "flex", gap: 10 }}>
          <span style={{ color, fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{cur != null ? fmtPrice(cur, market) : "…"}</span>
          {cur != null && <span style={{ color, fontSize: 13 }}>{up ? "▲" : down ? "▼" : "="} {((cur - lock) / lock * 100).toFixed(3)} %</span>}
        </div>
        <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "4px 0 12px" }}>locked at <span style={{ color: "var(--arc-ink)" }}>{fmtPrice(lock, market)}</span> <MyMark epoch={r.epoch} mine={mine} /></div>
        <Pools big feeBps={300} r={r} />
      </div>
    </div>
  );
}

function Spark({ pts, lock, color }: { pts: { t: number; p: number }[]; lock: number; color: string }) {
  const W = 320, H = 70;
  if (pts.length < 2) return <div style={{ height: H, marginBottom: 6 }} />;
  const l = lock / 1e8; const vals = pts.map((x) => x.p).concat([l]); const min = Math.min(...vals), max = Math.max(...vals); const span = Math.max(max - min, l * 0.0004);
  const y = (p: number) => H - 6 - ((p - (min + max) / 2 + span / 2) / span) * (H - 12);
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  return (
    <svg height={H} preserveAspectRatio="none" style={{ display: "block", marginBottom: 6, width: "100%" }} viewBox={`0 0 ${W} ${H}`}>
      <line stroke="var(--arc-muted)" strokeDasharray="4 4" strokeWidth="1" x1="0" x2={W} y1={y(l)} y2={y(l)} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
      <circle cx={W} cy={y(pts[pts.length - 1].p)} fill={color} r="3" />
    </svg>
  );
}

function NextCard({ r, now, ms, market, amount, busy, onBet, mine, canBet }: { r: RoundState; now: number; ms: MarketState; market: string; amount: string; busy: string | null; onBet: (up: boolean, epoch: number) => void; mine: { bets: UserBet[] }; canBet: boolean }) {
  const left = r.lockTime - now; const closed = left <= 0;
  const already = mine.bets.find((b) => b.epoch === r.epoch);
  return (
    <div style={{ ...card, boxShadow: "0 0 0 1px var(--arc-cobalt)" }}>
      <Head color="var(--arc-cobalt)" epoch={r.epoch} label="Next" right={<span style={{ color: left <= 10 ? "var(--arc-warn)" : "var(--arc-ink)", fontVariantNumeric: "tabular-nums" }}>{closed ? "locking…" : `locks in ${cd(left)}`}</span>} />
      <div style={{ padding: 14 }}>
        <Pools feeBps={ms.feeBps} r={r} />
        {already ? <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "14px 0 0" }}>You are in: <MyMark epoch={r.epoch} mine={mine} /> — one side per wallet per round.</p> : (
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
            <button className="arc-mono" disabled={!canBet || !!busy || closed} onClick={() => onBet(true, r.epoch)} style={{ background: "var(--arc-up)", border: 0, borderRadius: 10, color: "#04140a", cursor: "pointer", fontSize: 15, fontWeight: 700, opacity: !canBet || closed ? 0.5 : 1, padding: "14px 0" }} type="button">▲ UP {amount} USDC</button>
            <button className="arc-mono" disabled={!canBet || !!busy || closed} onClick={() => onBet(false, r.epoch)} style={{ background: "var(--arc-error)", border: 0, borderRadius: 10, color: "#1a0806", cursor: "pointer", fontSize: 15, fontWeight: 700, opacity: !canBet || closed ? 0.5 : 1, padding: "14px 0" }} type="button">▼ DOWN {amount} USDC</button>
          </div>
        )}
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "10px 0 0" }}>{busy ?? `Round locks at the operator's next price post, then runs ${ms.interval} s. Fee ${ms.feeBps / 100} % of the pool → ARCT buyback.`}</p>
      </div>
    </div>
  );
}

function LaterCard({ epoch, lockAt, now, interval }: { epoch: number; lockAt: number; now: number; interval: number }) {
  return (
    <div style={{ ...card, opacity: 0.6 }}>
      <Head color="var(--arc-muted)" epoch={epoch} label="Later" />
      <div className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: 14 }}>
        <p style={{ margin: 0 }}>Opens when the next round locks{lockAt ? ` · in ~${cd(lockAt - interval - now)}` : ""}.</p>
        <p style={{ margin: "8px 0 0" }}>Rounds roll every {interval} s, around the clock.</p>
      </div>
    </div>
  );
}
