/** ArcPredict in ArcOne: BTC / ETH / SOL up-or-down rounds every 2 minutes, USDC, one tap with the trading wallet. */
import { useCallback, useEffect, useRef, useState } from "react";
import * as HW from "../lib/arc-hotwallet";
import { toast } from "../lib/store";
import { Header } from "../components/ui";
import { Unlock } from "./Wallet";
import { buzzOk, openUrl } from "../lib/native";

const BOT = "https://bot-production-4200.up.railway.app";
const MARKETS = [
  { key: "BTC/USD", sym: "BTC", addr: "0x88fb5f7Fd4a9cEeF59AaE3DD5fEE92259E2B10e0" },
  { key: "ETH/USD", sym: "ETH", addr: "0x4d235443685AD0273b8Dd3Ebd4F3af9E466afB4d" },
  { key: "SOL/USD", sym: "SOL", addr: "0x6D8B07940A378Ea97E9C4caa4Bdab40603639fc4" },
];
const SEL = { betUp: "0x5e457cf8", betDown: "0x47d2a6c7", claim: "0x6ba4c138", claimable: "0x22d95eac", getUserRounds: "0x951fd600", userRoundsLength: "0x02072b12" };
const pnum = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0"); const p32 = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
type Round = { epoch: number; lockTime: number; closeTime: number; lockPrice: number; closePrice: number; upAmount: string; downAmount: string; rewardAmount: string; status: number; winner: number };
type State = { markets: Record<string, { interval: number; buffer: number; minBet: string; maxBet: string; feeBps: number; currentEpoch: number | null; rounds: Record<string, Round>; checked?: number }>; prices: Record<string, { price: number | null }> };
type Hist = { epoch: number; lock_price: number; close_price: number; up_amount: string; down_amount: string; status: number; winner: number };
const big = (v: string | number | undefined | null) => { const s = String(v ?? "0"); return /^\d+$/.test(s) ? BigInt(s) : BigInt(Math.round(Number(s) || 0)); };
const usd = (w: string | bigint, d = 2) => (Number(big(w as string)) / 1e18).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const px = (p: number, m: string) => (p / 1e8).toLocaleString(undefined, { minimumFractionDigits: m.startsWith("SOL") ? 3 : 2, maximumFractionDigits: m.startsWith("SOL") ? 3 : 2 });
const cd = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const mult = (up: string, down: string, side: "up" | "down", fee: number) => { const u = big(up), d = big(down), s = side === "up" ? u : d; return s === 0n ? null : Number(((u + d) * BigInt(10_000 - fee)) / 10_000n) / Number(s); };

