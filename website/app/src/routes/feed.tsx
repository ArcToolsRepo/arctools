import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { ArcNav } from "@/components/arc-nav";
import { padList } from "@/lib/arcpad";
import {
  getMcaps,
  getPrice1m,
  listTokens,
  tokenChart,
  type ChartPoint,
  type PadToken,
} from "@/lib/arc-api";
import "../arc-site.css";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "Arc token explorer: every launchpad, live" },
      {
        name: "description",
        content:
          "All tokens on Arc with market caps, volume, filters and live charts: RadarDex, ArcPad, Warp and fresh Uniswap V3 pools.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: FeedPage,
});

const TABS = ["Top", "ArcToolsPad", "Tolly", "RadarDex", "ArcPad", "Warp", "New pools"] as const;
type Tab = (typeof TABS)[number];

function fmtUsd(n: number | null): string {
  if (n === null) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

type Candle = { open: number; high: number; low: number; close: number };

export function toCandles(points: ChartPoint[], maxCandles = 40): Candle[] {
  if (points.length === 0) return [];
  // sparse trading: one candle per trade (open = previous price) reads far
  // better than time-bucketing a handful of points into hairline dashes
  if (points.length <= 12) {
    const candles: Candle[] = [];
    let prev: number | null = null;
    for (const p of points) {
      const open = prev ?? p.price;
      candles.push({
        close: p.price,
        high: Math.max(open, p.price),
        low: Math.min(open, p.price),
        open,
      });
      prev = p.price;
    }
    return candles;
  }
  const n = Math.max(6, Math.min(maxCandles, points.length));
  const lo = points[0].block;
  const hi = points[points.length - 1].block + 1;
  const span = Math.max(1, hi - lo);
  const buckets: ChartPoint[][] = Array.from({ length: n }, () => []);
  for (const p of points) {
    const i = Math.min(n - 1, Math.floor(((p.block - lo) / span) * n));
    buckets[i].push(p);
  }
  const candles: Candle[] = [];
  let prevClose: number | null = null;
  for (const b of buckets) {
    if (b.length === 0) continue; // sparse data: skip empty buckets (no flat dashes)
    const prices = b.map((p) => p.price);
    const open = prevClose ?? prices[0];
    const close = prices[prices.length - 1];
    candles.push({ close, high: Math.max(...prices, open), low: Math.min(...prices, open), open });
    prevClose = close;
  }
  return candles;
}

export function Chart({ points }: { points: ChartPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "18px 0" }}>
        Not enough swaps yet for a chart.
      </p>
    );
  }
  const candles = toCandles(points);
  const W = 640;
  const H = 200;
  const PAD = 12;
  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  const span = max - min || 1;
  const y = (p: number) => H - PAD - ((p - min) / span) * (H - 2 * PAD);
  const slot = (W - 8) / candles.length;
  const bodyW = Math.max(5, Math.min(16, slot * 0.62));
  return (
    <div>
      <svg
        aria-label="price candles"
        preserveAspectRatio="none"
        role="img"
        style={{ display: "block", height: 200, width: "100%" }}
        viewBox={`0 0 ${W} ${H}`}
      >
        {candles.map((c, i) => {
          const cx = 4 + slot * i + slot / 2;
          const up = c.close >= c.open;
          const color = up ? "var(--arc-up)" : "var(--arc-error)";
          const top = y(Math.max(c.open, c.close));
          const bot = y(Math.min(c.open, c.close));
          return (
            <g key={i}>
              <line style={{ stroke: color, strokeWidth: 1.5 }} x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} />
              <rect
                height={Math.max(4, bot - top)}
                style={{ fill: color }}
                width={bodyW}
                x={cx - bodyW / 2}
                y={top}
              />
            </g>
          );
        })}
      </svg>
      <div className="arc-mono" style={{ color: "var(--arc-muted)", display: "flex", fontSize: 11, justifyContent: "space-between" }}>
        <span>low {fmtUsd(min)} / 1M</span>
        <span>high {fmtUsd(max)} / 1M</span>
      </div>
    </div>
  );
}

