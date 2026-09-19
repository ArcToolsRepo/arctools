import { useEffect, useState } from "react";

import { BOT_API } from "@/lib/bot-api";

/** Left rail of the DexScreener-style token page: tools on top, then every launchpad we index.
 *
 *  The chains rail of the reference switches the world you are browsing. Ours does the same thing with the only
 *  axis that means anything on a single chain: the launchpad a token was born on. A click lands in the Terminal
 *  with that source already filtered, so the rail is navigation, not decoration.
 */
const TOOLS: [string, string, string][] = [
  ["star", "Watchlist", "/trade?tab=favs"],
  ["bell", "Alerts", "https://t.me/ArcToolsBuyBot"],
  ["grid", "Terminal", "/trade"],
  ["spark", "New pairs", "/trade?tab=new"],
  ["arrows", "Gainers & losers", "/trade?sort=chg"],
  ["eye", "Insiders", "/insiders"],
  ["swap", "Swap", "/swap"],
];

const TINT = ["#7c5cff", "#22c55e", "#f5c542", "#ff6ea9", "#2fd6c4", "#ff7ac6", "#7cc4ff", "#ff9f45",
  "#ffb3a7", "#5ee0a0", "#9aa6ff", "#6fd0ff", "#d6b35e", "#ff5e8a"];

function Icon({ kind }: { kind: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.6 };
  return (
    <svg aria-hidden height="15" viewBox="0 0 16 16" width="15">
      {kind === "star" && <path {...p} d="M8 2l1.8 3.9 4.2.5-3.1 2.8.9 4.2L8 11.4 4.2 13.4l.9-4.2L2 6.4l4.2-.5z" />}
      {kind === "bell" && <><path {...p} d="M4 6.5a4 4 0 118 0c0 3 1 4 1 4H3s1-1 1-4z" /><path {...p} d="M6.7 13a1.5 1.5 0 002.6 0" /></>}
      {kind === "grid" && <><rect {...p} height="5" rx="1" width="5" x="2" y="2" /><rect {...p} height="5" rx="1" width="5" x="9" y="2" /><rect {...p} height="5" rx="1" width="5" x="2" y="9" /><rect {...p} height="5" rx="1" width="5" x="9" y="9" /></>}
      {kind === "spark" && <path {...p} d="M2 12l3.6-5 2.7 3L14 3.5" />}
      {kind === "arrows" && <><path {...p} d="M4.5 13V3.5M4.5 3.5L2.4 5.8M4.5 3.5l2.1 2.3" /><path {...p} d="M11.5 3v9.5M11.5 12.5l2.1-2.3M11.5 12.5L9.4 10.2" /></>}
      {kind === "eye" && <><path {...p} d="M1.6 8S3.9 4.2 8 4.2 14.4 8 14.4 8 12.1 11.8 8 11.8 1.6 8 1.6 8z" /><circle {...p} cx="8" cy="8" r="1.7" /></>}
      {kind === "swap" && <><path {...p} d="M2.5 5.5h9M9.5 3.2l2.3 2.3-2.3 2.3" /><path {...p} d="M13.5 10.5h-9M6.5 8.2l-2.3 2.3 2.3 2.3" /></>}
    </svg>
  );
}

