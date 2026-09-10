import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { vaultInfo } from "@/lib/arcpad";
import {
  ARCT, FN, VAULT, connectWallet, ethCall, fmt, onWalletChange, p32, pnum, sendTx, waitReceipt,
} from "@/lib/arc-wallet";
import "../arc-site.css";

export const Route = createFileRoute("/rewards")({
  head: () => ({
    meta: [
      { title: "ARCT staking: earn from every ArcToolsPad trade" },
      {
        name: "description",
        content:
          "Stake ARCT and earn USDC from ArcToolsPad trading fees plus 5% of the supply of every token launched on ArcToolsPad.",
      },
    ],
  }),
  component: RewardsPage,
});

type Info = Awaited<ReturnType<typeof vaultInfo>>;

const inp = {
  background: "transparent",
  border: "1px solid var(--arc-line)",
  color: "var(--arc-ink)",
  fontSize: 15,
  padding: "12px 14px",
  width: "100%",
} as const;

function RewardsPage() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"stake" | "withdraw">("stake");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (addr: string | null) => {
    try {
      setInfo(await vaultInfo({ data: { user: addr ?? undefined } }));
    } catch { /* retry */ }
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("arctools_wallet");
    } catch { /* ignore */ }
    setWallet(saved);
    void refresh(saved);
    const iv = setInterval(() => void refresh(saved), 15_000);
    const offWallet = onWalletChange((a) => {
      saved = a;
      setWallet(a);
      void refresh(a);
    });
    return () => {
      clearInterval(iv);
      offWallet();
    };
  }, [refresh]);

  const connect = async () => {
    try {
      const a = await connectWallet();
      setWallet(a);
      void refresh(a);
    } catch (e) {
      setError((e as Error).message.slice(0, 160));
    }
  };

  const run = async (fn: () => Promise<string>, doing: string, doneMsg: string) => {
    setError(null);
    setMsg(null);
    try {
      setBusy(doing);
      const hash = await fn();
      setBusy("Waiting for confirmation...");
      const r = await waitReceipt(hash);
      if (Number(r.status) !== 1) throw new Error("Transaction reverted.");
      setMsg(doneMsg);
      void refresh(wallet);
    } catch (e) {
      setError((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const stakeOrWithdraw = async () => {
    const from = wallet ?? (await connectWallet());
    setWallet(from);
    const n = Number(amount);
    if (!n || n <= 0) throw new Error("Enter an amount.");
    const wei = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
    if (mode === "stake") {
      // approve if needed
      const al = await ethCall(ARCT, "0xdd62ed3e" + p32(from) + p32(VAULT));
      if (!al || BigInt(al) < wei) {
        const h = await sendTx({ data: FN.approve + p32(VAULT) + "f".repeat(64), from, to: ARCT });
        await waitReceipt(h);
      }
      return sendTx({ data: FN.stake + pnum(wei), from, to: VAULT });
    }
    return sendTx({ data: FN.withdraw + pnum(wei), from, to: VAULT });
  };

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/rewards" />
      <section className="arc-section" style={{ maxWidth: 760, paddingTop: 130 }}>
        <p className="arc-eyebrow">ARCT staking</p>
        <h1 className="arc-h2">Earn from every ArcToolsPad trade</h1>
        <p className="arc-body">
          Stake <span className="arc-mono">$ARCT</span> and claim, whenever you like: a share of the platform fee from
          every ArcToolsPad trade (paid in native USDC) plus <b>5% of the supply of every token launched</b> on ArcToolsPad,
          split pro-rata at launch block.
        </p>

        <div style={{ border: "1px solid var(--arc-line)", display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", margin: "24px 0", padding: 16 }}>
          <div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>TOTAL STAKED</p>
            <p className="arc-mono" style={{ fontSize: 16, margin: "3px 0 0" }}>{info ? fmt(info.totalStaked) : "…"} ARCT</p>
          </div>
          <div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>YOUR STAKE</p>
            <p className="arc-mono" style={{ fontSize: 16, margin: "3px 0 0" }}>{info && wallet ? fmt(info.userStaked) : "—"} ARCT</p>
          </div>
          <div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>YOUR ARCT</p>
            <p className="arc-mono" style={{ fontSize: 16, margin: "3px 0 0" }}>{info && wallet ? fmt(info.userArct) : "—"}</p>
          </div>
          <div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>CLAIMABLE USDC</p>
            <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 16, margin: "3px 0 0" }}>
              {info && wallet ? info.userClaimableUsdc.toFixed(4) : "—"}
            </p>
          </div>
        </div>

        {!wallet ? (
          <button className="arc-cta" onClick={() => void connect()} style={{ border: "none", cursor: "pointer" }} type="button">
            Connect wallet
          </button>
        ) : (
          <div style={{ border: "1px solid var(--arc-cobalt)", padding: 20 }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              {(["stake", "withdraw"] as const).map((m) => (
                <button
                  className="arc-mono"
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    background: mode === m ? "var(--arc-cobalt)" : "transparent",
                    border: "1px solid var(--arc-cobalt)",
                    color: mode === m ? "var(--arc-on-accent)" : "var(--arc-cobalt)",
                    cursor: "pointer", flex: 1, fontSize: 13, padding: "10px 0", textTransform: "uppercase",
                  }}
                  type="button"
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              className="arc-mono"
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              placeholder="ARCT amount"
              style={inp}
              value={amount}
            />
            {error && <p className="arc-mono" style={{ color: "var(--arc-error)", fontSize: 12 }}>{error}</p>}
            {msg && <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 12 }}>{msg}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                className="arc-cta"
                disabled={!!busy}
                onClick={() => void run(stakeOrWithdraw, "Confirm in wallet...", mode === "stake" ? "Staked." : "Withdrawn.")}
                style={{ border: "none", cursor: busy ? "wait" : "pointer", flex: 1 }}
                type="button"
              >
                {busy ?? (mode === "stake" ? "Stake ARCT" : "Withdraw ARCT")}
              </button>
              {info && info.userClaimableUsdc > 0 && (
                <button
                  className="arc-cta"
                  disabled={!!busy}
                  onClick={() => void run(
                    async () => sendTx({ data: FN.claimUsdc, from: wallet, to: VAULT }),
                    "Claiming...", "USDC claimed.")}
                  style={{ border: "none", cursor: "pointer", flex: 1 }}
                  type="button"
                >
                  Claim USDC
                </button>
              )}
            </div>
          </div>
        )}

        <h2 className="arc-h3" style={{ marginTop: 40 }}>Launch drops (5% of each token)</h2>
        <div style={{ borderTop: "1px solid var(--arc-line)" }}>
          {(info?.drops ?? []).map((d) => (
            <div key={d.id} style={{ alignItems: "center", borderBottom: "1px solid var(--arc-line)", display: "flex", gap: 14, padding: "12px 0" }}>
              <span className="arc-mono" style={{ flex: 1, fontSize: 13 }}>
                {d.symbol} <span style={{ color: "var(--arc-muted)" }}>· {fmt(d.amount)} locked</span>
              </span>
              {wallet && d.claimable > 0 ? (
                <button
                  className="arc-cta"
                  onClick={() => void run(
                    async () => sendTx({ data: FN.claimDrop + pnum(BigInt(d.id)), from: wallet, to: VAULT }),
                    "Claiming...", `${d.symbol} claimed.`)}
                  style={{ border: "none", cursor: "pointer", fontSize: 12, padding: "7px 14px" }}
                  type="button"
                >
                  Claim {fmt(d.claimable)}
                </button>
              ) : (
                <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11 }}>
                  {wallet ? "nothing to claim" : ""}
                </span>
              )}
            </div>
          ))}
          {info && info.drops.length === 0 && (
            <p className="arc-mono" style={{ fontSize: 13, padding: "16px 0" }}>No launches yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}
