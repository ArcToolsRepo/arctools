import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { gasClaim, gasStatus, padList, padMetaSet, type PadListItem } from "@/lib/arcpad";
import { getPrice1m } from "@/lib/arc-api";
import {
  ARCT, FN, FN3, PAD_V3, TOLLY, connectWallet, encodeCreateTokenV3, ethCall, fileToSmallDataUrl, fmt, onWalletChange, p32, sendTx, waitReceipt,
} from "@/lib/arc-wallet";
import "../arc-site.css";

export const Route = createFileRoute("/launchpad")({
  head: () => ({
    meta: [
      { title: "ArcToolsPad: launch a token on Arc" },
      {
        name: "description",
        content:
          "Launch a token on Arc in one transaction: custom taxes, instant bonding-curve trading in native USDC, 5% of supply rewarded to ARCT stakers.",
      },
    ],
  }),
  component: LaunchpadPage,
});

const inp = {
  background: "transparent",
  border: "1px solid var(--arc-line)",
  color: "var(--arc-ink)",
  fontSize: 14,
  padding: "11px 13px",
  width: "100%",
} as const;

function TaxSlider({ label, value, onChange, max = 10 }: {
  label: string; value: number; onChange: (v: number) => void; max?: number;
}) {
  return (
    <label className="arc-mono" style={{ display: "block", fontSize: 12 }}>
      <span style={{ color: "var(--arc-muted)", textTransform: "uppercase" }}>{label}</span>
      <span style={{ color: "var(--arc-cobalt)", float: "right" }}>{value}%</span>
      <input
        max={max}
        min={0}
        onChange={(e) => onChange(Number(e.target.value))}
        step={0.5}
        style={{ accentColor: "var(--arc-cobalt)", display: "block", marginTop: 6, width: "100%" }}
        type="range"
        value={value}
      />
    </label>
  );
}

