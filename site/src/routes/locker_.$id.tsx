import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { ARC_LOCKER, getLocks, type LockRow } from "@/lib/arc-locker";
import "../arc-site.css";

/** Public proof page for one lock — the link a project shares with its community, a buyer, an OTC counterparty.
 *  Everything on it is read from the contract at request time; nothing is stored by us. */
export const Route = createFileRoute("/locker_/$id")({
  loader: async ({ params }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 0) return { lock: null as LockRow | null, id };
    const [lock] = await getLocks([id]).catch(() => [] as LockRow[]);
    return { lock: lock ?? null, id };
  },
  head: ({ loaderData }) => {
    const l = loaderData?.lock;
    const what = l ? (l.label === "token" ? "Token lock" : l.label === "v2-lp" ? "V2 LP lock" : l.label === "v3-position" ? "Uniswap V3 position lock" : l.label === "v4-position" ? "Uniswap v4 position lock" : "NFT lock") : "Lock";
    const until = l ? new Date(l.unlockAt * 1000).toUTCString().slice(5, 16) : "";
    return { meta: [
      { title: l ? `ArcLocker #${l.id}: ${what} until ${until}` : "ArcLocker" },
      { name: "description", content: l ? `${what} on Arc, locked in ArcLocker until ${until}. Verifiable on-chain — no admin key can release it early.` : "ArcLocker proof page" },
      { property: "og:title", content: l ? `ArcLocker #${l.id} — ${what} until ${until}` : "ArcLocker" },
    ] };
  },
  component: LockPage,
});

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const fmt = (raw: string) => (Number(BigInt(raw) / 10n ** 12n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });

function LockPage() {
  const { lock: initial, id } = Route.useLoaderData();
  const [lock, setLock] = useState<LockRow | null>(initial);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!lock && Number.isInteger(id)) getLocks([id]).then(([l]) => setLock(l ?? null)).catch(() => null); }, [id, lock]);
  const now = Math.floor(Date.now() / 1000);
  const url = typeof location !== "undefined" ? location.href : `https://arctools.fun/locker/${id}`;
  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/locker" />
      <section className="arc-section" style={{ maxWidth: 820, paddingTop: 112 }}>
        <p className="arc-eyebrow">ARCLOCKER · LOCK #{id}</p>
        {!lock ? <p className="arc-body">{Number.isInteger(id) ? "No lock with this id (yet)." : "That is not a lock id."}</p> : (
          <>
            <h1 className="arc-h2" style={{ fontSize: 30 }}>
              {lock.label === "token" ? "Token lock" : lock.label === "v2-lp" ? "Uniswap V2 LP lock" : lock.label === "v3-position" ? "Uniswap V3 position lock" : lock.label === "v4-position" ? "Uniswap v4 position lock" : "NFT lock"}
              <span style={{ color: lock.withdrawn ? "var(--arc-muted)" : now >= lock.unlockAt ? "#22c580" : "#ffb054", fontSize: 16, marginLeft: 14 }}>
                {lock.withdrawn ? "withdrawn" : now >= lock.unlockAt ? "unlocked" : "locked"}
              </span>
            </h1>
            <div className="arc-mono" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--arc-line)", borderRadius: 14, display: "grid", fontSize: 13, gap: 10, padding: 20 }}>
              <Row k={lock.kind === "ERC20" ? "Amount" : "Position"} v={lock.kind === "ERC20" ? `${fmt(lock.amountOrId)} (of ${fmt(lock.initial)} locked)` : `#${lock.amountOrId}`} />
              <Row k="Asset" v={<a href={`/token/${lock.label === "token" ? lock.token0 : lock.asset}`} style={{ color: "var(--arc-cobalt)" }}>{lock.asset}</a>} />
              {lock.token1 && <Row k="Pair" v={<><a href={`/token/${lock.token0}`} style={{ color: "var(--arc-cobalt)" }}>{short(lock.token0)}</a> / <a href={`/token/${lock.token1}`} style={{ color: "var(--arc-cobalt)" }}>{short(lock.token1)}</a></>} />}
              <Row k="Locked since" v={when(lock.lockedAt)} />
              <Row k="Unlocks" v={<strong style={{ color: "var(--arc-ink)" }}>{when(lock.unlockAt)}</strong>} />
              {lock.kind === "ERC20" && lock.vestEnd > lock.unlockAt && <Row k="Vesting" v={`linear until ${when(lock.vestEnd)}`} />}
              <Row k="Lock owner" v={<a href={`/u/${lock.owner}`} style={{ color: "var(--arc-cobalt)" }}>{lock.owner}</a>} />
              <Row k="Contract" v={<a href={`https://arc-scan.org/address/${ARC_LOCKER}`} rel="noreferrer" style={{ color: "var(--arc-cobalt)" }} target="_blank">{ARC_LOCKER}</a>} />
            </div>
            <p className="arc-body" style={{ color: "var(--arc-muted)", fontSize: 13, marginTop: 14 }}>
              Read from the contract right now, not from a database. The unlock date can only be extended by the lock owner, never shortened. No admin key can release this lock early;
              the only emergency path returns the asset to the lock owner after a public 48-hour notice on-chain. Verify yourself: <code>getLocks([{lock.id}])</code> on the contract.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              <button className="arc-cta" onClick={() => { void navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }} type="button">{copied ? "Copied" : "Copy link"}</button>
              <a className="arc-mono" href={`https://x.com/intent/tweet?text=${encodeURIComponent(`Locked in ArcLocker until ${new Date(lock.unlockAt * 1000).toUTCString().slice(5, 16)} — verify on-chain: ${url}`)}`} rel="noreferrer" style={{ alignSelf: "center", color: "var(--arc-cobalt)", fontSize: 13 }} target="_blank">Share on X</a>
              <a className="arc-mono" href="/locker" style={{ alignSelf: "center", color: "var(--arc-muted)", fontSize: 13 }}>Lock yours</a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 12, justifyContent: "space-between" }}><span style={{ color: "var(--arc-muted)" }}>{k}</span><span style={{ textAlign: "right", wordBreak: "break-all" }}>{v}</span></div>;
}