function TokenRow({ t }: { t: PadToken }) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState<ChartPoint[] | null>(null);
  const [price1m, setPrice1m] = useState<number | null>(null);
  const [chartErr, setChartErr] = useState(false);
  const [logoErr, setLogoErr] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && points === null) {
      try {
        const res = await tokenChart({ data: { pool: t.pool, token: t.token } });
        setPoints(res.points);
        setPrice1m(res.price1m);
        if (res.points.length === 0 && res.price1m === null) setChartErr(true);
      } catch {
        setPoints([]);
        setChartErr(true);
      }
    }
  };

  return (
    <div style={{ borderBottom: "1px solid var(--arc-line)" }}>
      <button
        onClick={() => void toggle()}
        style={{
          alignItems: "center",
          background: "transparent",
          border: "none",
          color: "var(--arc-ink)",
          cursor: "pointer",
          display: "flex",
          gap: 12,
          padding: "12px 0",
          textAlign: "left",
          width: "100%",
        }}
        type="button"
      >
        {t.logo && !logoErr ? (
          <img
            alt=""
            loading="lazy"
            onError={() => setLogoErr(true)}
            src={t.logo}
            style={{ borderRadius: "50%", height: 36, objectFit: "cover", width: 36 }}
          />
        ) : (
          <span
            className="arc-mono"
            style={{
              alignItems: "center",
              border: "1px solid var(--arc-line)",
              borderRadius: "50%",
              display: "inline-flex",
              fontSize: 14,
              height: 36,
              justifyContent: "center",
              width: 36,
            }}
          >
            {(t.symbol || "?").slice(0, 1)}
          </span>
        )}
        <span style={{ flex: "1 1 180px", minWidth: 150 }}>
          <strong style={{ fontSize: 15 }}>{t.name}</strong>
          <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, marginLeft: 8 }}>
            {t.symbol}
          </span>
        </span>
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, minWidth: 66 }}>
          {t.pad}
        </span>
        <span className="arc-mono" style={{ fontSize: 12, minWidth: 86, textAlign: "right" }}>
          {t.mcapUsd !== null ? `MC ${fmtUsd(t.mcapUsd)}` : ""}
        </span>
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, minWidth: 80, textAlign: "right" }}>
          {t.volUsd !== null ? `V ${fmtUsd(t.volUsd)}` : ""}
        </span>
        <span className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 11, minWidth: 34, textAlign: "right" }}>
          {ago(t.createdAt)}
        </span>
        <span className="arc-mono" style={{ color: "var(--arc-cobalt)", fontSize: 13 }}>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div style={{ border: "1px solid var(--arc-line)", marginBottom: 14, padding: 18 }}>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 10 }}>
            <code className="arc-mono" style={{ fontSize: 12, wordBreak: "break-all" }}>
              {t.token}
            </code>
            {price1m !== null && (
              <span className="arc-mono" style={{ fontSize: 13 }}>
                1M = {price1m.toFixed(4)} USDC
              </span>
            )}
          </div>
          {points === null ? (
            <p className="arc-mono" style={{ fontSize: 12 }}>
              Loading swaps...
            </p>
          ) : chartErr && points.length === 0 ? (
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, padding: "12px 0" }}>
              Chart unavailable right now. Try again in a moment.
            </p>
          ) : (
            <Chart points={points} />
          )}
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16 }}>
            <a
              className="arc-cta"
              href={`https://t.me/ArcSniper_bot?start=ca_${t.token.slice(2)}`}
              rel="noreferrer"
              style={{ fontSize: 13, padding: "9px 20px" }}
              target="_blank"
            >
              Buy in sniper
            </a>
            {t.venueUrl && (
              <a className="arc-link-tick" href={t.venueUrl} rel="noreferrer" target="_blank">
                Buy on {t.pad === "UniswapV3" ? "arc-scan" : t.pad}
              </a>
            )}
            <a className="arc-link-tick" href={`/scan?ca=${t.token}`}>
              Scan
            </a>
            {t.website && (
              <a className="arc-link-dotted" href={t.website} rel="noreferrer" target="_blank">
                web
              </a>
            )}
            {t.twitter && (
              <a className="arc-link-dotted" href={t.twitter} rel="noreferrer" target="_blank">
                x.com
              </a>
            )}
            {t.telegram && (
              <a className="arc-link-dotted" href={t.telegram} rel="noreferrer" target="_blank">
                telegram
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type SortKey = "newest" | "mcap" | "volume";

/** The official ArcTools token: pinned on top of every tab. */
const OFFICIAL: PadToken = {
  createdAt: "2026-09-09T10:12:53.699Z",
  logo: "https://i.ibb.co/xSh1WBWy/hf-20260909-062713-c61f9f46-e827-41b1-82e0-bb565b9c05b3.png",
  mcapUsd: null,
  name: "ArcTools",
  pad: "RadarDex",
  pool: "0xf89005ccf237a59eeee1521e74b15c7d8d022ab7",
  priceUsd: null,
  symbol: "ARCT",
  telegram: "https://t.me/ArcToolsPortal",
  token: "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52",
  twitter: "https://x.com/ArcChainTools",
  venueUrl: "https://radardex.pro/#0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52",
  volUsd: null,
  website: "https://arctools.fun",
};

function FeedPage() {
  const [tab, setTab] = useState<Tab>("Top");
  const [items, setItems] = useState<PadToken[]>([]);
  const [mcaps, setMcaps] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [notify, setNotify] = useState(false);
  const known = useRef<Set<string>>(new Set());

  // filters
  const [q, setQ] = useState("");
  const [minMc, setMinMc] = useState("");
  const [maxMc, setMaxMc] = useState("");
  const [minVol, setMinVol] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  // price watch
  const [watchCa, setWatchCa] = useState("");
  const [watchTarget, setWatchTarget] = useState("");
  const [watchNow, setWatchNow] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    known.current = new Set();
    const load = async () => {
      try {
        let res: PadToken[];
        const padToPadToken = (p: Awaited<ReturnType<typeof padList>>[number]): PadToken => ({
          createdAt: p.createdAt ? new Date(p.createdAt * 1000).toISOString() : null,
          logo: p.image,
          mcapUsd: p.pricePer1M > 0 ? p.pricePer1M * 1000 : null,
          name: p.name,
          pad: "ArcToolsPad",
          pool: null,
          priceUsd: null,
          symbol: p.symbol,
          telegram: p.telegram,
          token: p.token,
          twitter: p.twitter,
          venueUrl: `/pad/${p.token}`,
          volUsd: p.volumeUsdc,
          website: p.website,
        });
        if (tab === "Top") {
          const [radar, arcpad, tolly, pad] = await Promise.all([
            listTokens({ data: { pad: "RadarDex" } }),
            listTokens({ data: { pad: "ArcPad" } }),
            listTokens({ data: { pad: "Tolly" } }).catch(() => [] as PadToken[]),
            padList().catch(() => []),
          ]);
          res = [...pad.map(padToPadToken), ...tolly, ...radar, ...arcpad];
        } else if (tab === "New pools") {
          // fresh launches across EVERY launchpad, mixed
          const [radar, arcpad, warp, tolly, uni, pad] = await Promise.all([
            listTokens({ data: { pad: "RadarDex" } }).catch(() => [] as PadToken[]),
            listTokens({ data: { pad: "ArcPad" } }).catch(() => [] as PadToken[]),
            listTokens({ data: { pad: "Warp" } }).catch(() => [] as PadToken[]),
            listTokens({ data: { pad: "Tolly" } }).catch(() => [] as PadToken[]),
            listTokens({ data: { pad: "UniswapV3" } }).catch(() => [] as PadToken[]),
            padList().catch(() => []),
          ]);
          const seen = new Set<string>();
          res = [...pad.map(padToPadToken), ...radar, ...arcpad, ...warp, ...tolly, ...uni].filter((t) => {
            const k = t.token.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        } else if (tab === "ArcToolsPad") {
          const pad = await padList();
          res = pad.map(padToPadToken);
        } else {
          res = await listTokens({ data: { pad: tab } });
        }
        if (!alive) return;
        if (notify && known.current.size > 0 && typeof Notification !== "undefined") {
          for (const it of res.slice(0, 30)) {
            if (!known.current.has(it.token) && it.createdAt) {
              new Notification(`New on ${it.pad}: ${it.symbol}`, { body: it.token });
            }
          }
        }
        known.current = new Set(res.map((r) => r.token));
        setItems(res);
        setLoading(false);
      } catch {
        if (alive) setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [tab, notify]);

  // enrich market caps progressively (server caches + quotes per call)
  useEffect(() => {
    if (items.length === 0) return;
    let alive = true;
    const enrich = async () => {
      const need = items.filter((i) => i.mcapUsd === null && mcaps[i.token.toLowerCase()] === undefined);
      const wantOfficial = mcaps[OFFICIAL.token.toLowerCase()] === undefined;
      // keep the ranking alive: re-quote the current leaders every cycle
      const leaders = items.slice(0, 60).map((i) => i.token);
      if (need.length === 0 && leaders.length === 0 && !wantOfficial) return;
      try {
        const res = await getMcaps({
          data: { tokens: [OFFICIAL.token, ...leaders, ...need.slice(0, 540).map((i) => i.token)] },
        });
        if (alive) setMcaps((m) => ({ ...m, ...res }));
      } catch {
        /* retry on next tick */
      }
    };
    void enrich();
    const id = setInterval(enrich, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [items, mcaps]);

  useEffect(() => {
    if (!watching || !watchCa) return;
    let alive = true;
    const id = setInterval(async () => {
      const r = await getPrice1m({ data: { token: watchCa } });
      if (!alive) return;
      setWatchNow(r.price1m);
      const target = parseFloat(watchTarget);
      if (r.price1m !== null && target > 0 && r.price1m >= target && typeof Notification !== "undefined") {
        new Notification("Price target hit", { body: `${watchCa}: 1M = ${r.price1m.toFixed(2)} USDC` });
        setWatching(false);
      }
    }, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [watching, watchCa, watchTarget]);

  const enableNotify = async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotify(perm === "granted");
  };

  const view = useMemo(() => {
    const withMc = items.map((i) => ({
      ...i,
      mcapUsd: i.mcapUsd ?? mcaps[i.token.toLowerCase()] ?? null,
    }));
    const qq = q.trim().toLowerCase();
    const lo = parseFloat(minMc) || 0;
    const hi = parseFloat(maxMc) || Infinity;
    const vmin = parseFloat(minVol) || 0;
    let out = withMc.filter((i) => {
      if (qq && !(`${i.name} ${i.symbol} ${i.token}`.toLowerCase().includes(qq))) return false;
      if ((lo > 0 || hi < Infinity) && (i.mcapUsd === null || i.mcapUsd < lo || i.mcapUsd > hi)) return false;
      if (vmin > 0 && (i.volUsd === null || i.volUsd < vmin)) return false;
      return true;
    });
    // Top: default to a live market-cap ranking (re-sorts as fresh mcaps stream in)
    const sortKey: SortKey = tab === "Top" && sort === "newest" ? "mcap" : sort;
    if (sortKey === "mcap") out = out.sort((a, b) => (b.mcapUsd ?? -1) - (a.mcapUsd ?? -1));
    else if (sortKey === "volume")
      out = out.sort((a, b) => (b.volUsd ?? -1) - (a.volUsd ?? -1) || (b.mcapUsd ?? -1) - (a.mcapUsd ?? -1));
    else
      out = out.sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      );
    // New pools: only deploys from the last 15 minutes; fall back to newest when quiet
    if (tab === "New pools") {
      const cutoff = Date.now() - 15 * 60_000;
      const fresh = out.filter((i) => i.createdAt && new Date(i.createdAt).getTime() >= cutoff);
      out = fresh.length > 0 ? fresh : out.slice(0, 25);
    }
    return out;
  }, [items, mcaps, q, minMc, maxMc, minVol, sort, tab]);

  const shown = view.slice(0, 150);

  return (
    <main className="arc-site" style={{ minHeight: "100dvh" }}>
      <ArcNav active="/feed" />
      <section className="arc-section" style={{ paddingTop: 130 }}>
        <p className="arc-eyebrow">Live from chain 5042</p>
        <h1 className="arc-h2">The Arc token explorer</h1>
        <p className="arc-body">
          Every token, every launchpad: market caps, volume, filters and live charts from on-chain swaps. New deploys
          land here within seconds.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "24px 0 10px" }}>
          {TABS.map((t) => (
            <button
              className="arc-mono"
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? "var(--arc-cobalt)" : "transparent",
                border: "1px solid " + (tab === t ? "var(--arc-cobalt)" : "var(--arc-line)"),
                color: tab === t ? "var(--arc-on-accent)" : "var(--arc-ink)",
                cursor: "pointer",
                fontSize: 13,
                padding: "10px 18px",
              }}
              type="button"
            >
              {t}
            </button>
          ))}
          <button
            className="arc-mono"
            onClick={() => void enableNotify()}
            style={{
              background: "transparent",
              border: "1px solid var(--arc-line)",
              color: notify ? "var(--arc-cobalt)" : "var(--arc-muted)",
              cursor: "pointer",
              fontSize: 13,
              marginLeft: "auto",
              padding: "10px 16px",
            }}
            type="button"
          >
            {notify ? "🔔 alerts on" : "🔕 alert me on new deploys"}
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
          <input
            className="arc-mono"
            onChange={(e) => setQ(e.target.value)}
            placeholder="search name / symbol / CA"
            style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "2 1 220px", fontSize: 13, padding: "9px 12px" }}
            value={q}
          />
          <input
            className="arc-mono"
            inputMode="decimal"
            onChange={(e) => setMinMc(e.target.value)}
            placeholder="min MC $"
            style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 110px", fontSize: 13, padding: "9px 12px" }}
            value={minMc}
          />
          <input
            className="arc-mono"
            inputMode="decimal"
            onChange={(e) => setMaxMc(e.target.value)}
            placeholder="max MC $"
            style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 110px", fontSize: 13, padding: "9px 12px" }}
            value={maxMc}
          />
          <input
            className="arc-mono"
            inputMode="decimal"
            onChange={(e) => setMinVol(e.target.value)}
            placeholder="min vol $"
            style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 110px", fontSize: 13, padding: "9px 12px" }}
            value={minVol}
          />
          <select
            className="arc-mono"
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{ background: "var(--arc-paper)", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", fontSize: 13, padding: "9px 12px" }}
            value={sort}
          >
            <option value="newest">Newest</option>
            <option value="mcap">Market cap</option>
            <option value="volume">Volume</option>
          </select>
        </div>

        {loading ? (
          <p className="arc-mono" style={{ fontSize: 14, padding: "20px 0" }}>
            Loading {tab}...
          </p>
        ) : (
          <>
            <div className="arc-official">
              <span className="arc-official__badge arc-mono">⭐ OFFICIAL</span>
              <TokenRow t={{ ...OFFICIAL, mcapUsd: mcaps[OFFICIAL.token.toLowerCase()] ?? null }} />
            </div>
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, margin: "0 0 6px" }}>
              {shown.length} of {view.length} tokens{view.length > 150 ? " (narrow with filters or search)" : ""}. Market
              caps assume the 1B fixed launch supply.
            </p>
            <div style={{ borderTop: "1px solid var(--arc-line)" }}>
              {shown
                .filter((t) => t.token.toLowerCase() !== OFFICIAL.token.toLowerCase())
                .map((t) => (
                  <TokenRow key={`${t.pad}-${t.token}`} t={t} />
                ))}
              {shown.length === 0 && (
                <p className="arc-mono" style={{ fontSize: 14, padding: "20px 0" }}>
                  Nothing matches these filters.
                </p>
              )}
            </div>
          </>
        )}

        <div style={{ border: "1px solid var(--arc-line)", marginTop: 46, padding: 24 }}>
          <p className="arc-eyebrow">Price watch</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <input
              className="arc-mono"
              onChange={(e) => setWatchCa(e.target.value)}
              placeholder="token contract address"
              style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "2 1 320px", fontSize: 13, padding: "10px 12px" }}
              value={watchCa}
            />
            <input
              className="arc-mono"
              inputMode="decimal"
              onChange={(e) => setWatchTarget(e.target.value)}
              placeholder="target (USDC per 1M)"
              style={{ background: "transparent", border: "1px solid var(--arc-line)", color: "var(--arc-ink)", flex: "1 1 160px", fontSize: 13, padding: "10px 12px" }}
              value={watchTarget}
            />
            <button
              className="arc-mono"
              onClick={async () => {
                if (typeof Notification !== "undefined") await Notification.requestPermission();
                setWatching((w) => !w);
              }}
              style={{
                background: watching ? "var(--arc-cobalt)" : "transparent",
                border: "1px solid var(--arc-line)",
                color: watching ? "var(--arc-on-accent)" : "var(--arc-ink)",
                cursor: "pointer",
                fontSize: 13,
                padding: "10px 16px",
              }}
              type="button"
            >
              {watching ? "Watching..." : "Watch"}
            </button>
          </div>
          {watchNow !== null && (
            <p className="arc-mono" style={{ fontSize: 13, marginTop: 12 }}>
              1M now = {watchNow.toFixed(4)} USDC
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
