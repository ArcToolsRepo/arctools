/** The pages that used to open the website. Everything here signs with the app wallet and stays inside the app. */
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import * as HW from "../lib/arc-hotwallet";
import { FN3, PAD_V3, encodeCreateTokenV3, p32, waitReceipt } from "../lib/arc-wallet";
import * as CL from "../lib/arc-claim";
import { claimRef } from "../lib/arc-ref";
import { api, streamUrl, type Trade } from "../lib/api";
import { usd, num, ago, short, isAddr, pct } from "../lib/fmt";
import { go } from "../lib/router";
import { getToken, getHot, getTrend, toast, useStore, getPrefs } from "../lib/store";
import { Header, Icon, Logo, Sheet } from "../components/ui";
import { Unlock } from "./Wallet";
import { buzzOk } from "../lib/native";

const need = (v: boolean, msg: string) => { if (!v) throw new Error(msg); };
const FIREHOSE = "https://bot-production-4200.up.railway.app/api/stream";   // every swap >= $5, chain-wide
const hexStr = (r: string | null | undefined) => (r && r !== "0x" ? BigInt(r) : 0n);

// ====================================================================== LAUNCH
export function Launch() {
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const [mode, setMode] = useState<"curve" | "instant">("curve");
  const [f, setF] = useState({ name: "", symbol: "", website: "", twitter: "", telegram: "", target: "5000", seed: "50", marketing: "0", rewards: "0", burn: "0" });
  const [fee, setFee] = useState<number | null>(null); const [minTarget, setMinTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [done, setDone] = useState<{ tx: string; token?: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  useEffect(() => {
    HW.hotCall(PAD_V3, FN3.instantFee).then((r) => setFee(Number(hexStr(r) / 10n ** 12n) / 1e6)).catch(() => setFee(30));
    HW.hotCall(PAD_V3, FN3.minTarget).then((r) => setMinTarget(Number(hexStr(r) / 10n ** 12n) / 1e6)).catch(() => setMinTarget(null));
  }, []);
  const launch = async () => {
    setBusy("Preparing…");
    try {
      need(f.name.trim().length >= 2 && f.symbol.trim().length >= 2, "Name and symbol: at least 2 characters");
      need(/^[A-Za-z0-9]{2,12}$/.test(f.symbol.trim()), "Symbol: letters and digits only, max 12");
      const from = HW.hotAddress()!;
      const bps = (s: string) => Math.max(0, Math.min(1000, Math.round(Number(s || 0) * 100)));
      const tgt = BigInt(Math.round(Number(mode === "curve" ? f.target : f.seed) * 1e6)) * 10n ** 12n;
      if (mode === "curve" && minTarget != null) need(Number(f.target) >= minTarget, `Graduation target: at least ${minTarget} USDC`);
      const data = encodeCreateTokenV3({
        name: f.name.trim(), symbol: f.symbol.trim().toUpperCase(), marketingBps: bps(f.marketing), rewardsBps: bps(f.rewards), burnBps: bps(f.burn),
        marketingWallet: from, website: f.website.trim(), twitter: f.twitter.trim().replace(/^@/, ""), telegram: f.telegram.trim().replace(/^@/, ""),
        rewardToken: "0x0000000000000000000000000000000000000000", quoteToken: "0x0000000000000000000000000000000000000000",
        mode: mode === "instant" ? 1 : 0, targetQuote: tgt,
      });
      const value = mode === "instant" ? BigInt(Math.round((fee ?? 30) * 1e6)) * 10n ** 12n + tgt : 0n;
      const bal = await HW.hotBalance(from);
      need(BigInt(Math.round(bal * 1e6)) * 10n ** 12n > value + 10n ** 17n, `Need ${(Number(value) / 1e18 + 0.1).toFixed(2)} USDC in the wallet (have ${bal.toFixed(2)})`);
      setBusy("Launching…");
      const h = await HW.hotSend({ to: PAD_V3, data, value, gasLimit: 3_500_000n });   // encodeCreateTokenV3 returns full calldata
      setBusy("Waiting for the block…");
      const rc = await HW.hotWait(h);
      need(rc.status === 1, "The launch transaction reverted");
      buzzOk(); setDone({ tx: h }); toast(`${f.symbol.toUpperCase()} is live`, "ok", h);
    } catch (e) { toast(String((e as Error).message || e).slice(0, 160), "err"); } finally { setBusy(null); }
  };
  if (!HW.hasWallet()) return <><Header title="Launch a token" back /><div className="empty">Create a wallet first.</div></>;
  if (!HW.isUnlocked()) return <><Header title="Launch a token" back /><Unlock /></>;
  if (done) return <><Header title="Launched" back /><div className="card" style={{ textAlign: "center", padding: 24 }}><div className="icon-btn" style={{ width: 64, height: 64, borderRadius: 20, margin: "0 auto 12px", background: "rgba(34,197,94,0.15)", color: "var(--up)" }}><Icon.check className="" /></div><b style={{ fontSize: 20 }}>{f.symbol.toUpperCase()} is on Arc</b><p className="muted" style={{ fontSize: 13.5 }}>It shows up in Trending under the ArcToolsPad chip within a minute.</p><button className="btn primary" onClick={() => go("/?pad=ArcToolsPad")}>Open Trending</button></div></>;
  return (
    <>
      <Header title="Launch a token" back />
      <div className="seg" style={{ paddingTop: 0 }}>
        <button className={`chip ${mode === "curve" ? "on" : ""}`} onClick={() => setMode("curve")}>Bonding curve · free</button>
        <button className={`chip ${mode === "instant" ? "on" : ""}`} onClick={() => setMode("instant")}>Instant Uniswap · {fee ?? "…"} USDC</button>
      </div>
      <div className="card" style={{ padding: 12 }}>
        <div className="grid2"><div className="field"><input placeholder="Name" value={f.name} onChange={set("name")} maxLength={32} /></div><div className="field"><input placeholder="SYMBOL" value={f.symbol} onChange={set("symbol")} maxLength={12} autoCapitalize="characters" /></div></div>
        <div style={{ height: 8 }} />
        <div className="field"><Icon.external className="" /><input placeholder="website (optional)" value={f.website} onChange={set("website")} autoCapitalize="none" /></div><div style={{ height: 8 }} />
        <div className="grid2"><div className="field"><span className="muted">𝕏</span><input placeholder="handle" value={f.twitter} onChange={set("twitter")} autoCapitalize="none" /></div><div className="field"><Icon.send className="" /><input placeholder="telegram" value={f.telegram} onChange={set("telegram")} autoCapitalize="none" /></div></div>
      </div>
      <div className="label">{mode === "curve" ? "Graduation target" : "Initial liquidity"}</div>
      <div className="card" style={{ padding: 12 }}>
        {mode === "curve"
          ? <><div className="field"><span className="muted">USDC</span><input inputMode="decimal" value={f.target} onChange={set("target")} /></div><p className="muted" style={{ fontSize: 12.5, margin: "8px 2px 0" }}>Buyers trade on a curve until this much USDC is raised; then liquidity moves to Uniswap automatically. {minTarget != null && `Minimum ${minTarget} USDC.`} No upfront cost.</p></>
          : <><div className="field"><span className="muted">USDC</span><input inputMode="decimal" value={f.seed} onChange={set("seed")} /></div><p className="muted" style={{ fontSize: 12.5, margin: "8px 2px 0" }}>Seeds a Uniswap pool right away. You pay the seed + the {fee ?? "…"} USDC launch fee.</p></>}
      </div>
      <div className="label">Taxes on trades (optional, %)</div>
      <div className="card" style={{ padding: 12 }}><div className="presets" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="field" style={{ padding: "8px 10px" }}><small className="muted">marketing</small><input inputMode="decimal" value={f.marketing} onChange={set("marketing")} style={{ textAlign: "right" }} /></div>
        <div className="field" style={{ padding: "8px 10px" }}><small className="muted">rewards</small><input inputMode="decimal" value={f.rewards} onChange={set("rewards")} style={{ textAlign: "right" }} /></div>
        <div className="field" style={{ padding: "8px 10px" }}><small className="muted">burn</small><input inputMode="decimal" value={f.burn} onChange={set("burn")} style={{ textAlign: "right" }} /></div>
      </div><p className="muted" style={{ fontSize: 12, margin: "8px 2px 0" }}>Marketing goes to your wallet ({short(HW.hotAddress(), 4)}). 0 / 0 / 0 = a clean token.</p></div>
      <div style={{ padding: "8px 14px 20px" }}><button className="btn primary" disabled={!!busy} onClick={launch}>{busy ?? (mode === "curve" ? `Launch ${f.symbol.toUpperCase() || "token"} on the curve` : `Launch instantly · ${((fee ?? 30) + Number(f.seed || 0)).toFixed(0)} USDC`)}</button></div>
    </>
  );
}

// ====================================================================== PAY LINKS
export function Pay() {
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const addr = HW.hotAddress();
  const [amt, setAmt] = useState(""); const [busy, setBusy] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; amount: number } | null>(null); const [qr, setQr] = useState("");
  const [links, setLinks] = useState<Awaited<ReturnType<typeof CL.linksBySender>> | null>(null);
  const [claimCode, setClaimCode] = useState(""); const [claimOpen, setClaimOpen] = useState(false);
  const reload = useCallback(() => { if (addr) CL.linksBySender(addr).then(setLinks).catch(() => setLinks([])); }, [addr]);
  useEffect(reload, [reload]);
  useEffect(() => { if (made) QRCode.toDataURL(made.url, { margin: 1, width: 220 }).then(setQr); }, [made]);
  const create = async () => {
    const a = Number(amt);
    setBusy("Creating…");
    try {
      need(a >= CL.MIN_USDC, `Minimum ${CL.MIN_USDC} USDC`);
      const bal = await HW.hotBalance(addr!); need(a + 0.05 < bal, `Need ${(a + 0.05).toFixed(2)} USDC (have ${bal.toFixed(2)})`);
      const { key, address: claimKey } = CL.newKey();
      const ttl = 7 * 86400;                                       // a week to collect, then it refunds itself
      const h = await HW.hotSend({ to: CL.CLAIM, data: CL.encodeCreate(claimKey, ttl), value: CL.toWei(a), gasLimit: 300_000n });
      setBusy("Waiting for the block…");
      const rc = await waitReceipt(h); need(!!rc && Number(rc.status) === 1, "Transaction reverted");
      const id = CL.idFromLogs(rc!.logs as { address: string; topics: string[] }[]); need(id != null, "Link id not found in the receipt");
      CL.rememberKey(id!, key);
      const url = `https://arctools.fun/pay#${CL.encodeCode(id!, key)}`;
      buzzOk(); setMade({ url, amount: a }); setAmt(""); reload(); toast(`Link #${id} for ${a} USDC created`, "ok", h);
    } catch (e) { toast(String((e as Error).message || e).slice(0, 160), "err"); } finally { setBusy(null); }
  };
  const claim = async () => {
    setBusy("Claiming…");
    try {
      const raw = claimCode.trim().replace(/^.*#/, "").replace("_", ".");
      const c = CL.decodeCode(raw); need(!!c, "That is not a valid pay link or code");
      const sig = await CL.signClaim(c!.key, c!.id, addr!);
      const r = await CL.submitClaim(c!.id, addr!, sig);
      need(!!(r as { ok?: boolean }).ok, String((r as { error?: string }).error ?? "Claim failed"));
      buzzOk(); toast(`Claimed link #${c!.id} to your wallet`, "ok", (r as { tx?: string }).tx); setClaimOpen(false); setClaimCode("");
    } catch (e) { toast(String((e as Error).message || e).slice(0, 160), "err"); } finally { setBusy(null); }
  };
  if (!HW.hasWallet()) return <><Header title="Pay links" back /><div className="empty">Create a wallet first.</div></>;
  return (
    <>
      <Header title="Pay links" back right={<button className="icon-btn" onClick={() => setClaimOpen(true)} title="Claim a link"><Icon.gift className="" /></button>} />
      {!HW.isUnlocked() ? <Unlock /> : (
        <>
          <div className="card" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Lock USDC behind a link. Whoever opens it claims to any wallet — no app needed on their side. 2% fee, unclaimed links can be taken back.</div>
            <div className="field"><span className="muted">USDC</span><input inputMode="decimal" placeholder="10.00" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
            <div className="presets" style={{ marginTop: 8 }}>{[1, 5, 10, 50].map((p) => <button key={p} onClick={() => setAmt(String(p))}>{p}</button>)}</div>
            <div style={{ height: 10 }} /><button className="btn primary" disabled={!!busy || !(Number(amt) > 0)} onClick={create}>{busy ?? "Create pay link"}</button>
          </div>
          {made && (
            <div className="card" style={{ textAlign: "center", borderLeft: "3px solid var(--up)" }}>
              <b>{made.amount} USDC · ready to share</b>
              {qr && <img alt="" src={qr} style={{ width: 180, height: 180, borderRadius: 10, background: "#fff", padding: 6, display: "block", margin: "10px auto" }} />}
              <div className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{made.url}</div>
              <div className="grid2" style={{ marginTop: 10 }}><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(made.url); toast("Link copied", "ok"); }}>Copy</button><button className="btn ghost sm" onClick={() => (navigator as { share?: (d: { url: string; text: string }) => Promise<void> }).share?.({ url: made.url, text: `${made.amount} USDC for you on Arc` }).catch(() => undefined)}>Share</button></div>
            </div>
          )}
          <div className="list-h"><span>Your links</span><button className="muted" onClick={reload}><Icon.refresh className="" style={{ width: 14 }} /></button></div>
          {links == null ? <div className="empty">Loading…</div> : links.length === 0 ? <div className="empty">No links yet.</div> : links.map((l, i) => {
            const st = l.status === "open" && l.expired ? "expired · refund pending" : l.status;
            return (
              <div key={i} className="trade-row" style={{ gridTemplateColumns: "1fr auto" }}>
                <div><b className="num">{usd(Number(l.amount), 2)}</b><span className="muted" style={{ fontSize: 11.5, marginLeft: 8 }}>#{l.id} · {l.expiry ? `${l.expired ? "expired" : "expires"} ${ago(l.expiry)}` : ""}</span></div>
                <span className={`pill ${l.status === "claimed" ? "green" : l.status === "refunded" ? "" : l.expired ? "amber" : "green"}`}>{st}</span>
              </div>
            );
          })}
        </>
      )}
      <Sheet open={claimOpen} onClose={() => setClaimOpen(false)} title="Claim a pay link">
        <div className="field"><Icon.link className="" /><input placeholder="paste the link or the code" value={claimCode} onChange={(e) => setClaimCode(e.target.value)} autoCapitalize="none" /></div>
        <div style={{ height: 10 }} /><button className="btn primary" disabled={!!busy || !claimCode} onClick={claim}>{busy ?? `Claim to ${short(addr, 4)}`}</button>
      </Sheet>
    </>
  );
}

