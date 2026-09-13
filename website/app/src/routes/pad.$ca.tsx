import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { padChart, padHolders, padMetaSet, padToken, padTrades, type PadChartPoint, type PadTokenPage, type PadTrade } from "@/lib/arcpad";
import {
  FN, PAD, connectWallet, ethCall, fileToSmallDataUrl, fmt, nativeBalance, onWalletChange, p32, pnum, sendTx, tokenBalance, waitReceipt,
} from "@/lib/arc-wallet";
import { Chart } from "./feed";
import "../arc-site.css";

export const Route = createFileRoute("/pad/$ca")({
  head: () => ({
    meta: [{ title: "ArcToolsPad token" }],
  }),
  component: PadTokenView,
});

const inp = {
  background: "transparent",
  border: "1px solid var(--arc-line)",
  color: "var(--arc-ink)",
  fontSize: 15,
  padding: "12px 14px",
  width: "100%",
} as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0, textTransform: "uppercase" }}>{label}</p>
      <p className="arc-mono" style={{ fontSize: 15, margin: "3px 0 0" }}>{value}</p>
    </div>
  );
}

/** Token creator can add/replace the logo and socials after launch. */
function CreatorMetaEditor({ t, wallet, onSaved }: { t: PadTokenPage; wallet: string; onSaved: () => void }) {
  const [img, setImg] = useState("");
  const [website, setWebsite] = useState(t.website ?? "");
  const [twitter, setTwitter] = useState(t.twitter ?? "");
  const [telegram, setTelegram] = useState(t.telegram ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // a launch whose metadata save failed leaves the logo + socials in localStorage → retry silently now that the creator is here
  useEffect(() => {
    const key = `arctools_padmeta_${t.token.toLowerCase()}`;
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { /* ignore */ }
    if (!raw) return;
    try {
      const pend = JSON.parse(raw) as { creator: string; image: string; telegram: string; twitter: string; website: string };
      if (pend.creator?.toLowerCase() !== wallet.toLowerCase()) return;
      setBusy(true); setMsg("Saving the logo & socials from your launch…");
      void padMetaSet({ data: { creator: wallet, image: pend.image, name: t.name, symbol: t.symbol, telegram: pend.telegram, token: t.token, twitter: pend.twitter, website: pend.website } })
        .then((r) => { const ok = (r as { ok: boolean }).ok; setMsg(ok ? "Logo & socials saved." : `Save failed: ${(r as { reason?: string }).reason ?? "unknown"}`); if (ok) { try { localStorage.removeItem(key); } catch { /* ignore */ } onSaved(); } })
        .catch(() => setMsg("Save failed: network")).finally(() => setBusy(false));
    } catch { /* corrupt entry */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.token, wallet]);

  const pick = async (f: File | null) => {
    if (!f) return;
    try {
      setImg(await fileToSmallDataUrl(f));
      setMsg(null);
    } catch {
      setMsg("Could not read that image — use JPG/PNG/WebP.");
    }
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await padMetaSet({
      data: {
        creator: wallet, image: img, name: t.name, symbol: t.symbol,
        telegram: telegram.trim(), token: t.token, twitter: twitter.trim(), website: website.trim(),
      },
    }).catch(() => ({ ok: false, reason: "network error" }));
    setBusy(false);
    const r = res as { ok: boolean; reason?: string };
    setMsg(r.ok ? "Saved. The logo shows up within ~15s (cache refresh)." : `Save failed: ${r.reason ?? "unknown"}`);
    if (r.ok) onSaved();
  };

  return (
    <div style={{ border: "1px solid var(--arc-line)", marginTop: 16, padding: 16 }}>
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "0 0 10px", textTransform: "uppercase" }}>
        Creator tools: logo & socials
      </p>
      <div style={{ alignItems: "start", display: "flex", flexWrap: "wrap", gap: 12 }}>
        <label
          style={{
            background: (img || t.image) ? `center/cover url(${img || t.image})` : "transparent",
            border: "1px dashed var(--arc-line)", color: "var(--arc-muted)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: 11, height: 72, width: 72,
          }}
        >
          {img || t.image ? "" : "+ logo"}
          <input accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0] ?? null)} type="file" />
        </label>
        <div className="arc-grid-3" style={{ flex: 1, minWidth: 220 }}>
          <input className="arc-mono" onChange={(e) => setWebsite(e.target.value)} placeholder="website" style={inp} value={website} />
          <input className="arc-mono" onChange={(e) => setTwitter(e.target.value)} placeholder="x.com/..." style={inp} value={twitter} />
          <input className="arc-mono" onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/..." style={inp} value={telegram} />
        </div>
      </div>
      {msg && <p className="arc-mono" style={{ color: msg.startsWith("Saved") ? "var(--arc-cobalt)" : "var(--arc-error)", fontSize: 12 }}>{msg}</p>}
      <button className="arc-cta" disabled={busy} onClick={() => void save()} style={{ border: "none", cursor: busy ? "wait" : "pointer", marginTop: 10 }} type="button">
        {busy ? "Saving..." : "Save logo & socials"}
      </button>
    </div>
  );
}

