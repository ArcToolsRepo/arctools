import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { WalletPanel } from "@/components/wallet-panel";
import { ARC_LOCKER, SEL, V3_NPM, V4_POSM, feeFor, locksOf, type LockRow } from "@/lib/arc-locker";
import { hotAddress, hotSend, hotWait, isUnlocked, onHotChange } from "@/lib/arc-hotwallet";
import { connectWallet, ethCall, getStoredWallet, onWalletChange, sendTx } from "@/lib/arc-wallet";
import "../arc-site.css";

export const Route = createFileRoute("/locker")({
  head: () => ({ meta: [
    { title: "ArcLocker: lock tokens, LP and Uniswap positions on Arc" },
    { name: "description", content: "Time-lock project tokens, Uniswap V2 LP, Uniswap V3 and v4 positions on Arc. No admin key can release a lock early. Token pages show what is locked and until when." },
  ] }),
  component: Locker,
});

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ts: number) => new Date(ts * 1000).toLocaleString();
const p32 = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const pnum = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const DUR = [["1 month", 30], ["3 months", 90], ["6 months", 180], ["1 year", 365], ["2 years", 730]] as const;
type Mode = "token" | "v2" | "v3" | "v4";
const ERC = { balanceOf: "0x70a08231", allowance: "0xdd62ed3e", decimals: "0x313ce567", symbol: "0x95d89b41", ownerOf: "0x6352211e", getApproved: "0x081812fc" };

function Locker() {
  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/locker" />
      <section className="arc-section" style={{ maxWidth: 1100, paddingTop: 112 }}>
        <LockerContent />
      </section>
    </main>
  );
}