// ====================================================================== REFERRALS
export function Referrals() {
  const addr = HW.hotAddress();
  const [code, setCode] = useState<string | null>(null); const [stats, setStats] = useState<{ earned?: number; claimable?: number; invited?: number; paid?: number } | null>(null);
  const [qr, setQr] = useState(""); const [busy, setBusy] = useState(false);
  const link = code ? `https://arctools.fun/?ref=${code}` : "";
  const load = useCallback(() => {
    if (!addr) return;
    fetch(`https://bot-production-4200.up.railway.app/api/ref/code?wallet=${addr.toLowerCase()}`).then((r) => r.json()).then((j) => setCode(j.code ?? addr)).catch(() => setCode(addr));
    fetch(`https://bot-production-4200.up.railway.app/api/ref/stats?wallet=${addr.toLowerCase()}`).then((r) => r.json()).then(setStats).catch(() => setStats({}));
  }, [addr]);
  useEffect(load, [load]);
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 200 }).then(setQr); }, [link]);
  const claim = async () => {
    setBusy(true);
    try { const r = await claimRef(addr!, (m) => HW.hotSignMessage(m)); if (r.ok) { buzzOk(); toast(`Paid ${usd(r.usd ?? 0, 2)} USDC`, "ok", r.tx); load(); } else toast(String((r as { error?: string }).error ?? "Nothing to claim yet"), "info"); }
    catch (e) { toast(String((e as Error).message).slice(0, 140), "err"); } finally { setBusy(false); }
  };
  return (
    <>
      <Header title="Referrals" back />
      <div className="tiles" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="tile"><small>Invited</small><b>{stats?.invited ?? "—"}</b></div>
        <div className="tile"><small>Earned</small><b className="up">{stats ? usd(stats.earned ?? 0, 2) : "…"}</b></div>
        <div className="tile"><small>Claimable</small><b className="amber">{stats ? usd(stats.claimable ?? 0, 2) : "…"}</b></div>
      </div>
      {!addr ? <div className="empty">Create a wallet first.</div> : (
        <>
          <div className="card" style={{ textAlign: "center" }}>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>25% of every fee your invites generate — sniper, swap, launchpad, bridge. Paid in USDC to this wallet.</div>
            {qr && <img alt="" src={qr} style={{ width: 150, height: 150, borderRadius: 10, background: "#fff", padding: 6 }} />}
            <div className="mono" style={{ fontSize: 12, wordBreak: "break-all", margin: "10px 0" }}>{link || "…"}</div>
            <div className="grid2"><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(link); toast("Link copied", "ok"); }}>Copy</button><button className="btn ghost sm" onClick={() => (navigator as { share?: (d: { url: string; text: string }) => Promise<void> }).share?.({ url: link, text: "Trade every Arc launchpad in one tap" }).catch(() => undefined)}>Share</button></div>
          </div>
          <div style={{ padding: "0 14px" }}>{!HW.isUnlocked() ? <Unlock /> : <button className="btn primary" disabled={busy || !(stats?.claimable ?? 0)} onClick={claim}>{busy ? "…" : `Claim ${usd(stats?.claimable ?? 0, 2)} USDC`}</button>}</div>
        </>
      )}
    </>
  );
}

