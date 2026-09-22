/** ArcLocker in the app: lock tokens / V2 LP / Uniswap V3 or v4 positions, manage my locks. Signs with the app wallet. */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as HW from "../lib/arc-hotwallet";
import { toast } from "../lib/store";
import { short } from "../lib/fmt";
import { go } from "../lib/router";
import { Header, Icon } from "../components/ui";
import { Unlock } from "./Wallet";
import { buzzOk } from "../lib/native";

export const ARC_LOCKER = "0x07868eB2E92D4F1D9967f6Dc3B8a8Af5623Dbb94";
const V3_NPM = "0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377"; const V4_POSM = "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b";
const SEL = { lockERC20: "0x6f75d653", lockERC721: "0x9d864c00", withdraw: "0x00f714ce", extend: "0x00fc7d8f", collectV3Fees: "0xf444b184", feeFor: "0xec46a409", approve: "0x095ea7b3", allowance: "0xdd62ed3e", balanceOf: "0x70a08231", decimals: "0x313ce567", symbol: "0x95d89b41", ownerOf: "0x6352211e", getApproved: "0x081812fc" };
const p32 = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const pnum = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const when = (ts: number) => new Date(ts * 1000).toLocaleString();
const need = (v: boolean, m: string) => { if (!v) throw new Error(m); };
type Mode = "token" | "v2" | "v3" | "v4";
type LockRow = { id: number; kind: "ERC20" | "ERC721"; asset: string; amountOrId: string; owner: string; unlockAt: number; vestEnd: number; token0: string; token1: string | null; withdrawn: boolean; label: string; poolShare?: number | null };
const DUR: [string, number][] = [["1 mo", 30], ["3 mo", 90], ["6 mo", 180], ["1 yr", 365], ["2 yr", 730]];

