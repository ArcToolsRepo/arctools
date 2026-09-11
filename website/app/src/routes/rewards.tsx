import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { vaultInfo } from "@/lib/arcpad";
import {
  ARCT, FN, VAULT, VAULT_V2, connectWallet, ethCall, fmt, onWalletChange, p32, pnum, sendTx, waitReceipt,
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
  const [maxWei, setMaxWei] = useState<bigint | null>(null);
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

  /** Dokladne saldo w wei wprost z lancucha (bez zaokraglen z UI). */
  const exactMax = async (m: "stake" | "withdraw", from: string): Promise<bigint> => {
    const r =
      m === "stake"
        ? await ethCall(ARCT, FN.balanceOf + p32(from))
        : await ethCall(VAULT, FN.staked + p32(from));
    return r && r !== "0x" ? BigInt(r) : 0n;
  };

  const submit = async (wei: bigint, from: string): Promise<string> => {
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

  const stakeOrWithdraw = async () => {
    const from = wallet ?? (await connectWallet());
    setWallet(from);
    // gdy uzyto MAX, bierzemy dokladna kwote w wei — inaczej zaokraglenie
    // w drugą stronę odrzuca transakcje ("amount exceeds balance")
    if (maxWei !== null) {
      if (maxWei <= 0n) throw new Error(mode === "stake" ? "No ARCT in wallet." : "Nothing staked.");
      return submit(maxWei, from);
    }
    const n = Number(amount);
    if (!n || n <= 0) throw new Error("Enter an amount.");
    const wei = BigInt(Math.round(n * 1e6)) * 10n ** 12n;
    return submit(wei, from);
  };

  /** Migracja z vaulta v2: withdraw all -> approve v3 -> stake the same amount (3 tx). */
  const migrate = async () => {
    const from = wallet ?? (await connectWallet());
    setWallet(from);
    const r = await ethCall(VAULT_V2, FN.staked + p32(from));
    const wei = r && r !== "0x" ? BigInt(r) : 0n;
    if (wei <= 0n) throw new Error("Nothing staked in the old vault.");
    setBusy("1/3 Withdraw from old vault...");
    await waitReceipt(await sendTx({ data: FN.withdraw + pnum(wei), from, to: VAULT_V2 }));
    const al = await ethCall(ARCT, "0xdd62ed3e" + p32(from) + p32(VAULT));
    if (!al || BigInt(al) < wei) {
      setBusy("2/3 Approve ARCT...");
      await waitReceipt(await sendTx({ data: FN.approve + p32(VAULT) + "f".repeat(64), from, to: ARCT }));
    }
    setBusy("3/3 Stake in new vault...");
    return sendTx({ data: FN.stake + pnum(wei), from, to: VAULT });
  };

  /** Jedno klikniecie: cale saldo (stake) albo caly stake (withdraw). */
  const doAll = async () => {
    const from = wallet ?? (await connectWallet());
    setWallet(from);
    const wei = await exactMax(mode, from);
    if (wei <= 0n) throw new Error(mode === "stake" ? "No ARCT in wallet." : "Nothing staked.");
    setAmount((Number(wei / 10n ** 12n) / 1e6).toString());
    setMaxWei(wei);
    return submit(wei, from);
  };

  const fillMax = async () => {
    try {
      const from = wallet ?? (await connectWallet());
      setWallet(from);
      const wei = await exactMax(mode, from);
      setMaxWei(wei);
      setAmount((Number(wei / 10n ** 12n) / 1e6).toString());
    } catch (e) {
      setError((e as Error).message.slice(0, 160));
    }
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
            <p className="arc-mono" style={{ fontSize: 16, margin: "3px 0 0" }}>{info ? fmt(info.totalStaked + (info.legacyTotalStaked ?? 0)) : "…"} ARCT</p>
            {info && (info.legacyTotalStaked ?? 0) > 0 && (
              <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 10, margin: "2px 0 0" }}>
                {fmt(info.totalStaked)} new vault · {fmt(info.legacyTotalStaked ?? 0)} legacy
              </p>
            )}
          </div>
          <div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>YOUR STAKE</p>
            <p className="arc-mono" style={{ fontSize: 16, margin: "3px 0 0" }}>{info && wallet ? fmt(info.userStaked + (info.legacyStaked ?? 0)) : "—"} ARCT</p>
            {info && wallet && (info.legacyStaked ?? 0) > 0 && (
              <p className="arc-mono" style={{ color: "#e8a838", fontSize: 10, margin: "2px 0 0" }}>
                {fmt(info.legacyStaked ?? 0)} in legacy vault — migrate below
              </p>
            )}
          </div>
          <div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>YOUR ARCT</p>
            <p className="arc-mono" style={{ fontSize: 16, margin: "3px 0 0" }}>{info && wallet ? fmt(info.userArct) : "—"}</p>
          </div>
          <div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: 0 }}>CLAIMABLE USDC</p>
            <p className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 16, margin: "3px 0 0" }}>
              {info && wallet ? (info.userClaimableUsdc + (info.legacyClaimableUsdc ?? 0)).toFixed(4) : "—"}
            </p>
          </div>
        </div>

        {wallet && info && ((info.legacyStaked ?? 0) > 0 || (info.legacyClaimableUsdc ?? 0) > 0) && (
          <div className="arc-alert" style={{ marginBottom: 16 }}>
            <p className="arc-mono" style={{ fontSize: 12, margin: 0 }}>
              <b>Vault upgraded.</b> ArcToolsPad v3 (custom pairs, launch modes, Uniswap graduation) pays into a new vault.
              You still have <b>{fmt(info.legacyStaked ?? 0)} ARCT</b> staked in the old one
              {(info.legacyClaimableUsdc ?? 0) > 0 ? <> and <b>{(info.legacyClaimableUsdc ?? 0).toFixed(4)} USDC</b> to claim there</> : null}.
              Old drops stay claimable in the old vault; new launches drop only into the new one.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              <button className="arc-cta" disabled={!!busy || (info.legacyStaked ?? 0) <= 0}
                onClick={() => void run(migrate, "Migrating...", "Stake migrated to the new vault.")}
                style={{ border: "none", cursor: busy ? "wait" : "pointer", fontSize: 12, padding: "8px 14px" }} type="button">
                {busy ?? "Migrate stake to new vault (3 tx)"}
              </button>
              {(info.legacyClaimableUsdc ?? 0) > 0 && (
                <button className="arc-mono" disabled={!!busy}
                  onClick={() => void run(async () => sendTx({ data: FN.claimUsdc, from: wallet, to: VAULT_V2 }), "Claiming...", "Old-vault USDC claimed.")}
                  style={{ background: "transparent", border: "1px solid var(--arc-cobalt)", color: "var(--arc-cobalt)", cursor: "pointer", fontSize: 12, padding: "8px 14px" }} type="button">
                  Claim {(info.legacyClaimableUsdc ?? 0).toFixed(4)} USDC (old vault)
                </button>
              )}
            </div>
          </div>
        )}
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
                  onClick={() => {
                    setMode(m);
                    setMaxWei(null);   // MAX z poprzedniego trybu nie ma tu sensu
                    setAmount("");
                  }}
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
            <div style={{ position: "relative" }}>
              <input
                className="arc-mono"
                inputMode="decimal"
                onChange={(e) => {
                  setAmount(e.target.value.replace(",", "."));
                  setMaxWei(null); // reczna edycja anuluje tryb MAX
                }}
                placeholder="ARCT amount"
                style={{ ...inp, paddingRight: 74 }}
                value={amount}
              />
              <button
                className="arc-mono"
                onClick={() => void fillMax()}
                style={{
                  background: "transparent",
                  border: "1px solid var(--arc-cobalt)",
                  color: "var(--arc-cobalt)",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "4px 9px",
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
                title={mode === "stake" ? "Use your whole ARCT balance" : "Use your whole stake"}
                type="button"
              >
                MAX
              </button>
            </div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, margin: "6px 0 0" }}>
              {mode === "stake"
                ? `Available to stake: ${info && wallet ? fmt(info.userArct) : "—"} ARCT`
                : `Staked: ${info && wallet ? fmt(info.userStaked) : "—"} ARCT`}
              {maxWei !== null ? " · MAX selected (exact on-chain amount)" : ""}
            </p>
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
              {/* jedno klikniecie na cale saldo / caly stake — bez wpisywania kwoty */}
              <button
                className="arc-mono"
                disabled={
                  !!busy ||
                  (mode === "stake" ? (info?.userArct ?? 0) <= 0 : (info?.userStaked ?? 0) <= 0)
                }
                onClick={() => void run(doAll, "Confirm in wallet...", mode === "stake" ? "Everything staked." : "Everything withdrawn.")}
                style={{
                  background: "transparent",
                  border: "1px solid var(--arc-cobalt)",
                  color: "var(--arc-cobalt)",
                  cursor: busy ? "wait" : "pointer",
                  fontSize: 12,
                  padding: "0 16px",
                  whiteSpace: "nowrap",
                }}
                type="button"
              >
                {mode === "stake" ? "Stake all" : "Withdraw all"}
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
                {d.symbol} <span style={{ color: "var(--arc-muted)" }}>· {fmt(d.amount)} locked{d.legacy ? " · legacy vault" : ""}</span>
              </span>
              {wallet && d.claimable > 0 ? (
                <button
                  className="arc-cta"
                  onClick={() => void run(
                    async () => sendTx({ data: FN.claimDrop + pnum(BigInt(d.id)), from: wallet, to: d.vault ?? VAULT }),
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