// ====================================================================== BRIDGE
const SOURCES = [
  { k: "base", label: "Base", domain: 6, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rpc: "https://mainnet.base.org", explorer: "https://basescan.org/tx/" },
  { k: "arb", label: "Arbitrum", domain: 3, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io/tx/" },
  { k: "eth", label: "Ethereum", domain: 0, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", rpc: "https://eth.llamarpc.com", explorer: "https://etherscan.io/tx/" },
] as const;
export function Bridge() {
  const addr = HW.hotAddress();
  const [src, setSrc] = useState<(typeof SOURCES)[number]>(SOURCES[0]);
  const [bal, setBal] = useState<number | null>(null); const [tx, setTx] = useState(""); const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!addr) return; setBal(null);
    // the same key = the same address on every EVM chain: show what this wallet holds on the source chain
    fetch(src.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: src.usdc, data: "0x70a08231" + p32(addr) }, "latest"] }) })
      .then((r) => r.json()).then((j) => setBal(Number(BigInt(j.result || "0x0")) / 1e6)).catch(() => setBal(null));
  }, [addr, src]);
  const track = async () => {
    setStatus("checking…");
    try {
      const r = await fetch(`https://iris-api.circle.com/v2/messages/${src.domain}?transactionHash=${tx.trim()}`).then((x) => x.json());
      const m = (r.messages ?? [])[0]; setStatus(m ? `${m.status}${m.status === "complete" ? " — minted on Arc" : m.status === "pending_confirmations" ? " — waiting for source finality (~15 min)" : ""}` : "not found yet — give it a minute");
    } catch { setStatus("Circle API unreachable"); }
  };
  return (
    <>
      <Header title="Bridge to Arc" back />
      <div className="seg" style={{ paddingTop: 0 }}>{SOURCES.map((s) => <button key={s.k} className={`chip ${src.k === s.k ? "on" : ""}`} onClick={() => setSrc(s)}>{s.label}</button>)}</div>
      <div className="card">
        <div className="kv" style={{ borderTop: 0 }}><span>Your USDC on {src.label}</span><b className="num">{bal == null ? "…" : bal.toFixed(2)}</b></div>
        <div className="kv"><span>Your Arc address</span><button className="mono" style={{ fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText(addr ?? ""); toast("Copied", "ok"); }}>{short(addr, 6)} <Icon.copy className="" style={{ width: 12 }} /></button></div>
        <div className="kv"><span>Fee</span><b>2% → ARCT buyback</b></div>
      </div>
      <div className="card" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
        <b>How it works (Circle CCTP v2)</b>
        <ol style={{ margin: "6px 0 0", paddingLeft: 18 }} className="muted">
          <li>Same key, same address: your app wallet <span className="mono">{short(addr, 4)}</span> already exists on {src.label}. Send USDC there from any exchange or wallet.</li>
          <li>Burning on {src.label} needs gas in ETH there. Until the app signs on other chains (next update), do the burn from arctools.fun/bridge with any wallet that holds that address — or from the exchange withdrawal directly to Arc if it supports it.</li>
          <li>Paste the source transaction hash below to follow the mint on Arc. Funds land at the same address, no claim step.</li>
        </ol>
      </div>
      <div className="card" style={{ padding: 12 }}>
        <div className="field"><Icon.search className="" /><input placeholder={`${src.label} tx hash 0x…`} value={tx} onChange={(e) => setTx(e.target.value.trim())} autoCapitalize="none" /></div>
        <div style={{ height: 8 }} /><button className="btn ghost sm" disabled={!/^0x[0-9a-fA-F]{64}$/.test(tx)} onClick={track}>Track</button>
        {status && <div className="kv" style={{ marginTop: 6 }}><span>Status</span><b className={status.startsWith("complete") ? "up" : "amber"}>{status}</b></div>}
      </div>
    </>
  );
}