export default function Predict() {
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const [mi, setMi] = useState(0); const m = MARKETS[mi];
  const [st, setSt] = useState<State | null>(null); const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [amount, setAmount] = useState("1"); const [busy, setBusy] = useState<string | null>(null);
  const [mine, setMine] = useState<{ epoch: number; position: number; amount: string; claimed: boolean }[]>([]); const [claimable, setClaimable] = useState<Record<number, bigint>>({});
  const [hist, setHist] = useState<Hist[]>([]);
  const me = HW.hotAddress();
  const tape = useRef<{ t: number; p: number }[]>([]);

  useEffect(() => {
    let alive = true;
    const pull = () => fetch(`${BOT}/api/predict/state`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (alive) setSt(j); }).catch(() => undefined);
    pull(); const a = setInterval(pull, 1500); const b = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 500);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, []);
  useEffect(() => { tape.current = []; fetch(`${BOT}/api/predict/rounds?market=${encodeURIComponent(m.key)}&n=30`).then((r) => r.json()).then((j) => setHist(j.rounds ?? [])).catch(() => undefined); }, [m.key]);
  const price = st?.prices[m.key]?.price ?? null;
  useEffect(() => { if (price != null) { const a = tape.current; if (!a.length || a[a.length - 1].p !== price) { a.push({ t: now, p: price }); if (a.length > 160) a.shift(); } } }, [price, now]);

  const loadMine = useCallback(async () => {
    if (!me) return;
    try {
      const len = Number(BigInt(await HW.hotCall(m.addr, SEL.userRoundsLength + p32(me)) || "0x0")); if (!len) { setMine([]); setClaimable({}); return; }
      const n = Math.min(40, len); const raw = await HW.hotCall(m.addr, SEL.getUserRounds + p32(me) + pnum(len - n) + pnum(n));
      const w = (raw.slice(2).match(/.{64}/g) ?? []).map((x) => BigInt("0x" + x)); const oE = Number(w[0]) / 32, oB = Number(w[1]) / 32; const nE = Number(w[oE]);
      const epochs = Array.from({ length: nE }, (_, i) => Number(w[oE + 1 + i]));
      const bets = Array.from({ length: Number(w[oB]) }, (_, i) => { const b = oB + 1 + i * 3; return { epoch: epochs[i], position: Number(w[b]), amount: w[b + 1].toString(), claimed: w[b + 2] !== 0n }; }).reverse();
      const cl = await HW.hotCall(m.addr, SEL.claimable + p32(me) + p32("0x40") + pnum(epochs.length) + epochs.map((e) => pnum(e)).join(""));
      const cw = (cl.slice(2).match(/.{64}/g) ?? []).map((x) => BigInt("0x" + x)); const out: Record<number, bigint> = {};
      for (let i = 0; i < Number(cw[1] ?? 0n); i++) if (cw[2 + i] > 0n) out[epochs[i]] = cw[2 + i];
      setMine(bets); setClaimable(out);
    } catch { /* keep last */ }
  }, [me, m.addr]);
  useEffect(() => { loadMine(); const t = setInterval(loadMine, 8000); return () => clearInterval(t); }, [loadMine]);

  const ms = st?.markets[m.key]; const cur = ms?.currentEpoch ?? 0; const live = ms?.rounds[String(cur - 1)]; const next = ms?.rounds[String(cur)]; const fee = ms?.feeBps ?? 300;
  const bet = async (up: boolean) => {
    if (!next || !ms) return;
    if (!me || !HW.isUnlocked()) { toast("Unlock the wallet first", "err"); return; }
    const v = BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 12n;
    if (v < big(ms.minBet)) { toast(`Minimum ${usd(ms.minBet, 0)} USDC`, "err"); return; }
    setBusy(up ? "UP…" : "DOWN…");
    try { const h = await HW.hotSend({ to: m.addr, data: (up ? SEL.betUp : SEL.betDown) + pnum(next.epoch), value: v }); const rc = await HW.hotWait(h); if (rc.status !== 1) throw new Error("reverted"); buzzOk(); toast(`${up ? "UP" : "DOWN"} ${amount} USDC on #${next.epoch}`, "ok"); loadMine(); }
    catch (e) { toast(String((e as Error).message ?? e), "err"); }
    setBusy(null);
  };
  const claimAll = async () => {
    const eps = Object.keys(claimable).map(Number); if (!eps.length) return;
    setBusy("Claiming…");
    try { const h = await HW.hotSend({ to: m.addr, data: SEL.claim + p32("0x20") + pnum(eps.length) + eps.map((e) => pnum(e)).join("") }); const rc = await HW.hotWait(h); if (rc.status !== 1) throw new Error("reverted"); buzzOk(); toast(`Claimed ${usd(eps.reduce((a, e) => a + claimable[e], 0n))} USDC`, "ok"); loadMine(); }
    catch (e) { toast(String((e as Error).message ?? e), "err"); }
    setBusy(null);
  };
  const total = Object.values(claimable).reduce((a, v) => a + v, 0n);
  const stale = ms?.checked ? now - ms.checked > 30 : false;

  return (
    <>
      <Header title="Predict" back />
      <div className="launch" style={{ display: "grid", gap: 10 }}>
        <div className="row" style={{ gap: 6 }}>
          {MARKETS.map((x, i) => <button className={"chip" + (i === mi ? " on" : "")} key={x.key} onClick={() => setMi(i)}>{x.sym} <span className="muted">{st?.prices[x.key]?.price != null ? px(st.prices[x.key].price! * 1e8, x.key) : "…"}</span></button>)}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Up or down in 2 minutes. Winners split the pool minus 3 % (burned into ARCT). Prices: median of 4 exchanges, posted on-chain, auditable. Tie, empty side or a late operator = full refund.</p>
        {stale && <div className="card" style={{ borderColor: "var(--amber, #ffb020)", fontSize: 12 }}>Operator heartbeat is stale — rounds not closed within the buffer are refunded automatically.</div>}
        {!HW.isUnlocked() && <Unlock />}

        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 11 }}>STAKE</span>
          {["1", "5", "20"].map((v) => <button className={"chip" + (amount === v ? " on" : "")} key={v} onClick={() => setAmount(v)}>{v}</button>)}
          <div className="field" style={{ padding: "6px 10px", width: 90 }}><input inputMode="decimal" onChange={(e) => setAmount(e.target.value)} value={amount} /></div>
          <span className="muted" style={{ fontSize: 11 }}>USDC</span>
        </div>

        {live && (
          <div className="card" style={{ borderColor: price != null && price * 1e8 > live.lockPrice ? "var(--up)" : price != null && price * 1e8 < live.lockPrice ? "var(--down)" : "var(--line)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}><b>LIVE #{live.epoch}</b><span className="mono">{cd(live.closeTime - now)}</span></div>
            <Spark pts={tape.current.filter((x) => x.t >= live.lockTime - 5)} lock={live.lockPrice} up={price != null && price * 1e8 >= live.lockPrice} />
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: price != null && price * 1e8 > live.lockPrice ? "var(--up)" : price != null && price * 1e8 < live.lockPrice ? "var(--down)" : undefined }}>{price != null ? px(price * 1e8, m.key) : "…"}</span>
              <span className="muted">locked {px(live.lockPrice, m.key)}</span>
            </div>
            <Pools r={live} fee={fee} />
            {mine.find((b) => b.epoch === live.epoch) && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>You: {mine.find((b) => b.epoch === live.epoch)!.position === 1 ? "UP" : "DOWN"} {usd(mine.find((b) => b.epoch === live.epoch)!.amount, 0)} USDC</div>}
          </div>
        )}
        {next && (
          <div className="card" style={{ borderColor: "var(--up)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}><b>NEXT #{next.epoch}</b><span className="mono">{next.lockTime - now > 0 ? `locks in ${cd(next.lockTime - now)}` : "locking…"}</span></div>
            <Pools r={next} fee={fee} />
            {mine.find((b) => b.epoch === next.epoch) ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>You are in: {mine.find((b) => b.epoch === next.epoch)!.position === 1 ? "UP" : "DOWN"} {usd(mine.find((b) => b.epoch === next.epoch)!.amount, 0)} USDC — one side per wallet per round.</div> : (
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn" disabled={!!busy || next.lockTime - now <= 0} onClick={() => bet(true)} style={{ flex: 1, background: "var(--up)", color: "#04140a" }}>▲ UP {amount}</button>
                <button className="btn" disabled={!!busy || next.lockTime - now <= 0} onClick={() => bet(false)} style={{ flex: 1, background: "var(--down)", color: "#1a0806" }}>▼ DOWN {amount}</button>
              </div>
            )}
          </div>
        )}
        {total > 0n && <button className="btn primary" disabled={!!busy} onClick={claimAll}>{busy ?? `Claim ${usd(total)} USDC`}</button>}

        <div className="card">
          <div className="muted" style={{ fontSize: 11 }}>MY ROUNDS · {m.sym}</div>
          {mine.length === 0 ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{me ? "No bets on this market yet." : "Create or unlock a wallet to play."}</div> : mine.slice(0, 20).map((b) => {
            const r = ms?.rounds[String(b.epoch)] ?? hist.find((h) => h.epoch === b.epoch); const status = r ? ("status" in r ? r.status : 0) : null; const winner = r ? r.winner : null;
            const won = status === 2 && winner === b.position; const lost = status === 2 && winner !== 0 && winner !== b.position; const cl = claimable[b.epoch];
            return <div className="row mono" key={b.epoch} style={{ justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}><span>#{b.epoch} <span style={{ color: b.position === 1 ? "var(--up)" : "var(--down)" }}>{b.position === 1 ? "UP" : "DOWN"}</span> {usd(b.amount, 0)}</span><span style={{ color: won ? "var(--up)" : lost ? "var(--down)" : undefined }} className={won || lost ? "" : "muted"}>{b.claimed ? "claimed" : cl ? `${won ? "won" : "refund"} ${usd(cl)}` : won ? "won" : lost ? "lost" : status === 3 || (status === 2 && winner === 0) ? "refund" : status === 1 ? "live" : "open"}</span></div>;
          })}
        </div>
        <div className="card">
          <div className="muted" style={{ fontSize: 11 }}>RECENT ROUNDS</div>
          {hist.slice(0, 12).map((h) => <div className="row mono" key={h.epoch} style={{ justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}><span className="muted">#{h.epoch}</span><span>{px(Math.round(h.lock_price * 1e8), m.key)} → {px(Math.round(h.close_price * 1e8), m.key)}</span><span style={{ color: h.status === 3 || h.winner === 0 ? undefined : h.winner === 1 ? "var(--up)" : "var(--down)" }} className={h.status === 3 || h.winner === 0 ? "muted" : ""}>{h.status === 3 ? "cancelled" : h.winner === 0 ? (big(h.up_amount) + big(h.down_amount) === 0n ? "no bets" : "tie") : h.winner === 1 ? "UP" : "DOWN"}</span></div>)}
          <button className="chip" onClick={() => openUrl(`${BOT}/api/predict/price?market=${encodeURIComponent(m.key)}`)} style={{ marginTop: 6 }}>Price log (audit)</button>
        </div>
      </div>
    </>
  );
}

function Pools({ r, fee }: { r: Round; fee: number }) {
  const mu = mult(r.upAmount, r.downAmount, "up", fee), md = mult(r.upAmount, r.downAmount, "down", fee); const pool = big(r.upAmount) + big(r.downAmount);
  const upPct = pool > 0n ? Number((big(r.upAmount) * 1000n) / pool) / 10 : 50;
  return (
    <div className="mono" style={{ fontSize: 12, marginTop: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}><span style={{ color: "var(--up)" }}>UP {mu ? `${mu.toFixed(2)}×` : "—"}</span><span className="muted">pool {usd(pool, 2)} USDC</span><span style={{ color: "var(--down)" }}>{md ? `${md.toFixed(2)}×` : "—"} DOWN</span></div>
      <div style={{ background: "var(--line)", borderRadius: 4, height: 5, margin: "5px 0", overflow: "hidden" }}><div style={{ background: "var(--up)", height: "100%", width: `${upPct}%` }} /></div>
    </div>
  );
}
function Spark({ pts, lock, up }: { pts: { t: number; p: number }[]; lock: number; up: boolean }) {
  const W = 320, H = 56; if (pts.length < 2) return <div style={{ height: H }} />;
  const l = lock / 1e8; const vals = pts.map((x) => x.p).concat([l]); const min = Math.min(...vals), max = Math.max(...vals); const span = Math.max(max - min, l * 0.0004);
  const y = (p: number) => H - 4 - ((p - (min + max) / 2 + span / 2) / span) * (H - 8); const x = (i: number) => (i / (pts.length - 1)) * W;
  return <svg height={H} preserveAspectRatio="none" style={{ display: "block", width: "100%" }} viewBox={`0 0 ${W} ${H}`}><line stroke="var(--dim)" strokeDasharray="4 4" x1="0" x2={W} y1={y(l)} y2={y(l)} /><path d={pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ")} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="2" /></svg>;
}