export default function Locker() {
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const [mode, setMode] = useState<Mode>("token");
  const [asset, setAsset] = useState(""); const [amount, setAmount] = useState(""); const [tokenId, setTokenId] = useState("");
  const [days, setDays] = useState(180); const [vest, setVest] = useState(0);
  const [info, setInfo] = useState<{ symbol?: string; decimals?: number; balance?: bigint; owner?: string } | null>(null);
  const [fee, setFee] = useState<number | null>(null);
  const [mine, setMine] = useState<LockRow[]>([]); const [busy, setBusy] = useState<string | null>(null);
  const me = HW.hotAddress();
  const collection = mode === "v3" ? V3_NPM : mode === "v4" ? V4_POSM : asset; const isNft = mode === "v3" || mode === "v4";

  const reload = useCallback(() => { if (me) fetch(`https://arctools.fun/api/locks?owner=${me}`).then((r) => r.json()).then((j) => setMine(j.locks ?? [])).catch(() => undefined); }, [me]);
  useEffect(() => { reload(); if (me) HW.hotCall(ARC_LOCKER, SEL.feeFor + p32(me)).then((r) => setFee(r && r !== "0x" ? Number(BigInt(r) / 10n ** 12n) / 1e6 : 50)).catch(() => setFee(50)); }, [me, reload]);
  useEffect(() => {
    let alive = true; setInfo(null);
    (async () => {
      try {
        if (isNft) { if (!/^\d+$/.test(tokenId)) return; const o = await HW.hotCall(collection, SEL.ownerOf + pnum(BigInt(tokenId))); if (alive) setInfo({ owner: "0x" + o.slice(26) }); }
        else if (/^0x[0-9a-fA-F]{40}$/.test(asset) && me) {
          const [s, d, b] = await Promise.all([HW.hotCall(asset, SEL.symbol).catch(() => "0x"), HW.hotCall(asset, SEL.decimals).catch(() => "0x"), HW.hotCall(asset, SEL.balanceOf + p32(me))]);
          let symbol = ""; try { if (s.length > 130) { const L = Number(BigInt("0x" + s.slice(66, 130))); symbol = decodeURIComponent(s.slice(130, 130 + L * 2).replace(/(..)/g, "%$1")); } } catch { /* ignore */ }
          if (alive) setInfo({ symbol, decimals: d && d !== "0x" ? Number(BigInt(d)) : 18, balance: b && b !== "0x" ? BigInt(b) : 0n });
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [asset, tokenId, mode, me, collection, isNft]);
  const dec = info?.decimals ?? 18;
  const amountWei = useMemo(() => { try { const [i, f = ""] = amount.split("."); return BigInt(i || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec)); } catch { return 0n; } }, [amount, dec]);
  const fmtBal = (b: bigint) => (Number(b / 10n ** BigInt(Math.max(0, dec - 6))) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });

  const lock = async () => {
    setBusy("Preparing…");
    try {
      need(!!me && HW.isUnlocked(), "Unlock the wallet first");
      const now = Math.floor(Date.now() / 1000); const unlockAt = now + days * 86400; const vestEnd = isNft ? unlockAt : unlockAt + vest * 86400;
      const feeWei = BigInt(Math.round((fee ?? 50) * 1e6)) * 10n ** 12n;
      if (feeWei > 0n) { const bal = await HW.hotBalance(me!); need(bal > (fee ?? 50) + 0.05, `Lock fee is ${fee} USDC — wallet has ${bal.toFixed(2)}`); }
      if (isNft) {
        need(/^\d+$/.test(tokenId), "Position id required");
        need(!info?.owner || info.owner.toLowerCase() === me!.toLowerCase(), `Position #${tokenId} is not yours`);
        const ap = await HW.hotCall(collection, SEL.getApproved + pnum(BigInt(tokenId)));
        if (!ap || ap.slice(-40).toLowerCase() !== ARC_LOCKER.slice(2).toLowerCase()) { setBusy("Approving position…"); await HW.hotWait(await HW.hotSend({ to: collection, data: SEL.approve + p32(ARC_LOCKER) + pnum(BigInt(tokenId)) })); }
        setBusy("Locking…");
        const h = await HW.hotSend({ to: ARC_LOCKER, data: SEL.lockERC721 + p32(collection) + pnum(BigInt(tokenId)) + pnum(unlockAt) + p32(me!), value: feeWei });
        need((await HW.hotWait(h)).status === 1, "Lock reverted");
      } else {
        need(/^0x[0-9a-fA-F]{40}$/.test(asset), "Token address required"); need(amountWei > 0n, "Amount required");
        need(!(info?.balance != null && amountWei > info.balance), "More than your balance");
        const al = await HW.hotAllowance(asset, me!, ARC_LOCKER).catch(() => 0n);
        if (al < amountWei) { setBusy("Approving…"); await HW.hotWait(await HW.hotApprove(asset, ARC_LOCKER, amountWei)); }
        setBusy("Locking…");
        const h = await HW.hotSend({ to: ARC_LOCKER, data: SEL.lockERC20 + p32(asset) + pnum(amountWei) + pnum(unlockAt) + pnum(vestEnd) + p32(me!), value: feeWei });
        need((await HW.hotWait(h)).status === 1, "Lock reverted");
      }
      buzzOk(); toast(`Locked until ${when(unlockAt)}`, "ok"); setAmount(""); setTokenId(""); reload();
    } catch (e) { toast(String((e as Error).message || e).slice(0, 160), "err"); } finally { setBusy(null); }
  };
  const act = async (label: string, data: string) => { setBusy(label); try { const h = await HW.hotSend({ to: ARC_LOCKER, data }); need((await HW.hotWait(h)).status === 1, "reverted"); buzzOk(); toast("Done", "ok", h); reload(); } catch (e) { toast(String((e as Error).message || e).slice(0, 140), "err"); } finally { setBusy(null); } };

  if (!HW.hasWallet()) return <><Header title="Locker" back /><div className="empty">Create a wallet first.</div></>;
  if (!HW.isUnlocked()) return <><Header title="Locker" back /><Unlock /></>;
  return (
    <>
      <Header title="ArcLocker" back />
      <div className="launch">
        <div className="card">
          <div className="launch__label">What to lock</div>
          <div className="seg" style={{ padding: 0 }}>
            {([["token", "Token"], ["v2", "V2 LP"], ["v3", "Uniswap V3 position"], ["v4", "Uniswap v4 position"]] as [Mode, string][]).map(([k, l]) => <button key={k} className={`chip ${mode === k ? "on" : ""}`} onClick={() => setMode(k)}>{l}</button>)}
          </div>
          {isNft ? (
            <>
              <div className="field"><small className="muted">Position #</small><input inputMode="numeric" placeholder="e.g. 46017" value={tokenId} onChange={(e) => setTokenId(e.target.value.trim())} style={{ textAlign: "right" }} /></div>
              {info?.owner && <div className={`launch__hint ${info.owner.toLowerCase() === me?.toLowerCase() ? "up" : "down"}`}>{info.owner.toLowerCase() === me?.toLowerCase() ? "Owned by you" : `Owned by ${short(info.owner, 4)}`}</div>}
              <div className="muted launch__hint">{mode === "v3" ? "Swap fees stay collectable while the position is locked." : "A v4 position is fully locked until the unlock date."}</div>
            </>
          ) : (
            <>
              <div className="field"><input placeholder={mode === "v2" ? "LP token (pair) address 0x…" : "Token address 0x…"} value={asset} onChange={(e) => setAsset(e.target.value.trim())} autoCapitalize="none" /></div>
              {info?.balance != null && <div className="muted launch__hint">Balance {fmtBal(info.balance)} {info.symbol}</div>}
              <div className="field"><small className="muted">Amount</small><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ textAlign: "right" }} /><button className="chip" onClick={() => info?.balance != null && setAmount(fmtBal(info.balance).replace(/,/g, ""))}>MAX</button></div>
            </>
          )}
        </div>
        <div className="card">
          <div className="launch__label">Locked for</div>
          <div className="seg" style={{ padding: 0 }}>{DUR.map(([l, d]) => <button key={d} className={`chip ${days === d ? "on" : ""}`} onClick={() => setDays(d)}>{l}</button>)}</div>
          <div className="field"><small className="muted">Days</small><input inputMode="numeric" value={days} onChange={(e) => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))} style={{ textAlign: "right" }} /></div>
          <div className="muted launch__hint">Unlocks {when(Math.floor(Date.now() / 1000) + days * 86400)} · extendable, never shortened · no admin key can release it</div>
          {!isNft && <><div className="launch__label" style={{ marginTop: 6 }}>Vesting after unlock</div>
            <div className="seg" style={{ padding: 0 }}>{([["none", 0], ["3 mo", 90], ["6 mo", 180], ["1 yr", 365]] as [string, number][]).map(([l, d]) => <button key={d} className={`chip ${vest === d ? "on" : ""}`} onClick={() => setVest(d)}>{l}</button>)}</div></>}
        </div>
        <div style={{ padding: "0 14px 10px" }}>
          <button className="btn primary" disabled={!!busy} onClick={lock}>{busy ?? (isNft ? `Lock position #${tokenId || "…"}` : `Lock ${amount || "…"} ${info?.symbol ?? ""}`)}</button>
          <div className="muted launch__hint" style={{ textAlign: "center" }}>Fee {fee == null ? "…" : fee === 0 ? "waived for this wallet" : `${fee} USDC`} · one-time · funds ARCT buyback</div>
        </div>
        <div className="card">
          <div className="launch__label">My locks</div>
          {mine.length === 0 ? <div className="muted launch__hint">No locks from this wallet yet.</div> : mine.map((l) => {
            const now = Math.floor(Date.now() / 1000); const open = now >= l.unlockAt && !l.withdrawn;
            const amt = l.kind === "ERC20" ? (Number(BigInt(l.amountOrId) / 10n ** 12n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 }) : `#${l.amountOrId}`;
            return (
              <div key={l.id} className="kv" style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><b>{l.label === "token" ? "Token" : l.label === "v2-lp" ? "V2 LP" : l.label === "v3-position" ? "V3 position" : l.label === "v4-position" ? "v4 position" : "NFT"} · {amt}</b><span className={l.withdrawn ? "muted" : open ? "up" : "amber"} style={{ fontSize: 12 }}>{l.withdrawn ? "withdrawn" : open ? "unlocked" : `until ${when(l.unlockAt)}`}</span></div>
                <div className="muted" style={{ fontSize: 12 }}><a onClick={() => go(`/token/${l.token0}`)}>{short(l.token0, 4)}</a>{l.token1 ? ` / ${short(l.token1, 4)}` : ""}</div>
                {!l.withdrawn && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {open && <button className="chip on" disabled={!!busy} onClick={() => act("Withdrawing…", SEL.withdraw + pnum(l.id) + p32(me!))}>Withdraw</button>}
                  <button className="chip" disabled={!!busy} onClick={() => { const d = Number(prompt("Extend by how many days?", "90")); if (d > 0) void act("Extending…", SEL.extend + pnum(l.id) + pnum(l.unlockAt + d * 86400) + pnum(Math.max(l.vestEnd, l.unlockAt) + d * 86400)); }}>Extend</button>
                  {l.label === "v3-position" && <button className="chip" disabled={!!busy} onClick={() => act("Collecting…", SEL.collectV3Fees + pnum(l.id) + p32(me!))}>Collect fees</button>}
                </div>}
              </div>
            );
          })}
        </div>
        <div className="muted launch__hint" style={{ padding: "0 16px 20px" }}>Contract {short(ARC_LOCKER, 6)} · <a onClick={() => import("../lib/native").then((n) => n.openUrl(`https://arc-scan.org/address/${ARC_LOCKER}`))}>explorer</a></div>
      </div>
      <Icon.check className="" style={{ display: "none" }} />
    </>
  );
}