// ====================================================================== LIVE TRADES (chain-wide)
export function Trades() {
  const [rows, setRows] = useState<(Trade & { token: string; symbol?: string | null })[]>([]);
  const [min, setMin] = useState(0); const [live, setLive] = useState(false);
  useEffect(() => {
    let es: EventSource | null = null; let closed = false; let backoff = 1000; let lastBeat = Date.now();
    const push = (x: Trade & { token: string; symbol?: string | null }) => { if (!(x.usdc > 0)) return; setRows((p) => (p.some((q) => q.tx === x.tx && q.ts === x.ts && q.usdc === x.usdc) ? p : [x, ...p].slice(0, 200))); };
    const open = () => {
      if (closed) return; es = new EventSource(FIREHOSE); const beat = () => { lastBeat = Date.now(); setLive(true); };
      es.addEventListener("hello", beat); es.addEventListener("hb", beat);
      es.addEventListener("trade", (e) => { beat(); try { push(JSON.parse((e as MessageEvent).data)); } catch { /* */ } });
      es.addEventListener("trades", (e) => { beat(); try { for (const x of JSON.parse((e as MessageEvent).data)) push(x); } catch { /* */ } });
      es.onerror = () => { setLive(false); es?.close(); es = null; if (!closed) setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15_000); };
    };
    open();
    const pulse = setInterval(() => { if (Date.now() - lastBeat > 40_000) { es?.close(); es = null; if (!closed) open(); } }, 5000);
    return () => { closed = true; es?.close(); clearInterval(pulse); };
  }, []);
  const shown = rows.filter((r) => r.usdc >= min);
  return (
    <>
      <Header title="Live trades" right={<span className="pill" style={{ color: live ? "var(--up)" : "var(--dim)" }}>● {live ? "live" : "…"}</span>} />
      <div className="seg" style={{ paddingTop: 0 }}>{[0, 50, 250, 1000].map((m) => <button key={m} className={`chip ${min === m ? "on" : ""}`} onClick={() => setMin(m)}>{m ? `≥ $${m}` : "all"}</button>)}</div>
      {shown.length === 0 ? <div className="empty">{live ? "Waiting for the next swap…" : "Connecting…"}</div> : shown.slice(0, 120).map((x) => (
        <div key={x.tx + x.ts + x.usdc} className="trade-row" style={{ gridTemplateColumns: "36px 1fr auto auto" }} onClick={() => go(`/token/${x.token}`)}>
          <Logo ca={x.token} size={32} />
          <div><b className={x.side === "buy" ? "up" : "down"} style={{ fontSize: 12 }}>{x.side.toUpperCase()}</b> <b>{x.symbol || getToken(x.token)?.symbol || short(x.token)}</b><div className="muted num" style={{ fontSize: 11.5 }}>{short(x.wallet, 3)} · {x.venue ?? ""} · {ago(x.ts)}</div></div>
          <b className="num" style={{ fontSize: x.usdc >= 1000 ? 16 : 14 }}>{usd(x.usdc, 2)}</b>
          <span className="muted num" style={{ fontSize: 11 }}>{num(x.tokens)}</span>
        </div>
      ))}
    </>
  );
}