function CreateForm() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [mkt, setMkt] = useState(0);
  const [rew, setRew] = useState(0);
  const [burn, setBurn] = useState(0);
  const [mktWallet, setMktWallet] = useState("");
  const [img, setImg] = useState<string>("");
  const [rewardMode, setRewardMode] = useState<"quote" | "usdc" | "arct" | "custom">("quote");
  const [customReward, setCustomReward] = useState("");
  const [launchMode, setLaunchMode] = useState<"curve5k" | "curve10k" | "instant">("curve5k");
  const [pairMode, setPairMode] = useState<"usdc" | "tolly" | "custom">("usdc");
  const [customQuote, setCustomQuote] = useState("");
  const [seed, setSeed] = useState("");               // instant: quote units
  const [quotePrice, setQuotePrice] = useState<number | null>(1); // USD per 1 quote token
  const [quoteSym, setQuoteSym] = useState("USDC");
  const [instantFee, setInstantFee] = useState<number | null>(null); // USDC, z kontraktu
  useEffect(() => {
    ethCall(PAD_V3, FN3.instantFee).then((r) => setInstantFee(r && r !== "0x" ? Number(BigInt(r) / 10n ** 12n) / 1e6 : 0)).catch(() => setInstantFee(null));
  }, []);
  const ZERO = "0x0000000000000000000000000000000000000000";
  const quoteAddr = pairMode === "usdc" ? ZERO : pairMode === "tolly" ? TOLLY : customQuote.trim();
  const isInstant = launchMode === "instant";

  // cena quote tokena (USD za 1 token) — do przeliczenia celu $5k/$10k na jednostki quote
  useEffect(() => {
    if (pairMode === "usdc") { setQuotePrice(1); setQuoteSym("USDC"); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(quoteAddr)) { setQuotePrice(null); setQuoteSym("?"); return; }
    let alive = true;
    setQuotePrice(null);
    void (async () => {
      // cena i symbol niezaleznie — blad symbolu nie moze zablokowac wyceny
      const [pr, symHex] = await Promise.all([
        getPrice1m({ data: { token: quoteAddr } }).catch(() => ({ price1m: null as number | null })),
        ethCall(quoteAddr, "0x95d89b41").catch(() => null),   // symbol()
      ]);
      if (!alive) return;
      setQuotePrice(pr.price1m !== null && pr.price1m > 0 ? pr.price1m / 1e6 : 0);
      let sym = "?";
      try {
        if (symHex && symHex.length >= 130) {
          const ln = parseInt(symHex.slice(66, 130), 16);
          const raw = symHex.slice(130, 130 + ln * 2);
          sym = new TextDecoder().decode(new Uint8Array(raw.match(/.{2}/g)!.map((b) => parseInt(b, 16)))).replace(/\0/g, "").trim() || "?";
        } else if (symHex && symHex.length === 66) {
          sym = new TextDecoder().decode(new Uint8Array(symHex.slice(2).match(/.{2}/g)!.map((b) => parseInt(b, 16)))).replace(/\0/g, "").trim() || "?";
        }
      } catch { sym = "?"; }
      setQuoteSym(sym);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairMode, quoteAddr]);
  const targetUsd = launchMode === "curve10k" ? 10_000 : 5_000;
  const targetQuoteUnits = quotePrice && quotePrice > 0 ? targetUsd / quotePrice : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem("arctools_wallet");
      if (s) {
        setWallet(s);
        setMktWallet((w) => w || s);
      }
    } catch { /* ignore */ }
    return onWalletChange((a) => {
      setWallet(a);
      if (a) setMktWallet((w) => w || a);
    });
  }, []);

  const taxSum = mkt + rew + burn;

  const pickImage = async (f: File | null) => {
    if (!f) return;
    try {
      setImg(await fileToSmallDataUrl(f));
    } catch {
      setError("Could not read that image.");
    }
  };

  const launch = async () => {
    setError(null);
    try {
      if (!name.trim() || !symbol.trim()) throw new Error("Name and symbol are required.");
      if (taxSum > 15) throw new Error("Total taxes cannot exceed 15%.");
      if (isInstant && taxSum > 0) throw new Error("Instant Uniswap launches cannot have taxes (trades happen on Uniswap, not on our curve).");
      if (pairMode === "custom" && !/^0x[0-9a-fA-F]{40}$/.test(quoteAddr)) throw new Error("Pair token is not an address.");
      if (pairMode !== "usdc" && (quotePrice === null || quotePrice <= 0)) throw new Error("Pair token has no USDC pool on Arc — it cannot be priced.");
      setBusy("Connecting wallet...");
      const from = await connectWallet();
      setWallet(from);
      const mw = mkt > 0 ? (mktWallet || from) : from;
      if (!/^0x[0-9a-fA-F]{40}$/.test(mw)) throw new Error("Marketing wallet is not an address.");

      let rewardToken = ZERO; // = quote token
      if (rew > 0 && rewardMode === "usdc" && pairMode !== "usdc") rewardToken = "0x3600000000000000000000000000000000000000";
      if (rew > 0 && rewardMode === "arct") rewardToken = ARCT;
      if (rew > 0 && rewardMode === "custom") {
        if (!/^0x[0-9a-fA-F]{40}$/.test(customReward.trim())) throw new Error("Reward token is not an address.");
        rewardToken = customReward.trim();
      }

      // target: curve -> $5k/$10k in quote units; instant -> seed typed by the creator
      let targetQuote: bigint;
      if (isInstant) {
        const n = Number(seed);
        if (!n || n <= 0) throw new Error("Enter the initial liquidity you will seed the pool with.");
        if (n < 100) throw new Error(`Minimum seed is 100 ${quoteSym}.`);
        targetQuote = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
      } else {
        targetQuote = BigInt(Math.round((targetQuoteUnits ?? targetUsd) * 1e6)) * 10n ** 12n;
      }

      // instant + ERC-20 quote: the pad pulls the seed via transferFrom -> approve first
      if (isInstant && pairMode !== "usdc") {
        const al = await ethCall(quoteAddr, "0xdd62ed3e" + p32(from) + p32(PAD_V3));
        if (!al || BigInt(al) < targetQuote) {
          setBusy(`Approve ${quoteSym}...`);
          await waitReceipt(await sendTx({ data: FN.approve + p32(PAD_V3) + "f".repeat(64), from, to: quoteAddr }));
        }
      }

      setBusy("Confirm in your wallet...");
      const data = encodeCreateTokenV3({
        burnBps: Math.round(burn * 100), marketingBps: Math.round(mkt * 100), marketingWallet: mw,
        mode: isInstant ? 1 : 0, name: name.trim(), quoteToken: quoteAddr, rewardToken, rewardsBps: Math.round(rew * 100),
        symbol: symbol.trim().toUpperCase(), targetQuote, telegram: telegram.trim(), twitter: twitter.trim(), website: website.trim(),
      });
      const feeWei = isInstant ? BigInt(Math.round((instantFee ?? 30) * 1e6)) * 10n ** 12n : 0n;
      const value = isInstant ? feeWei + (pairMode === "usdc" ? targetQuote : 0n) : undefined;
      const hash = await sendTx({ data, from, to: PAD_V3, value });
      setBusy("Waiting for confirmation...");
      const rcpt = await waitReceipt(hash);
      if (Number(rcpt.status) !== 1) throw new Error("Transaction reverted on-chain.");
      // the new token is the first log emitter (its mint Transfer) that isn't the launchpad
      const tokenAddr = rcpt.logs.find((l) => l.address.toLowerCase() !== PAD_V3.toLowerCase())?.address;
      if (tokenAddr) {
        const meta = await padMetaSet({
          data: {
            creator: from, image: img, name: name.trim(), symbol: symbol.trim().toUpperCase(),
            telegram: telegram.trim(), token: tokenAddr, twitter: twitter.trim(), website: website.trim(),
          },
        }).catch(() => ({ ok: false, reason: "network" }));
        if (!(meta as { ok: boolean }).ok) {
          setError("Token launched, but saving the logo/socials failed — add them on the token page.");
        }
        setDone(tokenAddr);
      } else {
        setDone("created");
      }
    } catch (e) {
      setError((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  if (done && done.startsWith("0x")) {
    return (
      <div style={{ border: "1px solid var(--arc-cobalt)", padding: 22 }}>
        <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 14 }}>Token launched.</p>
        <p className="arc-mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{done}</p>
        <Link className="arc-cta" params={{ ca: done }} style={{ display: "inline-block", marginTop: 14, textDecoration: "none" }} to="/token/$ca">
          Open token page
        </Link>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--arc-line)", display: "grid", gap: 14, padding: 22 }}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "96px 1fr" }}>
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            alignItems: "center", background: img ? `center/cover url(${img})` : "transparent",
            border: "1px dashed var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer",
            display: "flex", fontSize: 11, height: 96, justifyContent: "center", width: 96,
          }}
          type="button"
        >
          {img ? "" : "+ logo"}
        </button>
        <input accept="image/*" hidden onChange={(e) => void pickImage(e.target.files?.[0] ?? null)} ref={fileRef} type="file" />
        <div style={{ display: "grid", gap: 10 }}>
          <input maxLength={48} onChange={(e) => setName(e.target.value)} placeholder="Token name" style={inp} value={name} />
          <input maxLength={12} onChange={(e) => setSymbol(e.target.value)} placeholder="SYMBOL" style={inp} value={symbol} />
        </div>
      </div>

      <div className="arc-grid-3">
        <input onChange={(e) => setWebsite(e.target.value)} placeholder="website (https://...)" style={inp} value={website} />
        <input onChange={(e) => setTwitter(e.target.value)} placeholder="x.com/..." style={inp} value={twitter} />
        <input onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/..." style={inp} value={telegram} />
      </div>

      <div className="arc-grid-3 arc-grid-3--wide">
        <TaxSlider label="Marketing tax" onChange={setMkt} value={mkt} />
        <TaxSlider label="Rewards tax" onChange={setRew} value={rew} />
        <TaxSlider label="Auto-burn tax" onChange={setBurn} value={burn} />
      </div>
      {mkt > 0 && (
        <input onChange={(e) => setMktWallet(e.target.value)} placeholder="marketing wallet 0x… (defaults to you)" style={inp} value={mktWallet} />
      )}

      <div className="arc-grid-3">
        <label className="arc-mono" style={{ fontSize: 12 }}>
          <span style={{ color: "var(--arc-muted)", textTransform: "uppercase" }}>Launch mode</span>
          <select onChange={(e) => setLaunchMode(e.target.value as "curve5k" | "curve10k" | "instant")} style={{ ...inp, marginTop: 6 }} value={launchMode}>
            <option value="curve5k">Curve → Uniswap at $5k</option>
            <option value="curve10k">Curve → Uniswap at $10k</option>
            <option value="instant">Instant Uniswap launch</option>
          </select>
        </label>
        <label className="arc-mono" style={{ fontSize: 12 }}>
          <span style={{ color: "var(--arc-muted)", textTransform: "uppercase" }}>Trading pair</span>
          <select onChange={(e) => setPairMode(e.target.value as "usdc" | "tolly" | "custom")} style={{ ...inp, marginTop: 6 }} value={pairMode}>
            <option value="usdc">USDC (native)</option>
            <option value="tolly">TOLLY</option>
            <option value="custom">Custom token…</option>
          </select>
        </label>
        <label className="arc-mono" style={{ fontSize: 12 }}>
          <span style={{ color: "var(--arc-muted)", textTransform: "uppercase" }}>Rewards paid in</span>
          <select disabled={rew === 0} onChange={(e) => setRewardMode(e.target.value as "quote" | "usdc" | "arct" | "custom")} style={{ ...inp, marginTop: 6 }} value={rewardMode}>
            <option value="quote">{pairMode === "usdc" ? "USDC (pair)" : `${quoteSym} (pair)`}</option>
            {pairMode !== "usdc" && <option value="usdc">USDC</option>}
            <option value="arct">$ARCT</option>
            <option value="custom">Custom token…</option>
          </select>
        </label>
      </div>
      {pairMode === "custom" && (
        <input onChange={(e) => setCustomQuote(e.target.value)} placeholder="pair token CA 0x… (18 decimals, must have a USDC pool on Arc)" style={inp} value={customQuote} />
      )}
      {pairMode !== "usdc" && (
        <p className="arc-mono" style={{ color: quotePrice ? "var(--arc-muted)" : "var(--arc-error)", fontSize: 11, margin: 0 }}>
          {quotePrice
            ? `1 ${quoteSym} ≈ $${quotePrice < 0.01 ? quotePrice.toFixed(8) : quotePrice.toFixed(4)}. Buyers pay in ${quoteSym}; ${isInstant ? "the Uniswap pool is" : "the curve and the graduation pool are"} ${quoteSym}/${symbol.trim().toUpperCase() || "TOKEN"}.`
            : quotePrice === 0 ? `${quoteSym} has no USDC pool on Arc — it cannot be priced, so it cannot be a pair.`
            : pairMode === "tolly" || /^0x[0-9a-fA-F]{40}$/.test(quoteAddr) ? "Pricing the pair token…" : "Enter the pair token address."}
        </p>
      )}
      {!isInstant && (
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>
          Graduation target: <span style={{ color: "var(--arc-cobalt)" }}>${targetUsd.toLocaleString()}</span>
          {pairMode !== "usdc" && targetQuoteUnits ? ` ≈ ${fmt(targetQuoteUnits)} ${quoteSym}` : ""} of real reserve. At that point the
          reserve and matching tokens move into a full-range Uniswap V3 pool and the LP is burned — liquidity is permanent.
        </p>
      )}
      {isInstant && (
        <>
          <input inputMode="decimal" onChange={(e) => setSeed(e.target.value.replace(",", "."))} placeholder={`initial liquidity in ${quoteSym} (min 100)`} style={inp} value={seed} />
          <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>
            No curve: 95% of supply + your {quoteSym} go straight into a Uniswap V3 pool at launch, LP burned. Taxes are not available in this mode (trades happen on Uniswap). 5% of supply still goes to ARCT stakers.
            {" "}<span style={{ color: "var(--arc-cobalt)" }}>Instant launch fee: {instantFee === null ? "…" : `${instantFee} USDC`}</span>, paid with the launch transaction{pairMode === "usdc" ? ` (total sent: seed + ${instantFee ?? 30} USDC)` : ` (in native USDC, on top of the ${quoteSym} seed)`}.
          </p>
        </>
      )}
      {rew > 0 && rewardMode === "custom" && (
        <input onChange={(e) => setCustomReward(e.target.value)} placeholder="reward token CA 0x… (must have a pool against the pair token)" style={inp} value={customReward} />
      )}
      {rew > 0 && rewardMode !== "quote" && (
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>
          Reward {quoteSym} is auto-swapped to the chosen token on Uniswap V3 each trade. No pool = rewards wait until one exists.
        </p>
      )}

      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>
        <span style={{ color: "var(--arc-cobalt)" }}>🎉 Curve launches are FREE</span> — you only pay network gas (a cent
        or less). 1B supply. 5% locked for ARCT stakers. Platform fee 1% per trade (10% of it flows to ARCT stakers).
        Total taxes: <span style={{ color: taxSum > 15 ? "var(--arc-error)" : "var(--arc-cobalt)" }}>{taxSum}%</span> (max 15%).
      </p>

      {error && <p className="arc-mono" style={{ color: "var(--arc-error)", fontSize: 13, margin: 0 }}>{error}</p>}
      <button className="arc-cta" disabled={!!busy} onClick={() => void launch()} style={{ border: "none", cursor: busy ? "wait" : "pointer" }} type="button">
        {busy ?? (wallet ? (isInstant ? `Launch on Uniswap (${instantFee ?? 30} USDC fee)` : "Launch token") : "Connect & launch")}
      </button>
    </div>
  );
}

