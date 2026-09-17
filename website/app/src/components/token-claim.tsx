import { useEffect, useState } from "react";

const API = "/bot";

type Props = { token: string; hasLogo: boolean };

/**
 * "Is this your token?" — the only honest way to give a plain Uniswap token its artwork.
 *
 * Tokens that never went through a launchpad carry no metadata anywhere: the contract has none, the explorer has
 * none, and guessing from a ticker is how wrong logos end up on the wrong token. So the deployer proves ownership
 * by signing a fixed message with the wallet that created the contract — no gas, no transaction — and the metadata
 * is applied immediately and locked, so no later automated guess can overwrite it.
 *
 * Anyone else can still suggest metadata; that path goes into a review queue instead of going live.
 */
export function TokenClaim({ token, hasLogo }: Props) {
  const [open, setOpen] = useState(false);
  const [deployer, setDeployer] = useState<string | null>(null);
  const [logo, setLogo] = useState("");
  const [x, setX] = useState("");
  const [tg, setTg] = useState("");
  const [web, setWeb] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/claim-message?token=${token}`)
      .then((r) => r.json())
      .then((j: { deployer?: string | null }) => setDeployer(j.deployer ?? null))
      .catch(() => null);
  }, [open, token]);

  const fields = () => ({
    ...(logo.trim() ? { logo: logo.trim() } : {}),
    ...(x.trim() ? { x_handle: x.trim() } : {}),
    ...(tg.trim() ? { tg_handle: tg.trim() } : {}),
    ...(web.trim() ? { domain: web.trim() } : {}),
    token,
  });

  const claim = async () => {
    setBusy(true); setMsg(null);
    try {
      const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!eth) throw new Error("no wallet in this browser");
      const [account] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const { message } = (await fetch(`${API}/api/claim-message?token=${token}`).then((r) => r.json())) as { message: string };
      const signature = (await eth.request({ method: "personal_sign", params: [message, account] })) as string;
      const res = await fetch(`${API}/api/token-claim`, {
        body: JSON.stringify({ ...fields(), signature }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; deployer?: string };
      if (j.ok) {
        setMsg({ kind: "ok", text: "Applied. The logo and links are live across the Terminal within a minute." });
      } else if (res.status === 403) {
        setMsg({ kind: "err", text: `That wallet did not deploy this token${j.deployer ? ` (deployer: ${j.deployer.slice(0, 10)}…)` : ""}. Use the suggest button instead.` });
      } else {
        setMsg({ kind: "err", text: j.error ?? "claim failed" });
      }
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message.slice(0, 120) });
    } finally {
      setBusy(false);
    }
  };

  const suggest = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API}/api/identity-suggest`, {
        body: JSON.stringify(fields()), headers: { "content-type": "application/json" }, method: "POST",
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      setMsg(j.ok
        ? { kind: "info", text: "Queued for review. A deployer signature would apply it instantly." }
        : { kind: "err", text: j.error ?? "could not queue" });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message.slice(0, 120) });
    } finally {
      setBusy(false);
    }
  };

  const input: React.CSSProperties = {
    background: "var(--arc-paper-deep)", border: "1px solid var(--arc-line)", borderRadius: 6,
    color: "var(--arc-ink)", fontSize: 12, padding: "6px 8px", width: "100%",
  };

  if (!open) {
    return (
      <button className="arc-mono" onClick={() => setOpen(true)} type="button"
        style={{ background: "transparent", border: "1px dashed var(--arc-line)", borderRadius: 6, color: "var(--arc-muted)",
                 cursor: "pointer", fontSize: 11, marginTop: 10, padding: "4px 9px" }}>
        {hasLogo ? "update this token's logo / socials" : "is this your token? add a logo and socials"}
      </button>
    );
  }

  return (
    <section className="arc-mono" style={{ border: "1px solid var(--arc-line)", borderRadius: 10, marginTop: 12, padding: "12px 14px" }}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--arc-ink)", fontSize: 12, letterSpacing: "0.06em" }}>TOKEN IDENTITY</span>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--arc-muted)", cursor: "pointer", fontSize: 14 }} type="button">✕</button>
      </div>
      <p style={{ color: "var(--arc-muted)", fontSize: 11, lineHeight: 1.5, margin: "6px 0 10px" }}>
        Sign a message with the wallet that deployed this token — no gas, no transaction — and it goes live at once.
        {deployer ? <> Deployer on record: <span style={{ color: "var(--arc-ink)" }}>{deployer.slice(0, 10)}…{deployer.slice(-6)}</span>.</> : null}
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <input onChange={(e) => setLogo(e.target.value)} placeholder="logo image URL (https://…png)" style={input} value={logo} />
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <input onChange={(e) => setX(e.target.value)} placeholder="X handle" style={input} value={x} />
          <input onChange={(e) => setTg(e.target.value)} placeholder="Telegram" style={input} value={tg} />
        </div>
        <input onChange={(e) => setWeb(e.target.value)} placeholder="website (https://…)" style={input} value={web} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button disabled={busy} onClick={() => void claim()} type="button"
          style={{ background: "var(--arc-cobalt)", border: "none", borderRadius: 6, color: "#fff", cursor: busy ? "wait" : "pointer", fontSize: 12, padding: "7px 13px" }}>
          {busy ? "signing…" : "claim as deployer"}
        </button>
        <button disabled={busy} onClick={() => void suggest()} type="button"
          style={{ background: "transparent", border: "1px solid var(--arc-line)", borderRadius: 6, color: "var(--arc-muted)", cursor: busy ? "wait" : "pointer", fontSize: 12, padding: "7px 13px" }}>
          suggest for review
        </button>
      </div>
      {msg && (
        <p style={{ color: msg.kind === "ok" ? "var(--arc-up)" : msg.kind === "err" ? "var(--arc-down)" : "var(--arc-muted)", fontSize: 11, marginTop: 8 }}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