// ====================================================================== TRADERS (leaderboard, like the site's /leaderboard + /insiders)
type Row = { wallet: string; pnl_total: number; pnl_pct?: number; winrate: number | null; trades: number; volume: number; best_symbol?: string | null; best_pnl?: number; last_trade: number; handle?: string | null; display?: string | null; avatar?: string | null };
export function Traders() {
  const [range, setRange] = useState<"7d" | "30d">("30d");
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { setRows(null); fetch(`https://arctools.fun/bot/api/insiders?limit=100&range=${range}`).then((r) => r.json()).then((j) => setRows(j.rows ?? [])).catch(() => setRows([])); }, [range]);
  return (
    <>
      <Header title="Top traders" right={<div style={{ display: "flex", gap: 6 }}>{(["7d", "30d"] as const).map((r) => <button key={r} className={`chip ${range === r ? "on" : ""}`} style={{ padding: "5px 10px" }} onClick={() => setRange(r)}>{r}</button>)}</div>} />
      <div className="muted" style={{ padding: "0 14px 6px", fontSize: 12.5 }}>Ranked by realised + unrealised PnL on Arc. Tap a wallet for its trades and copy-trade.</div>
      {rows == null ? <div className="empty">Loading…</div> : rows.map((r, i) => (
        <div key={r.wallet} className="row" style={{ gridTemplateColumns: "28px 36px 1fr auto", minHeight: 60 }} onClick={() => go(`/profile/${r.wallet}`)}>
          <span className={`num ${i < 3 ? "amber" : "muted"}`} style={{ fontWeight: 800 }}>{i + 1}</span>
          <div className="logo" style={{ width: 36, height: 36, borderRadius: 18, fontSize: 12 }}>{r.avatar ? <img alt="" src={r.avatar} /> : r.wallet.slice(2, 4).toUpperCase()}</div>
          <div className="row-main"><div className="row-name"><b style={{ fontSize: 14 }}>{r.display || r.handle || short(r.wallet, 5)}</b></div><div className="row-sub num"><span>{r.trades} trades</span>{r.winrate != null && <span>WR {Math.round(r.winrate * 100)}%</span>}<span>vol {usd(r.volume)}</span></div></div>
          <div className="row-right"><div className={`row-mc ${r.pnl_total >= 0 ? "up" : "down"}`} style={{ color: undefined, fontSize: 14 }}>{r.pnl_total >= 0 ? "+" : "−"}{usd(Math.abs(r.pnl_total))}</div>{r.best_symbol && <div className="row-chg muted">best {r.best_symbol}</div>}</div>
        </div>
      ))}
    </>
  );
}