function GasFaucet() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let w: string | null = null;
    try {
      w = localStorage.getItem("arctools_wallet");
    } catch { /* ignore */ }
    setWallet(w);
    const load = async (addr: string | null) => {
      try {
        const s = await gasStatus({ data: { wallet: addr ?? undefined } });
        setLeft(s.left);
        setClaimed(s.claimed);
      } catch { /* ignore */ }
    };
    void load(w);
    return onWalletChange((a) => {
      setWallet(a);
      void load(a);
    });
  }, []);

  if (left === null || left <= 0) return null;

  const claim = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const from = wallet ?? (await connectWallet());
      setWallet(from);
      const r = await gasClaim({ data: { wallet: from } });
      if (r.ok) {
        setClaimed(true);
        setLeft((l) => (l !== null ? l - 1 : l));
        setMsg("0.2 USDC gas sent — launch away! 🎉");
      } else {
        setMsg(r.reason ?? "claim failed");
      }
    } catch (e) {
      setMsg((e as Error).message.slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ alignItems: "center", border: "1px solid var(--arc-cobalt)", display: "flex", flexWrap: "wrap", gap: 12, margin: "0 0 16px", padding: "12px 16px" }}>
      <p className="arc-mono" style={{ flex: 1, fontSize: 12, margin: 0, minWidth: 200 }}>
        ⛽ <span style={{ color: "var(--arc-cobalt)" }}>First launches: gas on us.</span>{" "}
        We send 0.2 USDC of launch gas to your wallet — <b>{left} slot{left === 1 ? "" : "s"} left</b>.
      </p>
      {claimed ? (
        <span className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 12 }}>✅ claimed</span>
      ) : (
        <button className="arc-cta" disabled={busy} onClick={() => void claim()} style={{ border: "none", cursor: busy ? "wait" : "pointer", fontSize: 13, padding: "9px 16px" }} type="button">
          {busy ? "Sending..." : "Claim free gas"}
        </button>
      )}
      {msg && <p className="arc-mono" style={{ color: msg.includes("🎉") ? "var(--arc-cobalt)" : "var(--arc-error)", flexBasis: "100%", fontSize: 12, margin: 0 }}>{msg}</p>}
    </div>
  );
}

