/** Launch a token on ArcToolsPad — the pump.fun shape: picture, name, ticker, description, socials, then the mode
 *  (free bonding curve or instant Uniswap), optional taxes, optional first buy. The picture and description are not
 *  on-chain: after `TokenCreated` the app POSTs them to the site's /api/pad-meta, which verifies the creator on-chain
 *  and serves the logo to every ArcTools surface (site, bots, this app). */
import { useEffect, useRef, useState } from "react";
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as HW from "../lib/arc-hotwallet";
import { FN3, PAD_V3, encodeCreateTokenV3 } from "../lib/arc-wallet";
import { buy } from "../lib/trade";
import { toast } from "../lib/store";
import { short } from "../lib/fmt";
import { go } from "../lib/router";
import { Header, Icon } from "../components/ui";
import { Unlock } from "./Wallet";
import { buzzOk } from "../lib/native";

const need = (v: boolean, msg: string) => { if (!v) throw new Error(msg); };
const hexStr = (r: string | null | undefined) => (r && r !== "0x" ? BigInt(r) : 0n);
const SITE = "https://arctools.fun";
const ZERO = "0x0000000000000000000000000000000000000000";

const TOKEN_CREATED_TOPIC = "0x" + Array.from(keccak_256(new TextEncoder().encode("TokenCreated(address,address,string,string)"))).map((b: number) => b.toString(16).padStart(2, "0")).join("");