type PadRow = { pad: string; n: number };
type PadMeta = { key: string; label: string; url?: string | null; twitter?: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A launchpad's mark: its X avatar when we know the handle, else the favicon of its own site. Both fail → monogram. */
function padLogo(meta: PadMeta | undefined, name: string): string | null {
  if (meta?.twitter) return `https://unavatar.io/x/${meta.twitter}?fallback=false`;
  const host = meta?.url ? meta.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;
  if (host) return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  // venues that are not launchpads still have a home we can borrow a mark from
  const fallbackHost: Record<string, string> = {
    uniswapv3: "uniswap.org", uniswapv4: "uniswap.org", dyorswap: "dyorswap.finance",
    radardex: "radardex.pro", longsupply: "long.supply", stocks: "long.supply",
  };
  const h = fallbackHost[norm(name)];
  return h ? `https://www.google.com/s2/favicons?domain=${h}&sz=64` : null;
}

function PadMark({ meta, name, tint }: { meta: PadMeta | undefined; name: string; tint: string }) {
  const src = padLogo(meta, name);
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <i style={{ background: tint }}>{name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}</i>;
  return <img alt="" className="arc-dsp__padimg" loading="lazy" onError={() => setFailed(true)} src={src} />;
}

export function DsRail({ active }: { active?: string | null }) {
  const [pads, setPads] = useState<PadRow[]>([]);
  const [meta, setMeta] = useState<Record<string, PadMeta>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [chain, setChain] = useState<{ block?: number; lag?: number; swaps?: number; burned?: number }>({});

  useEffect(() => {
    let alive = true;
    fetch(`${BOT_API}/api/pads`).then((r) => r.json())
      .then((j: { rows?: PadMeta[] }) => {
        if (!alive || !j.rows) return;
        const m: Record<string, PadMeta> = {};
        for (const row of j.rows) { m[norm(row.key)] = row; m[norm(row.label)] = row; }
        setMeta(m);
      })
      .catch(() => { /* monograms remain */ });
    fetch("/api/padcounts").then((r) => r.json())
      .then((j: { rows?: PadRow[]; total?: number }) => { if (alive && j.rows) { setPads(j.rows.slice(0, 14)); setTotal(j.total ?? null); } })
      .catch(() => { /* the rail still renders its tools */ });
    const pullChain = () => {
      void fetch(`${BOT_API}/api/chain-status`).then((r) => r.json())
        .then((j: { last_block?: number; stale_s?: number }) => { if (alive) setChain((c) => ({ ...c, block: j.last_block, lag: j.stale_s })); })
        .catch(() => null);
      void fetch(`${BOT_API}/api/arct-burn`).then((r) => r.json())
        .then((j: { burned?: number }) => { if (alive) setChain((c) => ({ ...c, burned: j.burned })); })
        .catch(() => null);
    };
    pullChain();
    const id = setInterval(pullChain, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <aside className="arc-dsp__rail">
      <a className="arc-dsp__brand" href="/">
        <img alt="" src="/assets/brand/logo-mark.png" />
        ArcTools
      </a>

      <a className="arc-dsp__search" href="/trade">
        <svg aria-hidden height="13" viewBox="0 0 16 16" width="13"><circle cx="7" cy="7" fill="none" r="4.6" stroke="currentColor" strokeWidth="1.6" /><path d="M10.6 10.6L14 14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>
        Search token or CA
        <span>/</span>
      </a>

      <nav className="arc-dsp__tools">
        {TOOLS.map(([icon, label, href]) => (
          <a className="arc-dsp__tool" href={href} key={label} rel={href.startsWith("http") ? "noreferrer" : undefined} target={href.startsWith("http") ? "_blank" : undefined}>
            <Icon kind={icon} />
            {label}
          </a>
        ))}
      </nav>

      <div className="arc-dsp__padhead">
        <span>LAUNCHPADS</span>
        {total != null && <b>{total.toLocaleString("en-US")}</b>}
      </div>
      <div className="arc-dsp__pads">
        {pads.map((p, i) => {
          const on = !!active && norm(active) === norm(p.pad);
          return (
            <a className={"arc-dsp__pad" + (on ? " is-on" : "")} href={`/trade?pad=${encodeURIComponent(p.pad)}`} key={p.pad}>
              <PadMark meta={meta[norm(p.pad)]} name={p.pad} tint={TINT[i % TINT.length]} />
              <b>{p.pad}</b>
              <span>{p.n.toLocaleString("en-US")}</span>
            </a>
          );
        })}
        {pads.length === 0 && <p className="arc-dsp__hint">loading launchpads…</p>}
      </div>

      <div className="arc-dsp__net">
        <span className="arc-dsp__netlab">ARC NETWORK</span>
        <div><span>Block</span><b>{chain.block ? chain.block.toLocaleString("en-US") : "—"}</b></div>
        <div><span>Index lag</span><b style={{ color: (chain.lag ?? 0) < 120 ? "var(--arc-up)" : "#f5c542" }}>{chain.lag != null ? `${chain.lag}s` : "—"}</b></div>
        <div><span>ARCT burned</span><b style={{ color: "#f5c542" }}>{chain.burned ? `${(chain.burned / 1e6).toFixed(2)}M` : "—"}</b></div>
      </div>
    </aside>
  );
}