/** the whole page body — shared by /locker (classic shell) and /locker2 (Terminal v2 shell) */
export function LockerContent() {
  return (
    <>
        <p className="arc-eyebrow">ARCLOCKER</p>
        <h1 className="arc-h2" style={{ fontSize: 30 }}>Lock tokens, LP and Uniswap positions</h1>
        <p className="arc-body" style={{ maxWidth: 760 }}>
          Time-lock project tokens or team allocations, Uniswap V2-style LP tokens, and Uniswap V3 or v4 position NFTs. The unlock date can only move later;
          there is no admin key over your assets — nobody, including us, can release a lock early. The only emergency path returns an asset to its lock owner, after a public 48-hour notice on-chain. V3 positions keep earning: swap fees can be collected while the principal stays locked.
          Every lock shows on the token&apos;s page (&quot;LP locked until …&quot;). Optional linear vesting for token locks.
        </p>
        <Body />
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 28 }}>
          Contract <a href={`https://arc-scan.org/address/${ARC_LOCKER}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{ARC_LOCKER}</a> · source on GitHub (ArcToolsRepo/arctools) · fee goes to the ARCT buyback treasury.
        </p>
    </>
  );
}

function Body() {
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
    const rc = await hotWait(h); if (rc.status !== 1) throw new Error("transaction reverted"); return h;
  }, [addr, useHot]);

  const [fee, setFee] = useState<number | null>(null);
  useEffect(() => { if (addr) feeFor(addr).then(setFee).catch(() => setFee(50)); }, [addr]);
  const [mine, setMine] = useState<LockRow[]>([]);
  const reload = useCallback(() => { if (addr) locksOf(addr).then(setMine).catch(() => null); }, [addr]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", marginTop: 22 }} className="arc-pay-grid">
      <div style={card}>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>New lock</p>
        {!addr ? (
          <div style={{ border: "1px dashed var(--arc-line)", borderRadius: 10, padding: 20, textAlign: "center" }}>
            <p className="arc-body" style={{ margin: "0 0 12px" }}>Unlock your trading wallet or connect a browser wallet.</p>
            <button className="arc-cta" onClick={() => void connectWallet().catch(() => null)} type="button">Connect wallet</button>
            <div style={{ marginTop: 14, textAlign: "left" }}><WalletPanel onReady={(a) => setAddr(a)} /></div>
          </div>
        ) : <NewLock addr={addr} fee={fee} send={send} onDone={reload} />}
      </div>
      <div style={card}>
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 12px", textTransform: "uppercase" }}>My locks {addr ? `· ${short(addr)}` : ""}</p>
        {addr && addr.toLowerCase() === LOCKER_OWNER && <RescuePanel send={send} />}
        {!addr ? <p className="arc-body" style={{ color: "var(--arc-muted)" }}>Connect to see your locks.</p>
          : mine.length === 0 ? <p className="arc-body" style={{ color: "var(--arc-muted)" }}>No locks from this wallet yet.</p>
          : mine.map((l) => <LockCard key={l.id} l={l} me={addr} send={send} onDone={reload} />)}
      </div>
    </div>
  );
}

function NewLock({ addr, fee, send, onDone }: { addr: string; fee: number | null; send: (to: string, data: string, value?: bigint) => Promise<string>; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("token");
  const [asset, setAsset] = useState(""); const [amount, setAmount] = useState(""); const [tokenId, setTokenId] = useState("");
  const [days, setDays] = useState<number>(180); const [vestDays, setVestDays] = useState<number>(0);
  const [info, setInfo] = useState<{ symbol?: string; decimals?: number; balance?: bigint; owner?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const collection = mode === "v3" ? V3_NPM : mode === "v4" ? V4_POSM : asset;
  const isNft = mode === "v3" || mode === "v4";

  // read what the user is about to lock
  useEffect(() => {
    let alive = true; setInfo(null);
    (async () => {
      try {
        if (isNft) {
          if (!/^\d+$/.test(tokenId)) return;
          const o = await ethCall(collection, ERC.ownerOf + pnum(BigInt(tokenId)));
          if (alive) setInfo({ owner: "0x" + o.slice(26) });
        } else {
          if (!/^0x[0-9a-fA-F]{40}$/.test(asset)) return;
          const [s, d, b] = await Promise.all([ethCall(asset, ERC.symbol).catch(() => "0x"), ethCall(asset, ERC.decimals).catch(() => "0x"), ethCall(asset, ERC.balanceOf + p32(addr))]);
          let symbol = ""; try { if (s.length > 130) { const L = Number(BigInt("0x" + s.slice(66, 130))); symbol = Buffer.from(s.slice(130, 130 + L * 2), "hex").toString("utf8"); } } catch { /* ignore */ }
          if (alive) setInfo({ symbol, decimals: d && d !== "0x" ? Number(BigInt(d)) : 18, balance: b && b !== "0x" ? BigInt(b) : 0n });
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [asset, tokenId, mode, addr, collection, isNft]);

  const dec = info?.decimals ?? 18;
  const amountWei = useMemo(() => { try { const [i, f = ""] = amount.split("."); return BigInt(i || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec)); } catch { return 0n; } }, [amount, dec]);
  const balFmt = info?.balance != null ? (Number(info.balance / 10n ** BigInt(Math.max(0, dec - 6))) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 }) : null;

  const go = async () => {
    setMsg(null); setBusy("Preparing…");
    try {
      const now = Math.floor(Date.now() / 1000); const unlockAt = now + days * 86400; const vestEnd = isNft ? unlockAt : unlockAt + vestDays * 86400;
      const feeWei = BigInt(Math.round((fee ?? 50) * 1e6)) * 10n ** 12n;
      if (isNft) {
        if (!/^\d+$/.test(tokenId)) throw new Error("Position id required");
        if (info?.owner && info.owner.toLowerCase() !== addr.toLowerCase()) throw new Error(`Position #${tokenId} is owned by ${short(info.owner)}, not by you`);
        const ap = await ethCall(collection, ERC.getApproved + pnum(BigInt(tokenId)));
        if (!ap || ap.slice(-40).toLowerCase() !== ARC_LOCKER.slice(2).toLowerCase()) { setBusy("Approving the position…"); await send(collection, SEL.nftApprove + p32(ARC_LOCKER) + pnum(BigInt(tokenId))); }
        setBusy("Locking…");
        await send(ARC_LOCKER, SEL.lockERC721 + p32(collection) + pnum(BigInt(tokenId)) + pnum(unlockAt) + p32(addr), feeWei);
      } else {
        if (!/^0x[0-9a-fA-F]{40}$/.test(asset)) throw new Error("Token address required");
        if (amountWei <= 0n) throw new Error("Amount required");
        if (info?.balance != null && amountWei > info.balance) throw new Error("More than your balance");
        const al = await ethCall(asset, ERC.allowance + p32(addr) + p32(ARC_LOCKER));
        if (!al || al === "0x" || BigInt(al) < amountWei) { setBusy("Approving…"); await send(asset, SEL.approve + p32(ARC_LOCKER) + pnum(amountWei)); }
        setBusy("Locking…");
        await send(ARC_LOCKER, SEL.lockERC20 + p32(asset) + pnum(amountWei) + pnum(unlockAt) + pnum(vestEnd) + p32(addr), feeWei);
      }
      const mineNow = await locksOf(addr).catch(() => [] as LockRow[]); const newest = mineNow.length ? Math.max(...mineNow.map((x) => x.id)) : null;
      setMsg({ ok: true, text: `Locked until ${when(unlockAt)}${vestDays && !isNft ? `, vesting ${vestDays} days after that` : ""}.${newest != null ? ` Proof link: arctools.fun/locker/${newest}` : ""}` }); setAmount(""); setTokenId(""); onDone();
    } catch (e) { setMsg({ ok: false, text: String((e as Error).message || e).slice(0, 200) }); } finally { setBusy(null); }
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {([["token", "Token"], ["v2", "V2 LP token"], ["v3", "Uniswap V3 position"], ["v4", "Uniswap v4 position"]] as const).map(([k, l]) => <button className="arc-mono" key={k} onClick={() => { setMode(k); setMsg(null); }} style={chip(mode === k)} type="button">{l}</button>)}
      </div>
      {isNft ? (
        <>
          <label className="arc-mono" style={lbl}>Position NFT id ({mode === "v3" ? "NonfungiblePositionManager" : "Uniswap v4 Positions NFT"})</label>
          <input className="arc-mono" inputMode="numeric" onChange={(e) => setTokenId(e.target.value.trim())} placeholder="e.g. 46017" style={{ ...inp, width: "100%" }} value={tokenId} />
          {info?.owner && <p className="arc-mono" style={{ color: info.owner.toLowerCase() === addr.toLowerCase() ? "var(--arc-green, #22c580)" : "#f0534f", fontSize: 12, margin: "6px 0 0" }}>{info.owner.toLowerCase() === addr.toLowerCase() ? "Owned by you" : `Owned by ${short(info.owner)}`}</p>}
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "8px 0 0" }}>Find the id in your wallet&apos;s NFT tab or on the position page. {mode === "v3" ? "Swap fees stay collectable while locked." : "v4 positions are fully locked (fee collection not available while locked)."}</p>
        </>
      ) : (
        <>
          <label className="arc-mono" style={lbl}>{mode === "v2" ? "LP token address (the pair contract)" : "Token address"}</label>
          <input className="arc-mono" onChange={(e) => setAsset(e.target.value.trim())} placeholder="0x…" style={{ ...inp, width: "100%" }} value={asset} />
          {info?.balance != null && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "6px 0 0" }}>Balance: {balFmt} {info.symbol}</p>}
          <label className="arc-mono" style={{ ...lbl, marginTop: 12 }}>Amount</label>
          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
            <input className="arc-mono" inputMode="decimal" onChange={(e) => setAmount(e.target.value)} style={{ ...inp, flex: 1 }} value={amount} />
            <button className="arc-mono" onClick={() => info?.balance != null && setAmount((Number(info.balance / 10n ** BigInt(Math.max(0, dec - 6))) / 1e6).toString())} style={chip(false)} type="button">MAX</button>
          </div>
        </>
      )}
      <label className="arc-mono" style={{ ...lbl, marginTop: 14 }}>Locked for</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0 4px" }}>
        {DUR.map(([l, d]) => <button className="arc-mono" key={d} onClick={() => setDays(d)} style={chip(days === d)} type="button">{l}</button>)}
        <input className="arc-mono" inputMode="numeric" onChange={(e) => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))} style={{ ...inp, width: 90 }} title="days" value={days} />
      </div>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 10px" }}>Unlocks {when(Math.floor(Date.now() / 1000) + days * 86400)} · can be extended later, never shortened</p>
      {!isNft && (
        <>
          <label className="arc-mono" style={lbl}>Vesting after unlock (optional)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0 14px" }}>
            {([["none", 0], ["3 months", 90], ["6 months", 180], ["1 year", 365]] as const).map(([l, d]) => <button className="arc-mono" key={d} onClick={() => setVestDays(d)} style={chip(vestDays === d)} type="button">{l}</button>)}
          </div>
        </>
      )}
      <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", fontSize: 12, justifyContent: "space-between", margin: "0 0 12px" }}>
        <span>Lock fee (one-time, to the ARCT buyback treasury)</span><strong style={{ color: "var(--arc-ink)" }}>{fee == null ? "…" : fee === 0 ? "free for this wallet" : `${fee} USDC`}</strong>
      </div>
      <button className="arc-cta" disabled={!!busy} onClick={() => void go()} type="button">{busy ?? (isNft ? `Lock position #${tokenId || "…"}` : `Lock ${amount || "…"} ${info?.symbol ?? ""}`)}</button>
      {msg && <p className="arc-mono" style={{ color: msg.ok ? "var(--arc-green, #22c580)" : "#f0534f", fontSize: 12, marginTop: 10 }}>{msg.text}</p>}
    </>
  );
}