/** Shrink any picked image to a 256×256 PNG data URL (cover crop) — small enough for the meta API, sharp enough for lists. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error("Cannot read this image")); i.src = url; });
    const S = 256; const c = document.createElement("canvas"); c.width = S; c.height = S;
    const ctx = c.getContext("2d")!; const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
    return c.toDataURL("image/png");
  } finally { URL.revokeObjectURL(url); }
}

export function Launch() {
  const [, tick] = useState(0); useEffect(() => { const off = HW.onHotChange(() => tick((n) => n + 1)); return () => { off(); }; }, []);
  const [mode, setMode] = useState<"curve" | "instant">("curve");
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", target: "5000", seed: "50", marketing: "0", rewards: "0", burn: "0", firstBuy: "" });
  const [image, setImage] = useState<string | null>(null);
  const [fee, setFee] = useState<number | null>(null); const [minTarget, setMinTarget] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ tx: string; token: string | null; meta: "ok" | "fail" | "skip" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  useEffect(() => {
    HW.hotCall(PAD_V3, FN3.instantFee).then((r) => setFee(Number(hexStr(r) / 10n ** 12n) / 1e6)).catch(() => setFee(30));
    HW.hotCall(PAD_V3, FN3.minTarget).then((r) => setMinTarget(Number(hexStr(r) / 10n ** 12n) / 1e6)).catch(() => setMinTarget(null));
  }, []);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { need(file.size < 8 * 1024 * 1024, "Image over 8 MB"); setImage(await shrink(file)); } catch (err) { toast(String((err as Error).message), "err"); }
  };

  const launch = async () => {
    setBusy("Preparing…");
    try {
      const name = f.name.trim(), symbol = f.symbol.trim().toUpperCase();
      need(name.length >= 2 && symbol.length >= 2, "Name and ticker: at least 2 characters");
      need(/^[A-Z0-9]{2,12}$/.test(symbol), "Ticker: letters and digits only, max 12");
      const from = HW.hotAddress()!;
      const bps = (s: string) => Math.max(0, Math.min(1000, Math.round(Number(s || 0) * 100)));
      const tgt = BigInt(Math.round(Number(mode === "curve" ? f.target : f.seed) * 1e6)) * 10n ** 12n;
      if (mode === "curve" && minTarget != null) need(Number(f.target) >= minTarget, `Graduation target: at least ${minTarget} USDC`);
      const firstBuy = Number(f.firstBuy || 0);
      const data = encodeCreateTokenV3({
        name, symbol, marketingBps: bps(f.marketing), rewardsBps: bps(f.rewards), burnBps: bps(f.burn), marketingWallet: from,
        website: f.website.trim(), twitter: f.twitter.trim().replace(/^@/, ""), telegram: f.telegram.trim().replace(/^@/, ""),
        rewardToken: ZERO, quoteToken: ZERO, mode: mode === "instant" ? 1 : 0, targetQuote: tgt,
      });
      const value = mode === "instant" ? BigInt(Math.round((fee ?? 30) * 1e6)) * 10n ** 12n + tgt : 0n;
      const bal = await HW.hotBalance(from);
      const needUsdc = Number(value) / 1e18 + firstBuy + 0.1;
      need(bal > needUsdc, `Need ${needUsdc.toFixed(2)} USDC in the wallet (have ${bal.toFixed(2)})`);
      setBusy("Launching…");
      const h = await HW.hotSend({ to: PAD_V3, data, value, gasLimit: 3_500_000n });
      setBusy("Waiting for the block…");
      const rc = await HW.hotWait(h);
      need(rc.status === 1, "The launch transaction reverted");
      // token address = topics[1] of TokenCreated emitted by the pad
      const log = (rc.logs ?? []).find((l) => l.address.toLowerCase() === PAD_V3.toLowerCase() && l.topics[0]?.toLowerCase() === TOKEN_CREATED_TOPIC);
      const token = log ? "0x" + log.topics[1].slice(26) : null;
      buzzOk(); toast(`${symbol} is live`, "ok", h);
      // picture + description → site meta (verified against the creator on-chain)
      let meta: "ok" | "fail" | "skip" = "skip";
      if (token && (image || f.description.trim())) {
        setBusy("Saving picture…");
        try {
          const r = await fetch(`${SITE}/api/pad-meta`, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ token, name, symbol, website: f.website.trim(), twitter: f.twitter.trim().replace(/^@/, ""), telegram: f.telegram.trim().replace(/^@/, ""), description: f.description.trim(), image: image ?? undefined, creator: from }) });
          const j = (await r.json()) as { ok?: boolean; reason?: string };
          meta = j.ok ? "ok" : "fail"; if (!j.ok) toast(`Picture not saved: ${j.reason ?? r.status}`, "err");
        } catch { meta = "fail"; }
      }
      // optional first buy, same path as every buy button
      if (token && firstBuy > 0) { setBusy(`Buying ${firstBuy} USDC…`); try { await buy(token, firstBuy); } catch (e) { toast(`First buy failed: ${String((e as Error).message).slice(0, 100)}`, "err"); } }
      setDone({ tx: h, token, meta });
    } catch (e) { toast(String((e as Error).message || e).slice(0, 160), "err"); } finally { setBusy(null); }
  };

  if (!HW.hasWallet()) return <><Header title="Launch a token" back /><div className="empty">Create a wallet first.</div></>;
  if (!HW.isUnlocked()) return <><Header title="Launch a token" back /><Unlock /></>;
  if (done) return (
    <><Header title="Launched" back />
      <div className="card" style={{ textAlign: "center", padding: 24 }}>
        {image ? <img src={image} alt="" style={{ width: 72, height: 72, borderRadius: 20, margin: "0 auto 12px", display: "block" }} />
          : <div className="icon-btn" style={{ width: 64, height: 64, borderRadius: 20, margin: "0 auto 12px", background: "rgba(34,197,94,0.15)", color: "var(--up)" }}><Icon.check className="" /></div>}
        <b style={{ fontSize: 20 }}>{f.symbol.toUpperCase()} is live</b>
        <p className="muted" style={{ margin: "6px 0 14px", fontSize: 13 }}>{done.meta === "ok" ? "Picture and description saved." : done.meta === "fail" ? "Picture could not be saved — you can retry from the token page later." : "On-chain and trading."}</p>
        {done.token && <button className="btn primary" onClick={() => go(`/token/${done.token}`)}>Open {f.symbol.toUpperCase()}</button>}
        <div style={{ height: 8 }} />
        <button className="btn" onClick={() => { setDone(null); setImage(null); setF((o) => ({ ...o, name: "", symbol: "", description: "", firstBuy: "" })); }}>Launch another</button>
      </div></>
  );

  return (
    <>
      <Header title="Launch a token" back />
      <div className="launch">
        <div className="card">
          <div className="launch__top">
            <button className={`launch__pic ${image ? "has" : ""}`} onClick={() => fileRef.current?.click()} aria-label="Coin picture">
              {image ? <img src={image} alt="" /> : <><Icon.plus className="" /><small>picture</small></>}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
            <div className="launch__names">
              <div className="field"><input placeholder="Name" value={f.name} onChange={set("name")} maxLength={32} /></div>
              <div className="field"><input placeholder="TICKER" value={f.symbol} onChange={set("symbol")} maxLength={12} autoCapitalize="characters" style={{ textTransform: "uppercase" }} /></div>
            </div>
          </div>
          <div className="field field--area"><textarea placeholder="Description (optional) — what is this coin about?" value={f.description} onChange={set("description")} maxLength={280} rows={3} /></div>
          <div className="muted launch__hint">{f.description.length}/280 · picture and description show on ArcTools token pages, bots and the Terminal</div>
        </div>

        <div className="card">
          <div className="launch__label">Links (optional)</div>
          <div className="field"><Icon.external className="" /><input placeholder="website" value={f.website} onChange={set("website")} autoCapitalize="none" inputMode="url" /></div>
          <div className="grid2">
            <div className="field"><span className="muted">𝕏</span><input placeholder="handle" value={f.twitter} onChange={set("twitter")} autoCapitalize="none" /></div>
            <div className="field"><Icon.send className="" /><input placeholder="telegram" value={f.telegram} onChange={set("telegram")} autoCapitalize="none" /></div>
          </div>
        </div>

        <div className="card">
          <div className="launch__label">How it launches</div>
          <div className="launch__modes">
            <button className={`launch__mode ${mode === "curve" ? "on" : ""}`} onClick={() => setMode("curve")}><b>Bonding curve</b><small>Free. Buyers trade on a curve; at the target liquidity moves to Uniswap automatically.</small></button>
            <button className={`launch__mode ${mode === "instant" ? "on" : ""}`} onClick={() => setMode("instant")}><b>Instant Uniswap</b><small>{fee ?? "…"} USDC fee + your seed liquidity. Trading on Uniswap V3 from block one.</small></button>
          </div>
          {mode === "curve"
            ? <><div className="field"><span className="muted">Graduation target · USDC</span><input inputMode="decimal" value={f.target} onChange={set("target")} style={{ textAlign: "right" }} /></div>
              <div className="muted launch__hint">Minimum {minTarget ?? 1} USDC. Curve tokens graduate when this much USDC is raised.</div></>
            : <><div className="field"><span className="muted">Seed liquidity · USDC</span><input inputMode="decimal" value={f.seed} onChange={set("seed")} style={{ textAlign: "right" }} /></div>
              <div className="muted launch__hint">Paired with the token supply on Uniswap V3; LP is locked in the pad.</div></>}
          <div className="field"><span className="muted">Buy first · USDC (optional)</span><input inputMode="decimal" placeholder="0" value={f.firstBuy} onChange={set("firstBuy")} style={{ textAlign: "right" }} /></div>
          <div className="muted launch__hint">Your own first buy right after launch, before anyone else sees the coin. 0.5 % fee like every swap.</div>
        </div>

        <div className="card">
          <button className="launch__more" onClick={() => setMore((v) => !v)}><span className="launch__label" style={{ margin: 0 }}>Taxes on trades (optional)</span><span className="muted">{more ? "hide" : `${f.marketing || 0} / ${f.rewards || 0} / ${f.burn || 0} %`}</span></button>
          {more && <>
            <div className="launch__taxes">
              {(["marketing", "rewards", "burn"] as const).map((k) => <div key={k} className="field"><small className="muted">{k}</small><input inputMode="decimal" value={f[k]} onChange={set(k)} style={{ textAlign: "right" }} /></div>)}
            </div>
            <div className="muted launch__hint">Percent of each trade. Marketing goes to your wallet ({short(HW.hotAddress(), 4)}); rewards to holders; burn removes supply. 0 / 0 / 0 = a clean token, max 10 each.</div>
          </>}
        </div>

        <div style={{ padding: "4px 14px 24px" }}>
          <button className="btn primary" disabled={!!busy} onClick={launch}>{busy ?? (mode === "curve" ? `Launch ${f.symbol.toUpperCase() || "token"} on the curve` : `Launch ${f.symbol.toUpperCase() || "token"} on Uniswap · ${fee ?? "…"} USDC`)}</button>
          <div className="muted launch__hint" style={{ textAlign: "center" }}>Signed by your app wallet · 1 % pad trade fee funds ARCT buyback</div>
        </div>
      </div>
    </>
  );
}
