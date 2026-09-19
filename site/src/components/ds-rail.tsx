import { useEffect, useRef, useState } from "react";

import { BOT_API } from "@/lib/bot-api";
import { installV2LinkGuard } from "@/lib/v2-links";
import { VersionSwitch } from "@/components/version-switch";

/** Left rail of the DexScreener-style token page: tools on top, then every launchpad we index.
 *
 *  The chains rail of the reference switches the world you are browsing. Ours does the same thing with the only
 *  axis that means anything on a single chain: the launchpad a token was born on. A click lands in the Terminal
 *  with that source already filtered, so the rail is navigation, not decoration.
 */
// every destination stays inside the v2 preview, so the whole experience can be judged as one product
const TOOLS: [string, string, string][] = [
  ["grid", "Terminal", "/trade2"],
  ["swap", "Swap", "/swap2"],
  ["star", "Watchlist", "/trade2?tab=favs"],
  ["spark", "New pairs", "/trade2?tab=new"],
  ["arrows", "Gainers & losers", "/trade2?sort=chg"],
  ["eye", "Insiders", "/insiders2"],
  ["bell", "Alerts", "https://t.me/ArcToolsBuyBot"],
  ["wallet", "Trading wallet", "/trade2#wallet"],
];
const MORE: [string, string, string][] = [
  ["chart", "Portfolio", "/portfolio2"],
  ["wallet", "Wallets", "/wallets2"],
  ["gift", "Rewards", "/rewards2"],
  ["rocket", "Launchpad", "/launchpad2"],
  ["link", "Pay", "/pay2"],
  ["bridge", "Bridge", "/bridge2"],
  ["trophy", "Traders", "/leaderboard2"],
  ["scan", "Scanner", "/scan2"],
  ["radar", "Intel", "/intel2"],
  ["users", "Referrals", "/referrals2"],
  ["user", "Profile", "/profile2"],
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
      {kind === "chart" && <><path {...p} d="M2 13h12" /><path {...p} d="M4 11V7M7.5 11V4M11 11V8.5M14 11V5.5" /></>}
      {kind === "gift" && <><rect {...p} height="7" rx="1" width="12" x="2" y="6" /><path {...p} d="M8 6v7M2 9h12" /><path {...p} d="M8 6S6.5 2.8 5 3.6 6.4 6 8 6s3.4-1.6 2-2.4S8 6 8 6z" /></>}
      {kind === "rocket" && <><path {...p} d="M8 1.5s3.2 1.8 3.2 5.4c0 2-1 3.7-1.6 4.4H6.4C5.8 10.6 4.8 8.9 4.8 6.9 4.8 3.3 8 1.5 8 1.5z" /><path {...p} d="M6.4 11.3L5 14l2-1 1 1.5 1-1.5 2 1-1.4-2.7" /></>}
      {kind === "link" && <><path {...p} d="M6.8 9.2a2.6 2.6 0 010-3.7l2-2a2.6 2.6 0 013.7 3.7l-1 1" /><path {...p} d="M9.2 6.8a2.6 2.6 0 010 3.7l-2 2a2.6 2.6 0 01-3.7-3.7l1-1" /></>}
      {kind === "bridge" && <><path {...p} d="M1.5 11h13" /><path {...p} d="M3 11V8.5a5 5 0 0110 0V11" /><path {...p} d="M5.6 11V9.6M10.4 11V9.6M8 11V9" /></>}
      {kind === "trophy" && <><path {...p} d="M5 2.5h6v3a3 3 0 01-6 0z" /><path {...p} d="M5 3.4H3.2a2 2 0 002 2M11 3.4h1.8a2 2 0 01-2 2" /><path {...p} d="M8 8.5V11M6 13.5h4" /></>}
      {kind === "scan" && <><path {...p} d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3" /><path {...p} d="M2.5 8h11" /></>}
      {kind === "radar" && <><circle {...p} cx="8" cy="8" r="5.6" /><circle {...p} cx="8" cy="8" r="2.4" /><path {...p} d="M8 8l4-3.2" /></>}
      {kind === "users" && <><circle {...p} cx="6" cy="6" r="2.2" /><path {...p} d="M2.4 13c0-2 1.6-3.4 3.6-3.4S9.6 11 9.6 13" /><path {...p} d="M10.6 4.2a2.2 2.2 0 010 3.9M11.4 9.9c1.4.4 2.4 1.6 2.4 3.1" /></>}
      {kind === "user" && <><circle {...p} cx="8" cy="5.6" r="2.6" /><path {...p} d="M3.2 13.2c0-2.4 2.1-4 4.8-4s4.8 1.6 4.8 4" /></>}
      {kind === "wallet" && <><rect {...p} height="8" rx="2" width="12" x="2" y="5" /><path {...p} d="M11 9h2" /><path {...p} d="M2 6.5V4.5a1 1 0 011-1h8" /></>}
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

  // v2 must not hand the visitor back to v1 through a shared component's link
  useEffect(installV2LinkGuard, []);

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
      .then((j: { rows?: PadRow[]; total?: number }) => { if (alive && j.rows) { setPads(j.rows); setTotal(j.total ?? null); } })
      .catch(() => { /* the rail still renders its tools */ });
    const pullChain = () => {
      void fetch(`${BOT_API}/api/chain-status`).then((r) => r.json())
        .then((j: { last_block?: number; stale_s?: number; index_lag_s?: number | null }) => { if (alive) setChain((c) => ({ ...c, block: j.last_block, lag: j.index_lag_s ?? j.stale_s })); })
        .catch(() => null);
      void fetch(`${BOT_API}/api/arct-burn`).then((r) => r.json())
        .then((j: { burned?: number }) => { if (alive) setChain((c) => ({ ...c, burned: j.burned })); })
        .catch(() => null);
    };
    pullChain();
    const id = setInterval(pullChain, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className="arc-dsp__rail">
      <div className="arc-dsp__top">
        <VersionSwitch />
      </div>
      <a className="arc-dsp__brand" href="/">
        <img alt="" src="/assets/brand/logo-mark.png" />
        ArcTools
      </a>

      <form
        className="arc-dsp__search"
        onSubmit={(e) => {
          e.preventDefault();
          const v = query.trim();
          if (!v) return;
          // a bare CA goes straight to its token page; anything else searches the Terminal list
          window.location.assign(/^0x[0-9a-fA-F]{40}$/.test(v) ? `/token2/${v.toLowerCase()}` : `/trade2?q=${encodeURIComponent(v)}`);
        }}
      >
        <svg aria-hidden height="13" viewBox="0 0 16 16" width="13"><circle cx="7" cy="7" fill="none" r="4.6" stroke="currentColor" strokeWidth="1.6" /><path d="M10.4 10.4 L14 14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>
        <input
          aria-label="Search token or CA"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search token or CA"
          ref={searchRef}
          value={query}
        />
        <span>/</span>
      </form>

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
            <a className={"arc-dsp__pad" + (on ? " is-on" : "")} href={`/trade2?pad=${encodeURIComponent(p.pad)}`} key={p.pad}>
              <PadMark meta={meta[norm(p.pad)]} name={p.pad} tint={TINT[i % TINT.length]} />
              <b>{p.pad}</b>
              <span>{p.n.toLocaleString("en-US")}</span>
            </a>
          );
        })}
        {pads.length === 0 && <p className="arc-dsp__hint">loading launchpads…</p>}
      </div>

      <div className="arc-dsp__morehead"><span>MORE</span></div>
      <nav className="arc-dsp__tools arc-dsp__tools--more">
        {MORE.map(([icon, label, href]) => (
          <a className="arc-dsp__tool" href={href} key={href}><Icon kind={icon} />{label}</a>
        ))}
      </nav>

      <div className="arc-dsp__net">
        <span className="arc-dsp__netlab">ARC NETWORK</span>
        <div><span>Block</span><b>{chain.block ? chain.block.toLocaleString("en-US") : "—"}</b></div>
        <div><span>Index lag</span><b style={{ color: (chain.lag ?? 0) < 15 ? "var(--arc-up)" : (chain.lag ?? 0) < 60 ? "#f5c542" : "var(--arc-down)" }} title="How far the swap index trails the chain head">{chain.lag != null ? `${chain.lag}s` : "—"}</b></div>
        <div><span>ARCT burned</span><b style={{ color: "#f5c542" }}>{chain.burned ? `${(chain.burned / 1e6).toFixed(2)}M` : "—"}</b></div>
      </div>
    </aside>
  );
}