function LaunchpadPage() {
  const [items, setItems] = useState<PadListItem[]>([]);
  const [sort, setSort] = useState<"volume" | "tx" | "new">("volume");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await padList();
        if (alive) {
          setItems(res);
          setLoaded(true);
        }
      } catch { /* retry next tick */ }
    };
    void load();
    const t = setInterval(load, 12_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const view = [...items].sort((a, b) =>
    sort === "volume" ? b.volumeUsdc - a.volumeUsdc
    : sort === "tx" ? b.txCount - a.txCount
    : (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/launchpad" />
      <section className="arc-section" style={{ maxWidth: 860, paddingTop: 130 }}>
        <p className="arc-eyebrow">ArcToolsPad</p>
        <h1 className="arc-h2">Launch a token on Arc</h1>
        <p className="arc-body">
          One transaction: pick your taxes, add socials and a logo, and your token trades instantly on a USDC bonding
          curve. 5% of every launch is locked for <Link style={{ color: "var(--arc-cobalt)" }} to="/rewards">ARCT stakers</Link>.
        </p>

        <div style={{ margin: "26px 0" }}>
          <GasFaucet />
          <CreateForm />
        </div>

        <div style={{ alignItems: "baseline", display: "flex", gap: 14, justifyContent: "space-between", marginTop: 40 }}>
          <h2 className="arc-h3" style={{ margin: 0 }}>Trending on ArcToolsPad</h2>
          <div className="arc-mono" style={{ display: "flex", fontSize: 12, gap: 12 }}>
            {(["volume", "tx", "new"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                style={{
                  background: "none", border: "none", color: sort === s ? "var(--arc-cobalt)" : "var(--arc-muted)",
                  cursor: "pointer", textTransform: "uppercase",
                }}
                type="button"
              >
                {s === "volume" ? "Volume" : s === "tx" ? "Trades" : "Newest"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--arc-line)", marginTop: 12 }}>
          {view.map((t, i) => (
            <Link
              key={t.token}
              params={{ ca: t.token }}
              style={{
                alignItems: "center", borderBottom: "1px solid var(--arc-line)", color: "var(--arc-ink)",
                display: "flex", gap: 14, padding: "12px 4px", textDecoration: "none",
              }}
              to="/pad/$ca"
            >
              <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, width: 24 }}>{i + 1}</span>
              <span
                style={{
                  background: t.image ? `center/cover url(${t.image})` : "var(--arc-line)",
                  borderRadius: "50%", display: "inline-block", flexShrink: 0, height: 34, width: 34,
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.name} <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12 }}>{t.symbol}</span>
                </span>
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
                  MC ${fmt(t.pricePer1M * 1000)}
                </span>
              </span>
              <span className="arc-mono" style={{ fontSize: 12, textAlign: "right" }}>
                <span style={{ display: "block" }}>V ${fmt(t.volumeUsdc)}</span>
                <span style={{ color: "var(--arc-muted)" }}>{t.txCount} trades</span>
              </span>
            </Link>
          ))}
          {loaded && view.length === 0 && (
            <p className="arc-mono" style={{ fontSize: 13, padding: "18px 0" }}>
              No tokens yet. Yours can be first.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
