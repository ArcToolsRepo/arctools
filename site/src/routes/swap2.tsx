import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { DsRail } from "@/components/ds-rail";
import { TokenLogo } from "@/components/token-logo";
import { BOT_API } from "@/lib/bot-api";
import { loadMeta } from "@/lib/token-meta";
import { routeSwap, type RouteResult } from "@/lib/arc-route";
import { hotAddress, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { xAvatar } from "@/lib/arc-api";
import { ARC_AGGREGATOR, connectWallet, encodeAggregatorSwap, ethCall, getStoredWallet, nativeBalance, onWalletChange, p32, pnum, sendTx, tokenBalance, waitReceipt } from "@/lib/arc-wallet";
import { usePrefs } from "@/lib/i18n";
import "../arc-site.css";

export const Route = createFileRoute("/swap2")({
  head: () => ({ meta: [
    { title: "Swap on Arc: every token, one router, 0.5% into ARCT buybacks" },
    { name: "description", content: "Swap any token on Arc. Paste a contract address, see which launchpad it came from, set your own slippage. The router splits across Uniswap V3, V4, launchpad curves and wrapped-stock pairs. 0.5% per swap buys back ARCT." },
  ] }),
  component: SwapPage,
});

/** 0.5% of the USDC side, taken by ArcAggregator and paid to the treasury, which buys ARCT back and burns it. */
const FEE_BPS = 50;
const USDC_DEC = 6;
const SLIP_KEY = "arctools_swap_slippage";
/** USDC mark drawn inline: no network request, and no 404 retry loop from a missing asset. */
const USDC_MARK = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#2775CA"/><text x="16" y="23" font-family="Inter,Arial,sans-serif" font-size="19" font-weight="700" fill="#fff" text-anchor="middle">$</text></svg>');


const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

type Pick = { token: string; symbol: string; name?: string | null; logo?: string | null; pad?: string | null; mcap?: number | null; decimals?: number; twitter?: string | null };

const fmtUsd = (v: number | null | undefined) =>
  v == null ? "" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;

/** Token amounts span 18 orders of magnitude here: 0.0000001 and 412,000,000 must both stay readable. */
function fmtAmt(units: bigint, dec: number, sig = 6): string {
  if (units === 0n) return "0";
  const neg = units < 0n; const u = neg ? -units : units;
  const base = 10n ** BigInt(dec);
  const whole = u / base; const frac = u % base;
  let out: string;
  if (whole > 0n) {
    const keep = Math.max(0, sig - whole.toString().length);
    const fs = frac.toString().padStart(dec, "0").slice(0, keep).replace(/0+$/, "");
    out = whole.toLocaleString("en-US") + (fs ? `.${fs}` : "");
  } else {
    const fs = frac.toString().padStart(dec, "0");
    const lead = fs.length - fs.replace(/^0+/, "").length;
    out = `0.${fs.slice(0, lead + sig).replace(/0+$/, "")}`;
  }
  return neg ? `-${out}` : out;
}

function parseAmt(s: string, dec: number): bigint {
  const m = s.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(m) || m === "" || m === ".") return 0n;
  const [w, f = ""] = m.split(".");
  return BigInt(w || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0");
}

const decCache = new Map<string, number>();
async function decimalsOf(token: string): Promise<number> {
  const k = token.toLowerCase();
  const hit = decCache.get(k);
  if (hit != null) return hit;
  try {
    const r = await ethCall(token, "0x313ce567");
    const d = r && r !== "0x" ? Number(BigInt(r)) : 18;
    const ok = d >= 0 && d <= 36 ? d : 18;
    decCache.set(k, ok);
    return ok;
  } catch { return 18; }
}

function SwapPage() {
  const { t } = usePrefs();
  return (
    <main className="arc-dsp" style={{ minHeight: "100dvh" }}>
      <DsRail />
      <section className="arc-dsp__body" style={{ maxWidth: 1100, paddingTop: 112 }}>
        <p className="arc-eyebrow">SWAP</p>
        <h1 className="arc-h2" style={{ fontSize: 30 }}>{t("Swap anything on Arc")}</h1>
        <p className="arc-body" style={{ maxWidth: 760 }}>
          Paste a contract address or search by name. The router quotes Uniswap V3, Uniswap V4, launchpad curves and
          wrapped-stock pairs, then splits the order across the two best venues when that pays more.
        </p>
        <SwapCard />
      </section>
    </main>
  );
}

/* --------------------------------- the card --------------------------------- */

function SwapCard() {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [pick, setPick] = useState<Pick | null>(null);
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState<number>(() => {
    if (typeof localStorage === "undefined") return 1;
    const v = Number(localStorage.getItem(SLIP_KEY));
    return v > 0 && v <= 50 ? v : 1;
  });
  const [openPicker, setOpenPicker] = useState(false);
  const [quote, setQuote] = useState<RouteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [addr, setAddr] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [balIn, setBalIn] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ tx: string; got: string } | null>(null);
  const [sim, setSim] = useState<{ verdict: string; keep_bps: number; detail?: string } | null>(null);
  const [ack, setAck] = useState(false);              // the buyer explicitly accepted a failed simulation
  const seq = useRef(0);

  useEffect(() => { localStorage.setItem(SLIP_KEY, String(slip)); }, [slip]);
  useEffect(() => {
    setAddr(getStoredWallet());
    setHot(isUnlocked() ? hotAddress() : null);
    const a = onWalletChange((x) => setAddr(x));
    const b = onHotChange(() => setHot(isUnlocked() ? hotAddress() : null));
    return () => { a(); b(); };
  }, []);

  const payer = addr ?? hot;
  const dec = pick?.decimals ?? 18;
  const inDec = side === "buy" ? USDC_DEC : dec;

  // resolve decimals once a token is picked: a 6-dec token priced as 18-dec is off by a million
  useEffect(() => {
    if (!pick || pick.decimals != null) return;
    let alive = true;
    decimalsOf(pick.token).then((d) => { if (alive) setPick((p) => (p && p.token === pick.token ? { ...p, decimals: d } : p)); });
    return () => { alive = false; };
  }, [pick?.token]);

  // balance of whatever the user is spending
  useEffect(() => {
    if (!payer) { setBalIn(null); return; }
    let alive = true;
    (async () => {
      try {
        if (side === "buy") {
          const n = await nativeBalance(payer);                       // USDC is the native coin on Arc (18-dec native, 6-dec facade)
          if (alive) setBalIn(BigInt(Math.floor(n * 1e6)));
        } else if (pick) {
          const b = await tokenBalance(pick.token, payer);
          if (alive) setBalIn(b);
        }
      } catch { if (alive) setBalIn(null); }
    })();
    return () => { alive = false; };
  }, [payer, side, pick?.token, done?.tx]);

  // tradability: replay a 1 USDC buy + immediate sell against live state before the user commits real money
  useEffect(() => {
    setSim(null); setAck(false);
    if (!pick) return;
    let alive = true;
    fetch(`${BOT_API}/api/sim?token=${pick.token}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j?.verdict) setSim(j); })
      .catch(() => { /* no verdict is not a verdict: the card stays neutral */ });
    return () => { alive = false; };
  }, [pick?.token]);

  const amtUnits = useMemo(() => parseAmt(amount, inDec), [amount, inDec]);

  // live quote, debounced; every keystroke cancels the previous answer (stale quotes are worse than none)
  useEffect(() => {
    if (!pick || amtUnits <= 0n) { setQuote(null); return; }
    const my = ++seq.current;
    setQuoting(true);
    const timer = setTimeout(() => {
      // the aggregator quotes the USDC side in 18-dec native units
      const wei = side === "buy" ? amtUnits * 10n ** 12n : amtUnits;
      routeSwap({ data: { token: pick.token, side, amount: wei.toString() } })
        .then((r) => { if (my === seq.current) { setQuote(r); setQuoting(false); } })
        .catch(() => { if (my === seq.current) { setQuote(null); setQuoting(false); } });
    }, 420);
    return () => clearTimeout(timer);
  }, [pick?.token, side, amtUnits]);

  const outUnits = quote && !quote.error ? BigInt(quote.out) : 0n;
  const outDec = side === "buy" ? dec : 18;                            // sell proceeds arrive as 18-dec native USDC
  const feeUnits = (amtUnits * BigInt(FEE_BPS)) / 10_000n;             // buy: on top of the spend; sell: out of the proceeds
  const minOut = outUnits > 0n ? (outUnits * BigInt(Math.round((100 - slip) * 100))) / 10_000n : 0n;
  const rate = pick && outUnits > 0n && amtUnits > 0n
    ? side === "buy"
      ? `1 ${pick.symbol} ≈ ${fmtAmt((amtUnits * 10n ** BigInt(dec)) / outUnits, USDC_DEC, 6)} USDC`
      : `1 ${pick.symbol} ≈ ${fmtAmt((outUnits * 10n ** BigInt(dec)) / amtUnits, 18, 6)} USDC`
    : null;

  const setMax = () => {
    if (balIn == null) return;
    // a buy also has to cover the 0.5% fee, so the max spend is balance / 1.005 (minus a hair of gas)
    const v = side === "buy" ? (balIn * 10_000n) / (10_000n + BigInt(FEE_BPS)) - 20_000n : balIn;
    setAmount(fmtAmt(v > 0n ? v : 0n, inDec, 12));
  };

  const run = async () => {
    setErr(null); setDone(null);
    if (!pick) { setErr("pick a token first"); return; }
    if (amtUnits <= 0n) { setErr("enter an amount"); return; }
    let from = addr ?? hot;
    if (!from) {
      try { from = await connectWallet(); setAddr(from); } catch { setErr("wallet not connected"); return; }
    }
    const useHot = !addr && !!hot;
    const send = async (tx: { to: string; data: string; value?: bigint }) =>
      useHot ? hotSend(tx) : sendTx({ ...tx, from: from! });
    const wait = async (h: string) => (useHot ? hotWait(h) : waitReceipt(h));
    try {
      const legs = (quote?.legs ?? []).map((l) => ({ venue: l.venue, target: l.target, fee: l.fee, key: l.key, amount: l.amount }));
      if (legs.length === 0) { setErr("no route for this token"); return; }
      const mo = quote?.unquoted ? 0n : minOut;
      if (side === "buy") {
        setBusy("confirm the swap in your wallet…");
        const spend = amtUnits * 10n ** 12n;
        const h = await send({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("buy", pick.token, legs, mo, from!, FEE_BPS), value: spend + (spend * BigInt(FEE_BPS)) / 10_000n });
        setBusy("waiting for the block…");
        await wait(h);
        setDone({ got: `${fmtAmt(outUnits, dec, 6)} ${pick.symbol}`, tx: h });
      } else {
        const allowance = await ethCall(pick.token, "0xdd62ed3e" + p32(from!) + p32(ARC_AGGREGATOR)).catch(() => "0x0");
        if (BigInt(allowance || "0x0") < amtUnits) {
          setBusy(`approve ${pick.symbol} first…`);
          const ah = await send({ to: pick.token, data: "0x095ea7b3" + p32(ARC_AGGREGATOR) + pnum((1n << 255n) - 1n) });
          await wait(ah);
        }
        setBusy("confirm the swap in your wallet…");
        const h = await send({ to: ARC_AGGREGATOR, data: encodeAggregatorSwap("sell", pick.token, legs, mo, from!, FEE_BPS) });
        setBusy("waiting for the block…");
        await wait(h);
        setDone({ got: `${fmtAmt(outUnits - (outUnits * BigInt(FEE_BPS)) / 10_000n, 18, 4)} USDC`, tx: h });
      }
      setAmount("");
      setQuote(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e).slice(0, 180));
    } finally { setBusy(null); }
  };

  const payBadge = side === "buy"
    ? <span className="arc-swap__tok"><TokenLogo monogram size={26} src={USDC_MARK} symbol="USDC" /> USDC</span>
    : pick
      ? <button className="arc-swap__tok arc-swap__tok--btn" onClick={() => setOpenPicker(true)} type="button"><TokenLogo monogram size={26} src={pick.logo ?? null} symbol={pick.symbol} /> {pick.symbol} <span style={{ opacity: 0.5 }}>▾</span></button>
      : <button className="arc-swap__tok arc-swap__tok--btn" onClick={() => setOpenPicker(true)} type="button">Select token ▾</button>;
  const getBadge = side === "buy"
    ? (pick
      ? <button className="arc-swap__tok arc-swap__tok--btn" onClick={() => setOpenPicker(true)} type="button"><TokenLogo monogram size={26} src={pick.logo ?? null} symbol={pick.symbol} /> {pick.symbol} <span style={{ opacity: 0.5 }}>▾</span></button>
      : <button className="arc-swap__tok arc-swap__tok--btn arc-swap__tok--empty" onClick={() => setOpenPicker(true)} type="button">Select token ▾</button>)
    : <span className="arc-swap__tok"><TokenLogo monogram size={26} src={USDC_MARK} symbol="USDC" /> USDC</span>;

  return (
    <div className="arc-swap-wrap">
      <div className="arc-swap-glow">
        <div className="arc-swap">
          <div className="arc-swap__head">
            <span className="arc-mono" style={{ fontSize: 12, letterSpacing: 1 }}>SWAP</span>
            <Slippage onChange={setSlip} value={slip} />
          </div>

          <div className="arc-swap__panel">
            <div className="arc-swap__row">
              <span className="arc-mono arc-swap__label">You pay</span>
              {balIn != null && (
                <span className="arc-mono arc-swap__bal">
                  {fmtAmt(balIn, inDec, 6)} <button className="arc-swap__max" onClick={setMax} type="button">MAX</button>
                </span>
              )}
            </div>
            <div className="arc-swap__row">
              <input className="arc-swap__amt" inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0" value={amount} />
              {payBadge}
            </div>
          </div>

          <button className="arc-swap__flip" onClick={() => { setSide((s) => (s === "buy" ? "sell" : "buy")); setAmount(""); setQuote(null); }} title="Flip direction" type="button">↓</button>

          <div className="arc-swap__panel">
            <div className="arc-swap__row">
              <span className="arc-mono arc-swap__label">You receive</span>
              {pick?.pad && <span className="arc-swap__pad" title="Launchpad this token came from">{pick.pad}</span>}
            </div>
            <div className="arc-swap__row">
              <span className="arc-swap__amt arc-swap__amt--out">{quoting ? "…" : outUnits > 0n ? fmtAmt(side === "buy" ? outUnits : outUnits - (outUnits * BigInt(FEE_BPS)) / 10_000n, outDec, 7) : "0"}</span>
              {getBadge}
            </div>
          </div>

          {pick && (
            <div className="arc-swap__facts">
              {rate && <Row k="Rate" v={rate} />}
              <Row k={`Fee (${FEE_BPS / 100}%)`} v={`${fmtAmt(feeUnits, inDec, 6)} ${side === "buy" ? "USDC" : pick.symbol} → ARCT buyback`} />
              {outUnits > 0n && <Row k={`Min received (${slip}% slippage)`} v={`${fmtAmt(minOut, outDec, 6)} ${side === "buy" ? pick.symbol : "USDC"}`} />}
              {quote?.legs?.length ? <Row k={quote.split ? "Route (split)" : "Route"} v={quote.legs.map((l) => l.label).join("  +  ")} /> : null}
              {quote?.unquoted && <Row k="Route" v="pool found, no quote — goes in at market" warn />}
              {quote?.error && <Row k="Route" v={quote.error} warn />}
              {sim && sim.verdict !== "error" && (
                <Row
                  k="Sell simulation"
                  v={sim.verdict === "ok" ? `passed · ${(sim.keep_bps / 100).toFixed(0)}% round trip`
                    : sim.verdict === "thin" ? `thin pool · 1 USDC round trip returns ${(sim.keep_bps / 100).toFixed(0)}%`
                    : sim.verdict === "no_route" ? "no pool reachable yet"
                    : `FAILED · ${sim.detail ?? "cannot sell"}`}
                  warn={sim.verdict === "trap"}
                />
              )}
            </div>
          )}

          {sim?.verdict === "trap" && (
            <label className="arc-swap__danger">
              <span>
                <strong>This token failed the sell test.</strong> We bought 1 USDC of it and tried to sell it back in
                the same call: {sim.detail}. The router quoted a real price for that sale and the token did not honour
                it — a blocked exit or a hidden tax. Thin liquidity is reported separately and is not this.
              </span>
              <span className="arc-swap__ackline">
                <input checked={ack} onChange={(e) => setAck(e.target.checked)} type="checkbox" />
                I understand and want to buy anyway
              </span>
            </label>
          )}

          {err && <p className="arc-swap__err">{err}</p>}
          {done && (
            <p className="arc-swap__ok">
              Swapped — got {done.got}. <a href={`https://arc-scan.org/tx/${done.tx}`} rel="noreferrer" target="_blank">receipt</a>
            </p>
          )}

          <button className={"arc-swap__go" + (sim?.verdict === "trap" ? " arc-swap__go--danger" : "")} disabled={!!busy || !pick || amtUnits <= 0n || (sim?.verdict === "trap" && side === "buy" && !ack)} onClick={run} type="button">
            {busy ?? (!payer ? "Connect wallet" : !pick ? "Select a token" : amtUnits <= 0n ? "Enter an amount"
              : sim?.verdict === "trap" && side === "buy" && !ack ? "Sell test failed — tick the box to continue"
              : side === "buy" ? `Buy ${pick.symbol}` : `Sell ${pick.symbol}`)}
          </button>
        </div>
      </div>

      <BuybackNote />
      {openPicker && <TokenPicker onClose={() => setOpenPicker(false)} onPick={(p) => { setPick(p); setOpenPicker(false); setQuote(null); }} />}
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="arc-swap__fact">
      <span>{k}</span>
      <span className="arc-mono" style={{ color: warn ? "var(--arc-down)" : "var(--arc-ink)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

function Slippage({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [custom, setCustom] = useState("");
  const preset = [0.5, 1, 5];
  return (
    <span className="arc-swap__slip">
      <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>SLIPPAGE</span>
      {preset.map((p) => (
        <button className={"arc-swap__slipbtn" + (value === p && custom === "" ? " is-on" : "")} key={p} onClick={() => { setCustom(""); onChange(p); }} type="button">{p}%</button>
      ))}
      <input
        className="arc-swap__slipin"
        inputMode="decimal"
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          setCustom(v);
          const n = Number(v);
          if (n > 0 && n <= 50) onChange(n);
        }}
        placeholder="custom"
        value={custom}
      />
    </span>
  );
}

/* ------------------------------- token picker ------------------------------- */

function TokenPicker({ onPick, onClose }: { onPick: (p: Pick) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Pick[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback((query: string) => {
    const my = ++seq.current;
    setBusy(true);
    const url = query.trim().length >= 2
      ? `/api/search?q=${encodeURIComponent(query.trim())}`
      : `${BOT_API}/api/trending?minutes=1440&limit=40`;
    fetch(url)
      .then((r) => r.json())
      .then((j: { rows?: Array<Record<string, unknown>> }) => {
        if (my !== seq.current) return;
        const out = (j.rows ?? []).map((r) => ({
          logo: (r.logo as string) ?? null,
          mcap: (r.mcap as number) ?? (r.mcapUsd as number) ?? null,
          name: (r.name as string) ?? null,
          pad: (r.pad as string) ?? (r.launchpad as string) ?? null,
          symbol: (r.symbol as string) || short(String(r.token)),
          token: String(r.token).toLowerCase(),
        })).filter((r) => isAddr(r.token));
        setRows(out);
        setBusy(false);
        // the trending feed carries symbol + volume only; artwork, name and launchpad live in the meta index,
        // so ask for them in one batch (40 addresses stay far under the 8 KB request-line limit)
        const want = out.slice(0, 40).map((r) => r.token);
        if (want.length) {
          void loadMeta(want).then((meta) => {
            if (my !== seq.current) return;
            setRows((cur) => (cur ?? []).map((r) => {
              const m = meta[r.token];
              return m ? { ...r, logo: r.logo ?? m.logo ?? null, name: r.name ?? m.name ?? null, pad: r.pad ?? m.launchpad_label ?? m.launchpad ?? null, twitter: m.twitter ?? null } : r;
            }));
          });
        }
      })
      .catch(() => { if (my === seq.current) { setRows([]); setBusy(false); } });
  }, []);

  useEffect(() => { const t = setTimeout(() => load(q), q ? 320 : 0); return () => clearTimeout(t); }, [q, load]);
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);

  // a contract address nobody indexed is still swappable: offer it straight from the input
  const raw = q.trim().toLowerCase();
  const unknown = isAddr(raw) && !(rows ?? []).some((r) => r.token === raw);

  return (
    <div className="arc-swap__modal" onClick={onClose} role="presentation">
      <div className="arc-swap__sheet" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="arc-swap__sheethead">
          <strong>Select a token</strong>
          <button className="arc-swap__x" onClick={onClose} type="button">✕</button>
        </div>
        <input autoFocus className="arc-swap__search" onChange={(e) => setQ(e.target.value)} placeholder="Search name, symbol or paste a contract address" value={q} />
        <div className="arc-swap__list">
          {unknown && (
            <button className="arc-swap__hit" onClick={() => onPick({ logo: null, pad: null, symbol: short(raw), token: raw })} type="button">
              <TokenLogo monogram size={30} src={null} symbol="?" />
              <span className="arc-swap__hitmain"><strong>{short(raw)}</strong><span className="arc-swap__hitsub">not indexed — the router will look for its pool</span></span>
            </button>
          )}
          {busy && !rows && <p className="arc-swap__hint">searching…</p>}
          {rows?.length === 0 && !unknown && <p className="arc-swap__hint">nothing found</p>}
          {(rows ?? []).map((r) => (
            <button className="arc-swap__hit" key={r.token} onClick={() => onPick(r)} type="button">
              <TokenLogo fallback={xAvatar(r.twitter)} monogram size={30} src={r.logo ?? null} symbol={r.symbol} />
              <span className="arc-swap__hitmain">
                <strong>{r.symbol}</strong>
                <span className="arc-swap__hitsub">{r.name || short(r.token)}</span>
              </span>
              <span className="arc-swap__hitright">
                {r.pad && <span className="arc-swap__pad">{r.pad}</span>}
                {r.mcap ? <span className="arc-mono arc-swap__hitmc">{fmtUsd(r.mcap)}</span> : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- buyback note ------------------------------- */

function BuybackNote() {
  const [st, setSt] = useState<{ bought: number; burned: number; usdc: number; last: number | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => fetch(`${BOT_API}/api/buyback-stats`).then((r) => r.json()).then((j) => {
      if (alive && j && typeof j.burned === "number") setSt({ bought: j.bought ?? 0, burned: j.burned, last: j.last_ts ?? null, usdc: j.usdc_spent ?? 0 });
    }).catch(() => { /* counter is decoration; the fee text below is the contract truth */ });
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return (
    <div className="arc-swap__note">
      <p>
        <strong>0.5% per swap, in USDC.</strong> The fee goes to the treasury and is spent buying ARCT on the open
        market; every token bought is sent to the burn address. Nothing is minted, nothing is promised — the counter
        below only moves when a buyback transaction lands.
      </p>
      {st && (
        <p className="arc-mono arc-swap__notestats">
          {st.burned.toLocaleString("en-US", { maximumFractionDigits: 0 })} ARCT bought back and burned
          {st.usdc > 0 ? ` · ${st.usdc.toFixed(2)} USDC spent` : ""}
          {st.last ? ` · last ${new Date(st.last * 1000).toLocaleString()}` : ""}
        </p>
      )}
      <p className="arc-mono arc-swap__notefine">
        Router <a href={`https://arc-scan.org/address/${ARC_AGGREGATOR}`} rel="noreferrer" target="_blank">{short(ARC_AGGREGATOR)}</a> · fee is taken by the contract on the USDC side, not by this page
      </p>
    </div>
  );
}