function PadTokenView() {
  const { ca } = Route.useParams();
  const [t, setT] = useState<PadTokenPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(3);
  const [quote, setQuote] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [txMsg, setTxMsg] = useState<string | null>(null);
  const [usdcBal, setUsdcBal] = useState<number | null>(null);
  const [tokBal, setTokBal] = useState<bigint | null>(null);
  const [claimableUsdc, setClaimableUsdc] = useState<number>(0);
  const [chart, setChart] = useState<PadChartPoint[]>([]);
  const [trades, setTrades] = useState<PadTrade[]>([]);
  const [holders, setHolders] = useState<{ count: number; top: { address: string; pct: number }[] } | null>(null);

  const refresh = useCallback(async () => {
    const res = await padToken({ data: { token: ca } }).catch(() => null);
    if (!res) return;
    if ("error" in res) setError(res.error);
    else setT(res);
  }, [ca]);

  const refreshBalances = useCallback(async (addr: string) => {
    try {
      setUsdcBal(await nativeBalance(addr));
      setTokBal(await tokenBalance(ca, addr));
      const cl = await ethCall(t?.padAddress ?? PAD, FN.claimable + p32(ca) + p32(addr));
      setClaimableUsdc(cl && cl !== "0x" ? Number(BigInt(cl) / 10n ** 12n) / 1e6 : 0);
    } catch { /* ignore */ }
  }, [ca]);

  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 10_000);
    const loadChart = async () => {
      try {
        setChart(await padChart({ data: { token: ca } }));
      } catch { /* ignore */ }
    };
    const loadSide = async () => {
      try {
        setTrades(await padTrades({ data: { token: ca } }));
        setHolders(await padHolders({ data: { token: ca } }));
      } catch { /* ignore */ }
    };
    void loadChart();
    void loadSide();
    const civ = setInterval(loadChart, 45_000);
    const siv = setInterval(loadSide, 20_000);
    try {
      const s = localStorage.getItem("arctools_wallet");
      if (s) {
        setWallet(s);
        void refreshBalances(s);
      }
    } catch { /* ignore */ }
    const offWallet = onWalletChange((a) => {
      setWallet(a);
      if (a) void refreshBalances(a);
    });
    return () => {
      clearInterval(iv);
      clearInterval(civ);
      clearInterval(siv);
      offWallet();
    };
  }, [refresh, refreshBalances, ca]);

  // live quote
  useEffect(() => {
    const n = Number(amount);
    if (!n || n <= 0) {
      setQuote(null);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const wei = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
        const sel = side === "buy" ? FN.quoteBuy : FN.quoteSell;
        const r = await ethCall(t?.padAddress ?? PAD, sel + p32(ca) + pnum(wei));
        setQuote(r && r !== "0x" ? Number(BigInt(r) / 10n ** 12n) / 1e6 : null);
      } catch {
        setQuote(null);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [amount, side, ca]);

  const connect = async () => {
    try {
      const a = await connectWallet();
      setWallet(a);
      void refreshBalances(a);
    } catch (e) {
      setError((e as Error).message.slice(0, 160));
    }
  };

  const swap = async () => {
    setTxMsg(null);
    setError(null);
    try {
      const from = wallet ?? (await connectWallet());
      setWallet(from);
      const n = Number(amount);
      if (!n || n <= 0) throw new Error("Enter an amount.");
      if (quote === null) throw new Error("No quote yet.");
      const minOut = BigInt(Math.round(quote * (1 - slippage / 100) * 1e6)) * 10n ** 12n;
      setBusy("Confirm in wallet...");
      let hash: string;
      if (side === "buy") {
        const value = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
        hash = await sendTx({ data: FN.buy + p32(ca) + pnum(minOut), from, to: t?.padAddress ?? PAD, value });
      } else {
        const tokensIn = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
        hash = await sendTx({ data: FN.sell + p32(ca) + pnum(tokensIn) + pnum(minOut), from, to: t?.padAddress ?? PAD });
      }
      setBusy("Waiting for confirmation...");
      const r = await waitReceipt(hash);
      if (Number(r.status) !== 1) throw new Error("Transaction reverted (slippage?).");
      setTxMsg(`${side === "buy" ? "Bought" : "Sold"} — tx confirmed.`);
      setAmount("");
      void refresh();
      void refreshBalances(from);
    } catch (e) {
      setError((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const claim = async () => {
    try {
      const from = wallet ?? (await connectWallet());
      const hash = await sendTx({ data: FN.claimRewards + p32(ca), from, to: t?.padAddress ?? PAD });
      await waitReceipt(hash);
      setTxMsg("Rewards claimed.");
      void refreshBalances(from);
    } catch (e) {
      setError((e as Error).message.slice(0, 160));
    }
  };

  const tokBalNum = tokBal !== null ? Number(tokBal / 10n ** 12n) / 1e6 : null;

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/launchpad" />
      <section className="arc-section" style={{ maxWidth: 860, paddingTop: 130 }}>
        <Link className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, textDecoration: "none" }} to="/launchpad">
          ← back to ArcToolsPad
        </Link>

        {error && !t && <p className="arc-mono" style={{ color: "var(--arc-error)" }}>{error}</p>}
        {t && (
          <>
            <div style={{ alignItems: "center", display: "flex", gap: 18, marginTop: 18 }}>
              <span style={{ background: t.image ? `center/cover url(${t.image})` : "var(--arc-line)", borderRadius: "50%", height: 64, width: 64 }} />
              <div>
                <h1 className="arc-h2" style={{ margin: 0 }}>
                  {t.name} <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 18 }}>{t.symbol}</span>
                </h1>
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "4px 0 0", wordBreak: "break-all" }}>{t.token}</p>
              </div>
            </div>

            <div className="arc-mono" style={{ display: "flex", flexWrap: "wrap", gap: 14, margin: "14px 0" }}>
              {t.website && <a href={t.website} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 12 }} target="_blank">Web</a>}
              {t.twitter && <a href={t.twitter.startsWith("http") ? t.twitter : `https://${t.twitter}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 12 }} target="_blank">𝕏</a>}
              {t.telegram && <a href={t.telegram.startsWith("http") ? t.telegram : `https://${t.telegram}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)", fontSize: 12 }} target="_blank">Telegram</a>}
              <a href={`https://arc-scan.org/address/${t.token}`} rel="noreferrer" style={{ color: "var(--arc-muted)", fontSize: 12 }} target="_blank">arc-scan</a>
            </div>

            <div style={{ border: "1px solid var(--arc-line)", display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", padding: 16 }}>
              <Stat label="Market cap" value={`$${fmt(t.pricePer1M * 1000)}`} />
              <Stat label="Price / 1M" value={`$${t.pricePer1M.toFixed(4)}`} />
              <Stat label="Volume" value={`$${fmt(t.volumeUsdc)}`} />
              <Stat label="Trades" value={String(t.txCount)} />
              <Stat label="Liquidity" value={`$${fmt(t.usdcReal)}`} />
              <Stat label="Holders" value={holders ? String(holders.count) : "…"} />
              <Stat label="Taxes M/R/B" value={`${t.marketingBps / 100}/${t.rewardsBps / 100}/${t.burnBps / 100}%`} />
            </div>

            {/* curve progress */}
            <div style={{ border: "1px solid var(--arc-line)", borderTop: "none", padding: "10px 16px" }}>
              <div className="arc-mono" style={{ display: "flex", fontSize: 11, justifyContent: "space-between" }}>
                <span style={{ color: "var(--arc-muted)" }}>CURVE PROGRESS</span>
                <span style={{ color: "var(--arc-cobalt)" }}>
                  {Math.min(100, (t.usdcReal / 10_000) * 100).toFixed(1)}% of $10K
                </span>
              </div>
              <div style={{ background: "var(--arc-line)", height: 6, marginTop: 6 }}>
                <div
                  style={{
                    background: "var(--arc-cobalt)", height: 6, transition: "width .6s",
                    width: `${Math.min(100, (t.usdcReal / 10_000) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div style={{ border: "1px solid var(--arc-line)", borderTop: "none", padding: "12px 16px" }}>
              <Chart points={chart} />
            </div>

            {/* swap card */}
            <div style={{ border: "1px solid var(--arc-cobalt)", marginTop: 22, padding: 20 }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                {(["buy", "sell"] as const).map((s) => (
                  <button
                    className="arc-mono"
                    key={s}
                    onClick={() => { setSide(s); setQuote(null); }}
                    style={{
                      background: side === s ? "var(--arc-cobalt)" : "transparent",
                      border: "1px solid var(--arc-cobalt)",
                      color: side === s ? "var(--arc-on-accent)" : "var(--arc-cobalt)",
                      cursor: "pointer", flex: 1, fontSize: 13, padding: "10px 0", textTransform: "uppercase",
                    }}
                    type="button"
                  >
                    {s}
                  </button>
                ))}
              </div>

              <input
                className="arc-mono"
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                placeholder={side === "buy" ? "USDC amount" : `${t.symbol} amount`}
                style={inp}
                value={amount}
              />
              {wallet && (
                <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "6px 0 0" }}>
                  Balance: {side === "buy"
                    ? `${usdcBal !== null ? usdcBal.toFixed(2) : "…"} USDC`
                    : `${tokBalNum !== null ? fmt(tokBalNum) : "…"} ${t.symbol}`}
                  {side === "sell" && tokBalNum !== null && tokBalNum > 0 && (
                    <button
                      onClick={() => setAmount(String(tokBalNum))}
                      style={{ background: "none", border: "none", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 11, marginLeft: 8 }}
                      type="button"
                    >
                      max
                    </button>
                  )}
                </p>
              )}

              <div className="arc-mono" style={{ alignItems: "center", display: "flex", gap: 8, margin: "12px 0" }}>
                <span style={{ color: "var(--arc-muted)", fontSize: 11, textTransform: "uppercase" }}>Slippage</span>
                {[1, 3, 5, 10].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSlippage(s)}
                    style={{
                      background: slippage === s ? "var(--arc-cobalt)" : "transparent",
                      border: "1px solid var(--arc-line)", color: slippage === s ? "var(--arc-on-accent)" : "var(--arc-muted)",
                      cursor: "pointer", fontSize: 11, padding: "4px 10px",
                    }}
                    type="button"
                  >
                    {s}%
                  </button>
                ))}
              </div>

              {quote !== null && (
                <p className="arc-mono" style={{ fontSize: 13, margin: "0 0 12px" }}>
                  ≈ {side === "buy" ? `${fmt(quote)} ${t.symbol}` : `${quote.toFixed(4)} USDC`}
                  <span style={{ color: "var(--arc-muted)" }}> (min {side === "buy" ? fmt(quote * (1 - slippage / 100)) : (quote * (1 - slippage / 100)).toFixed(4)})</span>
                </p>
              )}

              {error && t && <p className="arc-mono" style={{ color: "var(--arc-error)", fontSize: 12 }}>{error}</p>}
              {txMsg && <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 12 }}>{txMsg}</p>}

              {wallet ? (
                <button className="arc-cta" disabled={!!busy} onClick={() => void swap()} style={{ border: "none", cursor: busy ? "wait" : "pointer", width: "100%" }} type="button">
                  {busy ?? (side === "buy" ? `Buy ${t.symbol}` : `Sell ${t.symbol}`)}
                </button>
              ) : (
                <button className="arc-cta" onClick={() => void connect()} style={{ border: "none", cursor: "pointer", width: "100%" }} type="button">
                  Connect wallet
                </button>
              )}
            </div>

            {t.rewardsBps > 0 && (
              <div style={{ border: "1px solid var(--arc-line)", marginTop: 16, padding: 16 }}>
                <p className="arc-mono" style={{ fontSize: 12, margin: 0 }}>
                  💧 Holder rewards ({t.rewardsBps / 100}% of every trade, paid in USDC).
                  {wallet && ` Claimable: ${claimableUsdc.toFixed(4)} USDC`}
                </p>
                {wallet && claimableUsdc > 0 && (
                  <button className="arc-cta" onClick={() => void claim()} style={{ border: "none", cursor: "pointer", marginTop: 10 }} type="button">
                    Claim rewards
                  </button>
                )}
              </div>
            )}

            {/* creator metadata editor */}
            {wallet && t.creator && wallet.toLowerCase() === t.creator.toLowerCase() && (
              <CreatorMetaEditor onSaved={() => void refresh()} t={t} wallet={wallet} />
            )}

            {/* recent trades */}
            <h2 className="arc-h3" style={{ marginTop: 34 }}>Recent trades</h2>
            <div style={{ borderTop: "1px solid var(--arc-line)" }}>
              {trades.map((tr, i) => (
                <div
                  className="arc-mono"
                  key={i}
                  style={{
                    alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex",
                    fontSize: 12, gap: 12, padding: "9px 2px",
                  }}
                >
                  <span style={{ color: tr.side === "buy" ? "var(--arc-up)" : "var(--arc-error)", textTransform: "uppercase", width: 40 }}>
                    {tr.side}
                  </span>
                  <span style={{ width: 110 }}>${tr.usdc.toFixed(2)}</span>
                  <span style={{ color: "var(--arc-muted)", flex: 1 }}>{fmt(tr.tokens)} {t.symbol}</span>
                  <a
                    href={`https://arc-scan.org/address/${tr.trader}`}
                    rel="noreferrer"
                    style={{ color: "var(--arc-muted)", textDecoration: "none" }}
                    target="_blank"
                  >
                    {tr.trader.slice(0, 6)}…{tr.trader.slice(-4)}
                  </a>
                </div>
              ))}
              {trades.length === 0 && (
                <p className="arc-mono" style={{ fontSize: 12, padding: "12px 0" }}>No trades yet.</p>
              )}
            </div>

            {/* top holders */}
            {holders && holders.top.length > 0 && (
              <>
                <h2 className="arc-h3" style={{ marginTop: 30 }}>Top holders</h2>
                <div style={{ borderTop: "1px solid var(--arc-line)" }}>
                  {holders.top.map((h, i) => {
                    const tag =
                      (h.address.toLowerCase() === PAD.toLowerCase() || h.address.toLowerCase() === (t?.padAddress ?? "").toLowerCase()) ? " · bonding curve"
                      : h.address.toLowerCase() === "0x000000000000000000000000000000000000dead" ? " · burned"
                      : "";
                    return (
                      <div
                        className="arc-mono"
                        key={h.address}
                        style={{
                          alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex",
                          fontSize: 12, gap: 12, padding: "9px 2px",
                        }}
                      >
                        <span style={{ color: "var(--arc-muted)", width: 22 }}>{i + 1}</span>
                        <a
                          href={`https://arc-scan.org/address/${h.address}`}
                          rel="noreferrer"
                          style={{ color: "var(--arc-ink)", flex: 1, textDecoration: "none" }}
                          target="_blank"
                        >
                          {h.address.slice(0, 8)}…{h.address.slice(-6)}
                          <span style={{ color: "var(--arc-muted)" }}>{tag}</span>
                        </a>
                        <span>{h.pct.toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