function LockCard({ l, me, send, onDone }: { l: LockRow; me: string; send: (to: string, data: string, value?: bigint) => Promise<string>; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const now = Math.floor(Date.now() / 1000); const unlocked = now >= l.unlockAt; const mineNow = l.owner.toLowerCase() === me.toLowerCase();
  const amt = l.kind === "ERC20" ? (Number(BigInt(l.amountOrId) / 10n ** 12n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 }) : `#${l.amountOrId}`;
  const title = l.label === "token" ? "Token" : l.label === "v2-lp" ? "V2 LP" : l.label === "v3-position" ? "Uniswap V3 position" : l.label === "v4-position" ? "Uniswap v4 position" : "NFT";
  const act = async (label: string, data: string) => { setErr(null); setBusy(label); try { await send(ARC_LOCKER, data); onDone(); } catch (e) { setErr(String((e as Error).message || e).slice(0, 140)); } finally { setBusy(null); } };
  return (
    <div style={{ border: "1px solid var(--arc-line)", borderRadius: 10, marginBottom: 10, padding: 12 }}>
      <div className="arc-mono" style={{ display: "flex", fontSize: 12, justifyContent: "space-between" }}>
        <span><strong style={{ color: "var(--arc-ink)" }}>{title}</strong> · {amt} · <a href={`/token/${l.token0}`} style={{ color: "var(--arc-cobalt)" }}>{short(l.token0)}</a>{l.token1 ? <> / <a href={`/token/${l.token1}`} style={{ color: "var(--arc-cobalt)" }}>{short(l.token1)}</a></> : null}</span>
        <span style={{ color: l.withdrawn ? "var(--arc-muted)" : unlocked ? "var(--arc-green, #22c580)" : "var(--arc-amber, #ffb054)" }}>{l.withdrawn ? "withdrawn" : unlocked ? "unlocked" : `locked until ${when(l.unlockAt)}`} · <a href={`/locker/${l.id}`} style={{ color: "var(--arc-cobalt)" }}>#{l.id}</a></span>
      </div>
      {l.kind === "ERC20" && l.vestEnd > l.unlockAt && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "4px 0 0" }}>linear vesting until {when(l.vestEnd)}</p>}
      {!l.withdrawn && mineNow && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {unlocked && <button className="arc-mono" disabled={!!busy} onClick={() => void act("Withdrawing…", SEL.withdraw + pnum(l.id) + p32(me))} style={chip(true)} type="button">{busy === "Withdrawing…" ? busy : "Withdraw"}</button>}
          <button className="arc-mono" disabled={!!busy} onClick={() => { const d = Number(prompt("Extend by how many days?", "90")); if (d > 0) void act("Extending…", SEL.extend + pnum(l.id) + pnum(l.unlockAt + d * 86400) + pnum(Math.max(l.vestEnd, l.unlockAt) + d * 86400)); }} style={chip(false)} type="button">Extend</button>
          {l.label === "v3-position" && <button className="arc-mono" disabled={!!busy} onClick={() => void act("Collecting…", SEL.collectV3Fees + pnum(l.id) + p32(me))} style={chip(false)} type="button">Collect fees</button>}
          <button className="arc-mono" onClick={() => { void navigator.clipboard.writeText(`https://arctools.fun/locker/${l.id}`); setErr("Link copied — anyone can verify this lock at arctools.fun/locker/" + l.id); }} style={chip(false)} type="button">Copy link</button>
          <button className="arc-mono" disabled={!!busy} onClick={() => { const to = prompt("Transfer lock ownership to (address):"); if (to && /^0x[0-9a-fA-F]{40}$/.test(to)) void act("Transferring…", SEL.transferLock + pnum(l.id) + p32(to)); }} style={chip(false)} type="button">Transfer</button>
        </div>
      )}
      {err && <p className="arc-mono" style={{ color: "#f0534f", fontSize: 11, marginTop: 8 }}>{err}</p>}
    </div>
  );
}

const LOCKER_OWNER = "0x408c3d3fd36fdf84888f343417787d8710e76fe8";
const RSEL = { announce: "0x88eceaeb", cancel: "0x0a3b2aa3", rescue: "0x6ac053ad" };
/** Owner-only emergency path: announce (public event) → 48 h → rescue returns the asset to the LOCK OWNER, nowhere else. */
function RescuePanel({ send }: { send: (to: string, data: string, value?: bigint) => Promise<string> }) {
  const [id, setId] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [out, setOut] = useState<string | null>(null);
  const enc = (str: string) => { const b = new TextEncoder().encode(str); return pnum(0x40) + pnum(b.length) + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("").padEnd(Math.ceil(b.length / 32) * 64, "0"); };
  const run = async (label: string, data: string) => { setBusy(label); setOut(null); try { const h = await send(ARC_LOCKER, data); setOut(`${label} ok · ${h.slice(0, 14)}…`); } catch (e) { setOut(String((e as Error).message || e).slice(0, 140)); } finally { setBusy(null); } };
  return (
    <div style={{ border: "1px dashed #f0534f", borderRadius: 10, marginBottom: 12, padding: 12 }}>
      <p className="arc-mono" style={{ color: "#f0534f", fontSize: 11, margin: "0 0 8px", textTransform: "uppercase" }}>Owner · emergency rescue (returns to the lock owner after 48 h, public)</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input className="arc-mono" inputMode="numeric" onChange={(e) => setId(e.target.value.trim())} placeholder="lock id" style={{ ...inp, width: 90 }} value={id} />
        <input className="arc-mono" onChange={(e) => setReason(e.target.value)} placeholder="reason (public)" style={{ ...inp, flex: 1, minWidth: 160 }} value={reason} />
        <button className="arc-mono" disabled={!!busy || !/^\d+$/.test(id)} onClick={() => void run("announceRescue", RSEL.announce + pnum(Number(id)) + enc(reason || "owner rescue"))} style={chip(false)} type="button">Announce</button>
        <button className="arc-mono" disabled={!!busy || !/^\d+$/.test(id)} onClick={() => void run("cancelRescue", RSEL.cancel + pnum(Number(id)))} style={chip(false)} type="button">Cancel</button>
        <button className="arc-mono" disabled={!!busy || !/^\d+$/.test(id)} onClick={() => void run("rescue", RSEL.rescue + pnum(Number(id)))} style={chip(true)} type="button">Rescue (after 48 h)</button>
      </div>
      {out && <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginTop: 8 }}>{out}</p>}
    </div>
  );
}

const card: React.CSSProperties = { background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 14, padding: 20 };
const lbl: React.CSSProperties = { color: "var(--arc-muted)", display: "block", fontSize: 11 };
const inp: React.CSSProperties = { background: "#0e1118", border: "1px solid var(--arc-line)", borderRadius: 8, color: "var(--arc-ink)", fontSize: 14, padding: "10px 12px", width: 140 };
const chip = (on: boolean): React.CSSProperties => ({ background: on ? "var(--arc-cobalt)" : "transparent", border: "1px solid " + (on ? "var(--arc-cobalt)" : "var(--arc-line)"), borderRadius: 8, color: on ? "#fff" : "var(--arc-ink)", cursor: "pointer", fontSize: 12, padding: "8px 12px" });
