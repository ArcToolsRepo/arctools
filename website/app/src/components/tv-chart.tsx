import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * TradingView-grade chart on lightweight-charts v5.
 *
 * - chart types: candles · hollow · bars · line · area · Heikin Ashi
 * - indicators: MA20/50, EMA20/50/200, Bollinger, VWAP, Volume MA, RSI pane, MACD pane — values in the legend
 * - drawing tools (persisted per token+timeframe): horizontal level, trend line, ray, Fibonacci retracement,
 *   measure (Δ% / Δ$ / bars / time), undo, clear
 * - scale: log / linear / percent, auto-fit, jump to realtime, magnet crosshair
 * - fullscreen, PNG screenshot (with watermark), countdown to next bar, last-price line
 * - theme aware (dark/light via html[data-theme]) · SSR-safe (lib imported on the client only)
 */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; vb: number; n: number };
/** Badge drawn on a bar: DB/DS = dev buy/sell, IB/IS = insider, PB/PS = pro wallet (75%+ win rate). */
export type ChartMarker = { t: number; side: "buy" | "sell"; kind: "dev" | "insider" | "pro" | "kol"; text: string; title?: string };
/** KOL avatar pinned above the bar where the tweet happened (HTML overlay — the chart lib cannot draw images). */
export type ChartAvatar = { t: number; url: string; title: string; href: string; label: string };

type LW = typeof import("lightweight-charts");
type UTC = import("lightweight-charts").UTCTimestamp;
type Pt = { time: UTC; value: number };

type Props = {
  candles: Candle[];
  /** multiply price1m by this to get the displayed unit (1e-6 for price/token, supply/1e6 for mcap) */
  scale: number;
  mode: "price" | "mcap";
  height?: number;
  markers?: ChartMarker[];
  avatars?: ChartAvatar[];
  /** how many markers fall inside the loaded candle range (the rest are older than the chart) */
  onVisible?: (n: number) => void;
  /** legend header, e.g. "LONG/USDC" */
  symbol?: string;
  /** timeframe label ("5m") — used in the legend, the countdown and the drawings storage key */
  interval?: string;
  /** drawings persist under this key (token address) */
  storageKey?: string;
  /** open orders drawn as horizontal lines (price in USDC per token; scaled like candles) */
  orderLines?: { price: number; color: string; title: string }[];
};

type ChartType = "candles" | "hollow" | "bars" | "line" | "area" | "heikin";
type Ind = "ma20" | "ma50" | "ema20" | "ema50" | "ema200" | "bb" | "vwap" | "volma" | "rsi" | "macd";
type Tool = "none" | "level" | "trend" | "ray" | "fib" | "measure";
type Drawing =
  | { kind: "level"; p: number }
  | { kind: "trend" | "ray"; t1: number; p1: number; t2: number; p2: number }
  | { kind: "fib"; t1: number; p1: number; t2: number; p2: number };

const IND_LABEL: Record<Ind, string> = { ma20: "MA 20", ma50: "MA 50", ema20: "EMA 20", ema50: "EMA 50", ema200: "EMA 200", bb: "BB 20·2", vwap: "VWAP", volma: "Vol MA 20", rsi: "RSI 14", macd: "MACD 12·26·9" };
const IND_COLOR: Record<string, string> = { ma20: "#f5c542", ma50: "#ff8a3d", ema20: "#2e7cff", ema50: "#22c580", ema200: "#ffffff", bbu: "rgba(155,123,255,0.85)", bbm: "rgba(155,123,255,0.45)", bbl: "rgba(155,123,255,0.85)", vwap: "#ff5fd2", volma: "#f5c542", rsi: "#9b7bff", macd: "#2e7cff", macds: "#ff8a3d" };
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const DEFAULT_IND: Record<Ind, boolean> = { ma20: false, ma50: false, ema20: false, ema50: false, ema200: false, bb: false, vwap: false, volma: false, rsi: false, macd: false };

const fmtAxis = (v: number, mode: "price" | "mcap"): string => {
  if (mode === "mcap") {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  }
  if (v === 0) return "$0";
  if (v < 0) return `-${fmtAxis(-v, mode)}`;
  if (v >= 1) return `$${v.toFixed(4)}`;
  const digits = Math.min(10, Math.max(4, -Math.floor(Math.log10(v)) + 3));
  return `$${v.toFixed(digits)}`;
};
const fmtVol = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
const fmtDur = (s: number) => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}:${String(x).padStart(2, "0")}`; };

const MARKER_COLOR: Record<ChartMarker["kind"], { buy: string; sell: string }> = {
  dev: { buy: "#22c580", sell: "#f0534f" },
  insider: { buy: "#2e7cff", sell: "#ff8a3d" },
  pro: { buy: "#9b7bff", sell: "#f5c542" },
  kol: { buy: "#ff5fd2", sell: "#ff5fd2" },
};

function themeColors() {
  const light = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
  return light
    ? { text: "#5c6880", grid: "rgba(15,21,34,0.08)", gridV: "rgba(15,21,34,0.05)", border: "rgba(15,21,34,0.18)", wm: "rgba(15,21,34,0.06)", up: "#16a34a", down: "#dc2626", light }
    : { text: "#7c889e", grid: "rgba(60,70,90,0.18)", gridV: "rgba(60,70,90,0.10)", border: "rgba(60,70,90,0.35)", wm: "rgba(150,170,200,0.07)", up: "#22c580", down: "#f0534f", light };
}

export function TvChart({ candles, scale, mode, height = 440, markers, avatars, onVisible, symbol, interval, storageKey, orderLines }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<import("lightweight-charts").IChartApi | null>(null);
  const mainRef = useRef<import("lightweight-charts").ISeriesApi<"Candlestick" | "Bar" | "Line" | "Area"> | null>(null);
  const volRef = useRef<import("lightweight-charts").ISeriesApi<"Histogram"> | null>(null);
  const markRef = useRef<import("lightweight-charts").ISeriesMarkersPluginApi<import("lightweight-charts").Time> | null>(null);
  const lwRef = useRef<LW | null>(null);
  const indSeries = useRef<Record<string, import("lightweight-charts").ISeriesApi<"Line" | "Histogram">>>({});
  const drawSeries = useRef<{ lines: import("lightweight-charts").ISeriesApi<"Line">[]; priceLines: { s: import("lightweight-charts").ISeriesApi<"Candlestick" | "Bar" | "Line" | "Area">; l: import("lightweight-charts").IPriceLine }[] }>({ lines: [], priceLines: [] });

  const [hover, setHover] = useState<{ t: number; o: number; h: number; l: number; c: number; v: number } | null>(null);
  const [indVals, setIndVals] = useState<Record<string, number | null>>({});
  const lastIndRef = useRef<Record<string, number | null>>({});
  const [pins, setPins] = useState<{ x: number; y: number; a: ChartAvatar }[]>([]);
  const [rangeTick, setRangeTick] = useState(0);
  const [ready, setReady] = useState(false);
  const [ctype, setCtype] = useState<ChartType>(() => { try { return (localStorage.getItem("arc_chart_type") as ChartType) || "candles"; } catch { return "candles"; } });
  const [ind, setInd] = useState<Record<Ind, boolean>>(() => { try { return { ...DEFAULT_IND, ...(JSON.parse(localStorage.getItem("arc_chart_ind") || "{}") as Partial<Record<Ind, boolean>>) }; } catch { return { ...DEFAULT_IND }; } });
  const [scaleMode, setScaleMode] = useState<"log" | "lin" | "pct">(() => { try { return (localStorage.getItem("arc_chart_scale") as "log" | "lin" | "pct") || "log"; } catch { return "log"; } });
  const [magnet, setMagnet] = useState(false);
  const [tool, setTool] = useState<Tool>("none");
  const toolRef = useRef<Tool>("none");
  const pendingRef = useRef<{ t: number; p: number } | null>(null);
  const [pending, setPending] = useState<{ t: number; p: number } | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [measure, setMeasure] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const [fs, setFs] = useState(false);
  const [indOpen, setIndOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [theme, setTheme] = useState(() => themeColors());
  const [h, setH] = useState<number>(() => { try { const v = Number(localStorage.getItem("arc_chart_h")); return v >= 260 && v <= 1400 ? v : height; } catch { return height; } });
  const dragRef = useRef<{ y0: number; h0: number } | null>(null);
  const onHandleDown = (e: React.PointerEvent) => { dragRef.current = { y0: e.clientY, h0: h }; (e.target as HTMLElement).setPointerCapture(e.pointerId); };
  const onHandleMove = (e: React.PointerEvent) => { const d = dragRef.current; if (!d) return; setH(Math.max(260, Math.min(1400, d.h0 + (e.clientY - d.y0)))); };
  const onHandleUp = () => { if (!dragRef.current) return; dragRef.current = null; try { localStorage.setItem("arc_chart_h", String(h)); } catch { /* ignore */ } };
  useEffect(() => { try { localStorage.setItem("arc_chart_h", String(h)); } catch { /* ignore */ } }, [h]);

  const dkey = storageKey ? `arc_draw:${storageKey.toLowerCase()}:${interval ?? "x"}` : null;
  const scaleRef = useRef(scale); const modeRef = useRef(mode); const stepRef = useRef(60); const candlesRef = useRef(candles); const drawingsRef = useRef<Drawing[]>([]);
  const step = useMemo(() => (candles.length > 1 ? candles[1].t - candles[0].t : 60), [candles]);
  const times = useMemo(() => candles.map((k) => k.t), [candles]);
  const snapT = useCallback((t: number) => { if (!times.length) return t; let lo = 0, hi = times.length - 1; if (t <= times[0]) return times[0]; if (t >= times[hi]) return times[hi]; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid] <= t) lo = mid; else hi = mid - 1; } return times[lo]; }, [times]);

  // ---- persist prefs
  const toggleInd = (k: Ind) => setInd((o) => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem("arc_chart_ind", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  useEffect(() => { try { localStorage.setItem("arc_chart_type", ctype); } catch { /* ignore */ } }, [ctype]);
  useEffect(() => { try { localStorage.setItem("arc_chart_scale", scaleMode); } catch { /* ignore */ } }, [scaleMode]);
  useEffect(() => { if (!dkey) return; try { setDrawings(JSON.parse(localStorage.getItem(dkey) || "[]") as Drawing[]); } catch { setDrawings([]); } }, [dkey]);
  const saveDrawings = (d: Drawing[]) => { drawingsRef.current = d; setDrawings(d); if (dkey) { try { localStorage.setItem(dkey, JSON.stringify(d)); } catch { /* ignore */ } } };
  useEffect(() => { toolRef.current = tool; if (tool === "none") { pendingRef.current = null; setPending(null); } }, [tool]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(themeColors()));
    mo.observe(document.documentElement, { attributeFilter: ["data-theme"], attributes: true });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setTool("none"); setMeasure(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && (document.activeElement === document.body || wrap.current?.contains(document.activeElement))) { saveDrawings(drawings.slice(0, -1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings, dkey]);
  useEffect(() => { const h = () => setFs(!!document.fullscreenElement); document.addEventListener("fullscreenchange", h); return () => document.removeEventListener("fullscreenchange", h); }, []);

  // ---- create chart once
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let clickCleanup: (() => void) | null = null;
    void (async () => {
      const lw = await import("lightweight-charts");
      if (disposed || !box.current) return;
      const th = themeColors();
      const chart = lw.createChart(box.current, {
        autoSize: true,
        crosshair: { mode: lw.CrosshairMode.Normal, vertLine: { labelBackgroundColor: "#2e7cff" }, horzLine: { labelBackgroundColor: "#2e7cff" } },
        grid: { horzLines: { color: th.grid }, vertLines: { color: th.gridV } },
        layout: { attributionLogo: false, background: { color: "transparent", type: lw.ColorType.Solid }, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, textColor: th.text, panes: { separatorColor: th.border, separatorHoverColor: "rgba(46,124,255,0.3)", enableResize: true } },
        rightPriceScale: { borderColor: th.border, scaleMargins: { bottom: 0.22, top: 0.08 } },
        timeScale: { borderColor: th.border, rightOffset: 6, secondsVisible: false, timeVisible: true },
        localization: { timeFormatter: (t: number) => new Date(t * 1000).toLocaleString(undefined, { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "short" }) },
      });
      const vs = chart.addSeries(lw.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { bottom: 0, top: 0.82 } });
      chart.subscribeCrosshairMove((p) => {
        if (!p.time || !p.seriesData.size) { setHover(null); setIndVals(lastIndRef.current); return; }
        const m = mainRef.current;
        const d = m ? (p.seriesData.get(m) as { open?: number; high?: number; low?: number; close?: number; value?: number } | undefined) : undefined;
        const v = p.seriesData.get(vs) as { value: number } | undefined;
        if (d) setHover({ t: Number(p.time), o: d.open ?? d.value ?? 0, h: d.high ?? d.value ?? 0, l: d.low ?? d.value ?? 0, c: d.close ?? d.value ?? 0, v: v?.value ?? 0 });
        const iv: Record<string, number | null> = {};
        for (const [k, s] of Object.entries(indSeries.current)) { const x = p.seriesData.get(s) as { value?: number } | undefined; iv[k] = x?.value ?? null; }
        setIndVals(iv);
      });
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => setRangeTick((n) => n + 1));
      try {
        const pane = chart.panes()[0];
        lw.createImageWatermark(pane, "/assets/brand/logo-mark.png", { alpha: 0.055, maxHeight: Math.min(220, height * 0.5), maxWidth: 220, padding: 0 });
        lw.createTextWatermark(pane, { horzAlign: "center", vertAlign: "bottom", lines: [{ text: "ArcTools", color: th.wm, fontSize: 44, fontStyle: "bold", fontFamily: "Inter, system-ui, sans-serif" }] });
      } catch { /* cosmetic */ }
      // drawing-tool clicks: our own pointer handling on the container (library click events are picky about
      // synthetic/touch input) — a press+release within 5 px inside the main pane counts as a click
      const handleChartClick = (x: number, y: number) => {
        const t = toolRef.current; const m = mainRef.current;
        if (t === "none" || !m) return;
        const price = m.coordinateToPrice(y);
        if (price == null) return;
        const cs = candlesRef.current;
        if (!cs.length) return;
        const tt = chart.timeScale().coordinateToTime(x);
        let time = tt != null ? Number(tt) : NaN;
        if (!Number.isFinite(time)) {
          const lg = chart.timeScale().coordinateToLogical(x);
          if (lg == null) return;
          time = cs[0].t + Math.round(lg) * stepRef.current;   // empty space right of the last bar
        }
        const pt = { t: time, p: Number(price) };
        if (t === "level") { addDrawing({ kind: "level", p: pt.p / scaleRef.current }); return; }
        const first = pendingRef.current;
        if (!first) { pendingRef.current = pt; setPending(pt); return; }
        pendingRef.current = null; setPending(null);
        if (t === "measure") {
          const bars = Math.round((pt.t - first.t) / stepRef.current);
          const dp = pt.p - first.p; const pct = first.p ? (dp / first.p) * 100 : 0;
          const vol = cs.filter((k) => k.t >= Math.min(first.t, pt.t) && k.t <= Math.max(first.t, pt.t)).reduce((sum, k) => sum + k.v, 0);
          setMeasure({ x, y, text: [`${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%  (${fmtAxis(Math.abs(dp), modeRef.current)})`, `${Math.abs(bars)} bars · ${fmtDur(Math.abs(pt.t - first.t))}`, `vol ${fmtVol(vol)}`] });
          return;
        }
        if (first.t === pt.t && t !== "fib") return;
        addDrawing({ kind: t as "trend" | "ray" | "fib", t1: first.t, p1: first.p / scaleRef.current, t2: pt.t, p2: pt.p / scaleRef.current });
      };
      let press: { x: number; y: number } | null = null;
      const el = box.current as HTMLDivElement;
      const paneRect = () => { try { const pe = chart.panes()[0].getHTMLElement(); return (pe ?? el).getBoundingClientRect(); } catch { return el.getBoundingClientRect(); } };
      const onDown = (e: PointerEvent) => { if (e.button !== 0 || toolRef.current === "none") return; press = { x: e.clientX, y: e.clientY }; };
      const onUp = (e: PointerEvent) => {
        if (!press || toolRef.current === "none") { press = null; return; }
        const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y); press = null;
        if (moved > 5) return;                                   // that was a pan, not a click
        const r = paneRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
        handleChartClick(e.clientX - r.left, e.clientY - r.top);
      };
      el.addEventListener("pointerdown", onDown); el.addEventListener("pointerup", onUp);
      (window as unknown as { __arcChart?: unknown }).__arcChart = { click: handleChartClick, paneRect, tool: () => toolRef.current, drawings: () => drawingsRef.current };
      clickCleanup = () => { el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); };
      chartRef.current = chart; lwRef.current = lw; volRef.current = vs;
      ro = new ResizeObserver(() => chart.timeScale().fitContent());
      ro.observe(box.current);
      setReady(true);
    })();
    return () => { disposed = true; ro?.disconnect(); clickCleanup?.(); chartRef.current?.remove(); chartRef.current = null; mainRef.current = null; volRef.current = null; markRef.current = null; indSeries.current = {}; drawSeries.current = { lines: [], priceLines: [] }; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scaleRef.current = scale; modeRef.current = mode; stepRef.current = step; candlesRef.current = candles; drawingsRef.current = drawings; }, [scale, mode, step, candles, drawings]);
  const addDrawing = (d: Drawing) => saveDrawings([...drawingsRef.current, d]);

  // ---- theme re-apply
  useEffect(() => {
    const chart = chartRef.current; if (!chart || !ready) return;
    chart.applyOptions({ grid: { horzLines: { color: theme.grid }, vertLines: { color: theme.gridV } }, layout: { textColor: theme.text }, rightPriceScale: { borderColor: theme.border }, timeScale: { borderColor: theme.border } });
  }, [theme, ready]);

  // ---- main series (type switch) + data
  const haData = useMemo(() => {
    let po = 0, pc = 0;
    return candles.map((k, i) => {
      const c = (k.o + k.h + k.l + k.c) / 4;
      const o = i === 0 ? (k.o + k.c) / 2 : (po + pc) / 2;
      const h = Math.max(k.h, o, c), l = Math.min(k.l, o, c);
      po = o; pc = c;
      return { ...k, o, h, l, c };
    });
  }, [candles]);
  useEffect(() => {
    const chart = chartRef.current; const lw = lwRef.current; const vs = volRef.current;
    if (!chart || !lw || !vs) return;
    // drop the previous main series (drawings attached to it are re-created below)
    for (const pl of drawSeries.current.priceLines) { try { pl.s.removePriceLine(pl.l); } catch { /* gone */ } }
    drawSeries.current.priceLines = [];
    if (mainRef.current) { try { chart.removeSeries(mainRef.current); } catch { /* gone */ } mainRef.current = null; markRef.current = null; }
    const pf = { formatter: (p: number) => fmtAxis(p, mode), type: "custom" as const };
    const src = ctype === "heikin" ? haData : candles;
    const T = (t: number) => t as UTC;
    let s: import("lightweight-charts").ISeriesApi<"Candlestick" | "Bar" | "Line" | "Area">;
    if (ctype === "line") {
      s = chart.addSeries(lw.LineSeries, { color: "#2e7cff", lineWidth: 2, priceFormat: pf, lastValueVisible: true, priceLineVisible: true, crosshairMarkerVisible: true }, 0);
      s.setData(src.map((k) => ({ time: T(k.t), value: k.c * scale })));
    } else if (ctype === "area") {
      s = chart.addSeries(lw.AreaSeries, { lineColor: "#2e7cff", topColor: "rgba(46,124,255,0.35)", bottomColor: "rgba(46,124,255,0.02)", lineWidth: 2, priceFormat: pf }, 0);
      s.setData(src.map((k) => ({ time: T(k.t), value: k.c * scale })));
    } else if (ctype === "bars") {
      s = chart.addSeries(lw.BarSeries, { upColor: theme.up, downColor: theme.down, thinBars: false, openVisible: true, priceFormat: pf }, 0);
      s.setData(src.map((k) => ({ time: T(k.t), open: k.o * scale, high: k.h * scale, low: k.l * scale, close: k.c * scale })));
    } else {
      const hollow = ctype === "hollow";
      s = chart.addSeries(lw.CandlestickSeries, { upColor: hollow ? "transparent" : theme.up, downColor: theme.down, borderVisible: hollow, borderUpColor: theme.up, borderDownColor: theme.down, wickUpColor: theme.up, wickDownColor: theme.down, priceFormat: pf }, 0);
      s.setData(src.map((k) => ({ time: T(k.t), open: k.o * scale, high: k.h * scale, low: k.l * scale, close: k.c * scale })));
    }
    s.applyOptions({ priceLineWidth: 1, priceLineStyle: lw.LineStyle.Dotted, priceLineColor: "rgba(46,124,255,0.8)" });
    mainRef.current = s;
    vs.setData(candles.map((k) => ({ color: k.c >= k.o ? (theme.light ? "rgba(22,163,74,0.35)" : "rgba(34,197,128,0.45)") : (theme.light ? "rgba(220,38,38,0.35)" : "rgba(240,83,79,0.45)"), time: T(k.t), value: k.v })));
    // main series must exist before markers / drawings effects run
    setRangeTick((n) => n + 1);
    if (!candles.length) return;
    const vr = chart.timeScale().getVisibleLogicalRange();
    if (!vr || vr.to - vr.from > candles.length + 20) chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctype, candles, haData, scale, mode, ready, theme]);

  // ---- scale mode
  useEffect(() => {
    const lw = lwRef.current; if (!chartRef.current || !lw) return;
    chartRef.current.priceScale("right").applyOptions({ mode: scaleMode === "log" ? lw.PriceScaleMode.Logarithmic : scaleMode === "pct" ? lw.PriceScaleMode.Percentage : lw.PriceScaleMode.Normal });
  }, [scaleMode, ready]);
  useEffect(() => {
    const lw = lwRef.current; if (!chartRef.current || !lw) return;
    chartRef.current.applyOptions({ crosshair: { mode: magnet ? lw.CrosshairMode.Magnet : lw.CrosshairMode.Normal } });
  }, [magnet, ready]);

  // ---- avatar pins
  useEffect(() => {
    const chart = chartRef.current; const cs = mainRef.current;
    if (!chart || !cs || !avatars?.length || candles.length === 0) { setPins([]); return; }
    const out: { x: number; y: number; a: ChartAvatar }[] = [];
    for (const a of avatars) {
      if (a.t < times[0] || a.t >= times[times.length - 1] + step) continue;
      const k = candles[times.indexOf(snapT(a.t))];
      const x = chart.timeScale().timeToCoordinate(k.t as UTC);
      const y = cs.priceToCoordinate(k.h * scale);
      if (x == null || y == null) continue;
      out.push({ x, y, a });
    }
    const seen = new Map<number, number>();
    for (const p of out) { const n = seen.get(Math.round(p.x)) ?? 0; p.y -= n * 30; seen.set(Math.round(p.x), n + 1); }
    setPins(out);
  }, [avatars, candles, scale, ready, rangeTick, times, step, snapT]);

  // ---- badges
  useEffect(() => {
    const cs = mainRef.current; const lw = lwRef.current;
    if (!cs || !lw || candles.length === 0) return;
    const first = times[0]; const lastT = times[times.length - 1] + step;
    const list = (markers ?? []).filter((m) => m.t >= first && m.t < lastT).map((m) => ({
      color: MARKER_COLOR[m.kind][m.side],
      position: (m.kind === "kol" ? "aboveBar" : m.side === "buy" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
      shape: (m.kind === "kol" ? "circle" : m.side === "buy" ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown" | "circle",
      size: m.kind === "dev" ? 1.6 : m.kind === "kol" ? 1.4 : 1.1,
      text: m.text,
      time: snapT(m.t) as UTC,
    })).sort((a, b) => (a.time as number) - (b.time as number));
    onVisible?.(list.length);
    try {
      if (!markRef.current) markRef.current = lw.createSeriesMarkers(cs, list);
      else markRef.current.setMarkers(list);
    } catch { markRef.current = lw.createSeriesMarkers(cs, list); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, candles, ready, rangeTick]);

  // ---- indicators
  useEffect(() => {
    const chart = chartRef.current; const lw = lwRef.current;
    if (!chart || !lw || !mainRef.current) return;
    const T = (t: number) => t as UTC;
    const closes = candles.map((k) => k.c * scale);
    const sma = (arr: number[], n: number) => arr.map((_, i) => { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j]; return s / n; });
    const emaArr = (arr: number[], n: number) => { const k2 = 2 / (n + 1); let e: number | null = null; return arr.map((v, i) => { e = e == null ? v : v * k2 + e * (1 - k2); return i < n - 1 ? null : e; }); };
    const pts = (vals: (number | null)[]): Pt[] => vals.map((v, i) => (v == null ? null : { time: T(candles[i].t), value: v })).filter(Boolean) as Pt[];
    const want: Record<string, { data: Pt[] | { time: UTC; value: number; color?: string }[]; color: string; pane?: number; title: string; hist?: boolean; width?: 1 | 2; scaleId?: string }> = {};
    if (ind.ma20) want.ma20 = { data: pts(sma(closes, 20)), color: IND_COLOR.ma20, title: "MA20" };
    if (ind.ma50) want.ma50 = { data: pts(sma(closes, 50)), color: IND_COLOR.ma50, title: "MA50" };
    if (ind.ema20) want.ema20 = { data: pts(emaArr(closes, 20)), color: IND_COLOR.ema20, title: "EMA20" };
    if (ind.ema50) want.ema50 = { data: pts(emaArr(closes, 50)), color: IND_COLOR.ema50, title: "EMA50" };
    if (ind.ema200) want.ema200 = { data: pts(emaArr(closes, 200)), color: theme.light ? "#0f1522" : IND_COLOR.ema200, title: "EMA200", width: 2 };
    if (ind.bb) {
      const n = 20; const up: Pt[] = [], mid: Pt[] = [], lo: Pt[] = [];
      candles.forEach((k, i) => { if (i < n - 1) return; let s = 0, s2 = 0; for (let j = i - n + 1; j <= i; j++) { s += closes[j]; s2 += closes[j] * closes[j]; } const m = s / n; const sd = Math.sqrt(Math.max(0, s2 / n - m * m)); up.push({ time: T(k.t), value: m + 2 * sd }); mid.push({ time: T(k.t), value: m }); lo.push({ time: T(k.t), value: Math.max(m * 0.05, m - 2 * sd) }); });   // log scale cannot show ≤0: floor the lower band at 5% of the mean
      want.bbu = { data: up, color: IND_COLOR.bbu, title: "BB+" }; want.bbm = { data: mid, color: IND_COLOR.bbm, title: "BB" }; want.bbl = { data: lo, color: IND_COLOR.bbl, title: "BB−" };
    }
    if (ind.vwap) { let pv = 0, vv = 0; want.vwap = { data: candles.map((k) => { const tp = ((k.h + k.l + k.c) / 3) * scale; pv += tp * k.v; vv += k.v; return { time: T(k.t), value: vv > 0 ? pv / vv : tp }; }), color: IND_COLOR.vwap, title: "VWAP" }; }
    if (ind.volma) want.volma = { data: pts(sma(candles.map((k) => k.v), 20)), color: IND_COLOR.volma, title: "Vol MA", scaleId: "vol" };
    let pane = 1;
    if (ind.rsi) {
      const n = 14; let g = 0, l = 0; const out: Pt[] = [];
      for (let i = 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; const gain = Math.max(d, 0), loss = Math.max(-d, 0); if (i <= n) { g += gain / n; l += loss / n; if (i < n) continue; } else { g = (g * (n - 1) + gain) / n; l = (l * (n - 1) + loss) / n; } out.push({ time: T(candles[i].t), value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); }
      want.rsi = { data: out, color: IND_COLOR.rsi, pane: pane++, title: "RSI 14", width: 2 };
    }
    if (ind.macd) {
      const e12 = emaArr(closes, 12), e26 = emaArr(closes, 26);
      const macd = closes.map((_, i) => (e12[i] != null && e26[i] != null ? (e12[i] as number) - (e26[i] as number) : null));
      const valid = macd.map((v) => v ?? 0); const sig = emaArr(valid, 9).map((v, i) => (macd[i] == null || i < 34 ? null : v));
      const hist = macd.map((v, i) => (v == null || sig[i] == null ? null : v - (sig[i] as number)));
      const p = pane++;
      want.macdh = { data: hist.map((v, i) => (v == null ? null : { time: T(candles[i].t), value: v, color: v >= 0 ? (i > 0 && (hist[i - 1] ?? 0) > v ? "rgba(34,197,128,0.45)" : "rgba(34,197,128,0.9)") : (i > 0 && (hist[i - 1] ?? 0) < v ? "rgba(240,83,79,0.45)" : "rgba(240,83,79,0.9)") })).filter(Boolean) as { time: UTC; value: number; color: string }[], color: "#888", pane: p, title: "MACD hist", hist: true };
      want.macd = { data: pts(macd.map((v, i) => (i < 25 ? null : v))), color: IND_COLOR.macd, pane: p, title: "MACD" };
      want.macds = { data: pts(sig), color: IND_COLOR.macds, pane: p, title: "Signal" };
    }
    for (const k of Object.keys(indSeries.current)) if (!want[k]) { try { chart.removeSeries(indSeries.current[k]); } catch { /* gone */ } delete indSeries.current[k]; }
    // re-create everything when pane assignment may have shifted (simplest correct behaviour)
    const need = Object.keys(want).some((k) => !indSeries.current[k]);
    if (need) { for (const k of Object.keys(indSeries.current)) { try { chart.removeSeries(indSeries.current[k]); } catch { /* gone */ } } indSeries.current = {}; }
    for (const [k, w] of Object.entries(want)) {
      let sr = indSeries.current[k];
      if (!sr) {
        const pf = w.pane ? { type: "price" as const, precision: k.startsWith("macd") ? 8 : 0, minMove: k.startsWith("macd") ? 1e-8 : 1 } : w.scaleId ? { type: "volume" as const } : { formatter: (p: number) => fmtAxis(p, mode), type: "custom" as const };
        sr = w.hist
          ? chart.addSeries(lw.HistogramSeries, { priceFormat: pf, priceLineVisible: false, lastValueVisible: false, title: "" }, w.pane ?? 0)
          : chart.addSeries(lw.LineSeries, { color: w.color, lineWidth: w.width ?? 1, priceLineVisible: false, lastValueVisible: !!w.pane, crosshairMarkerVisible: false, title: "", priceFormat: pf, priceScaleId: w.scaleId }, w.pane ?? 0);
        indSeries.current[k] = sr;
        if (k === "rsi") { try { chart.panes()[w.pane ?? 1]?.setHeight(90); sr.createPriceLine({ price: 70, color: "rgba(240,83,79,0.5)", lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: false, title: "" }); sr.createPriceLine({ price: 30, color: "rgba(34,197,128,0.5)", lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: false, title: "" }); } catch { /* optional */ } }
        if (k === "macdh") { try { chart.panes()[w.pane ?? 1]?.setHeight(100); } catch { /* optional */ } }
      }
      sr.setData(w.data as Pt[]);
    }
    // legend when the cursor is off the chart: last value of every indicator
    const lastVals: Record<string, number | null> = {};
    for (const [k, w] of Object.entries(want)) { const d = w.data as { value: number }[]; lastVals[k] = d.length ? d[d.length - 1].value : null; }
    lastIndRef.current = lastVals;
    setIndVals((cur) => { const out = { ...cur }; for (const k of Object.keys(lastVals)) if (out[k] == null) out[k] = lastVals[k]; return out; });
  }, [ind, candles, scale, mode, ready, ctype, theme]);

  // ---- drawings (re-render on any change / scale / series swap)
  useEffect(() => {
    const chart = chartRef.current; const lw = lwRef.current; const m = mainRef.current;
    if (!chart || !lw || !m) return;
    for (const l of drawSeries.current.lines) { try { chart.removeSeries(l); } catch { /* gone */ } }
    for (const pl of drawSeries.current.priceLines) { try { pl.s.removePriceLine(pl.l); } catch { /* gone */ } }
    drawSeries.current = { lines: [], priceLines: [] };
    const T = (t: number) => t as UTC;
    const lastT = times.length ? times[times.length - 1] : 0;
    for (const d of drawings) {
      if (d.kind === "level") {
        const l = m.createPriceLine({ price: d.p * scale, color: "#f5c542", lineWidth: 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: true, title: "" });
        drawSeries.current.priceLines.push({ s: m, l });
      } else if (d.kind === "trend" || d.kind === "ray") {
        let t2 = d.t2, p2 = d.p2;
        if (d.kind === "ray" && d.t2 !== d.t1 && lastT > Math.max(d.t1, d.t2)) { const slope = (d.p2 - d.p1) / (d.t2 - d.t1); const tEnd = lastT + step * 5; p2 = d.p1 + slope * (tEnd - d.t1); t2 = tEnd; }
        const a = { time: T(Math.min(d.t1, t2)), value: (d.t1 <= t2 ? d.p1 : p2) * scale }, b = { time: T(Math.max(d.t1, t2)), value: (d.t1 <= t2 ? p2 : d.p1) * scale };
        if ((a.time as number) === (b.time as number)) continue;
        const s = chart.addSeries(lw.LineSeries, { color: d.kind === "ray" ? "#9b7bff" : "#2e7cff", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: { formatter: (p: number) => fmtAxis(p, mode), type: "custom" } }, 0);
        s.setData([a, b]);
        drawSeries.current.lines.push(s);
      } else if (d.kind === "fib") {
        const hi = Math.max(d.p1, d.p2), lo = Math.min(d.p1, d.p2), up = d.p2 >= d.p1;
        for (const f of FIB) {
          const price = (up ? lo + (hi - lo) * f : hi - (hi - lo) * f) * scale;
          const col = f === 0 || f === 1 ? "rgba(150,170,200,0.9)" : f === 0.5 ? "#f5c542" : f === 0.618 ? "#22c580" : "rgba(155,123,255,0.9)";
          const l = m.createPriceLine({ price, color: col, lineWidth: 1, lineStyle: f === 0 || f === 1 ? lw.LineStyle.Solid : lw.LineStyle.Dotted, axisLabelVisible: true, title: `${f}` });
          drawSeries.current.priceLines.push({ s: m, l });
        }
      }
    }
  }, [drawings, scale, mode, ready, ctype, times, step, candles]);

  // ---- open orders as price lines (limit = green, TP = cobalt, SL = red)
  const orderPL = useRef<{ s: unknown; l: unknown }[]>([]);
  useEffect(() => {
    const lw = lwRef.current; const m = mainRef.current;
    if (!lw || !m) return;
    for (const pl of orderPL.current) { try { (pl.s as { removePriceLine: (l: unknown) => void }).removePriceLine(pl.l); } catch { /* gone */ } }
    orderPL.current = [];
    for (const o of orderLines ?? []) {
      // candles are price1m × scale; order price is USDC/token → price1m = price × 1e6
      const l = m.createPriceLine({ price: o.price * 1e6 * scale, color: o.color, lineWidth: 2, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: true, title: o.title });
      orderPL.current.push({ s: m, l });
    }
  }, [orderLines, scale, mode, ready, ctype]);

  // ---- actions
  const screenshot = () => {
    const chart = chartRef.current; if (!chart) return;
    try {
      const c = chart.takeScreenshot();
      const out = document.createElement("canvas"); out.width = c.width; out.height = c.height + 28;
      const g = out.getContext("2d"); if (!g) return;
      g.fillStyle = theme.light ? "#ffffff" : "#0b0d13"; g.fillRect(0, 0, out.width, out.height);
      g.drawImage(c, 0, 0);
      g.fillStyle = theme.light ? "#3c4658" : "#98a1b3"; g.font = "12px ui-monospace, Menlo, monospace";
      g.fillText(`${symbol ?? ""} ${interval ?? ""} · ${mode === "mcap" ? "market cap" : "price"} · arctools.fun · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, 10, c.height + 18);
      const a = document.createElement("a"); a.href = out.toDataURL("image/png"); a.download = `arctools-${(symbol ?? "chart").replace(/[^\w-]/g, "")}-${interval ?? ""}.png`; a.click();
    } catch { /* browser blocked download */ }
  };
  const toggleFs = () => { const el = wrap.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); };
  const fit = () => chartRef.current?.timeScale().fitContent();
  const realtime = () => chartRef.current?.timeScale().scrollToRealTime();

  // ---- legend values
  const lastC = candles.length ? candles[candles.length - 1] : null;
  const shown = hover ?? (lastC ? { t: lastC.t, o: lastC.o * scale, h: lastC.h * scale, l: lastC.l * scale, c: lastC.c * scale, v: lastC.v } : null);
  const chg = shown && shown.o > 0 ? ((shown.c - shown.o) / shown.o) * 100 : 0;
  const upC = chg >= 0;
  const countdown = lastC ? Math.max(0, lastC.t + step - Math.floor(now / 1000)) : 0;
  const bar = (active: boolean, warn = false): React.CSSProperties => ({ background: active ? (warn ? "rgba(245,197,66,0.22)" : "rgba(46,124,255,0.2)") : "rgba(20,24,32,0.85)", border: "1px solid " + (active ? (warn ? "#f5c542" : "rgba(46,124,255,0.7)") : "rgba(60,70,90,0.6)"), borderRadius: 6, color: active ? (warn ? "#f5c542" : "#8fbaff") : "#a6b1c4", cursor: "pointer", fontSize: 12, lineHeight: "18px", minHeight: 30, padding: "5px 10px", whiteSpace: "nowrap" });
  const TYPE_LABEL: Record<ChartType, string> = { candles: "Candles", hollow: "Hollow", bars: "Bars", line: "Line", area: "Area", heikin: "Heikin Ashi" };
  const activeInd = (Object.keys(ind) as Ind[]).filter((k) => ind[k]);
  const indLegend = activeInd.flatMap((k) => k === "bb" ? [["bbu", "BB+"], ["bbm", "BB"], ["bbl", "BB−"]] : k === "macd" ? [["macd", "MACD"], ["macds", "Sig"], ["macdh", "Hist"]] : [[k, IND_LABEL[k]]]) as [string, string][];

  return (
    <div ref={wrap} className={"arc-tvchart" + (fs ? " arc-tvchart--fs" : "")} style={{ position: "relative", width: "100%", background: fs ? (theme.light ? "#f4f6fa" : "#0b0d13") : undefined, display: fs ? "flex" : undefined, flexDirection: "column" }}>
      {/* top toolbar: chart type · indicators · scale · actions */}
      <div className="arc-mono arc-chart-tools" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 10px 6px", position: "relative", zIndex: 4 }}>
        <div style={{ position: "relative" }}>
          <button onClick={() => { setTypeOpen((v) => !v); setIndOpen(false); }} style={bar(typeOpen)} type="button" title="chart type">{TYPE_LABEL[ctype]} ▾</button>
          {typeOpen && (
            <div style={{ background: theme.light ? "#fff" : "#0e1118", border: "1px solid rgba(60,70,90,0.5)", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.5)", left: 0, padding: 6, position: "absolute", top: 34, zIndex: 20, minWidth: 160 }}>
              {(Object.keys(TYPE_LABEL) as ChartType[]).map((k) => <button key={k} onClick={() => { setCtype(k); setTypeOpen(false); }} style={{ ...bar(ctype === k), border: "none", display: "block", textAlign: "left", width: "100%", background: ctype === k ? "rgba(46,124,255,0.18)" : "transparent" }} type="button">{TYPE_LABEL[k]}</button>)}
            </div>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => { setIndOpen((v) => !v); setTypeOpen(false); }} style={bar(indOpen || activeInd.length > 0)} type="button" title="indicators">ƒx Indicators{activeInd.length ? ` ${activeInd.length}` : ""} ▾</button>
          {indOpen && (
            <div style={{ background: theme.light ? "#fff" : "#0e1118", border: "1px solid rgba(60,70,90,0.5)", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.5)", left: 0, padding: 6, position: "absolute", top: 34, zIndex: 20, minWidth: 210 }}>
              {(Object.keys(IND_LABEL) as Ind[]).map((k) => (
                <button key={k} onClick={() => toggleInd(k)} style={{ ...bar(ind[k]), alignItems: "center", background: ind[k] ? "rgba(46,124,255,0.14)" : "transparent", border: "none", display: "flex", gap: 8, textAlign: "left", width: "100%" }} type="button">
                  <span style={{ background: IND_COLOR[k === "bb" ? "bbu" : k] ?? "#888", borderRadius: 2, display: "inline-block", height: 8, width: 8 }} />{IND_LABEL[k]}{k === "rsi" || k === "macd" ? <span style={{ color: "#5c6880", marginLeft: "auto" }}>pane</span> : null}
                </button>
              ))}
              <div style={{ borderTop: "1px solid rgba(60,70,90,0.4)", marginTop: 4, paddingTop: 4 }}>
                <button onClick={() => { const n = { ...DEFAULT_IND }; setInd(n); try { localStorage.setItem("arc_chart_ind", JSON.stringify(n)); } catch { /* ignore */ } }} style={{ ...bar(false), border: "none", width: "100%", textAlign: "left", background: "transparent" }} type="button">clear all</button>
              </div>
            </div>
          )}
        </div>
        <span style={{ borderLeft: "1px solid rgba(60,70,90,0.5)", height: 22, margin: "0 4px" }} />
        {(["log", "lin", "pct"] as const).map((k) => <button key={k} onClick={() => setScaleMode(k)} style={bar(scaleMode === k)} type="button" title={k === "log" ? "logarithmic scale" : k === "lin" ? "linear scale" : "percent change scale"}>{k === "pct" ? "%" : k}</button>)}
        <button onClick={() => setMagnet((v) => !v)} style={bar(magnet)} type="button" title="magnet crosshair (snaps to OHLC)">🧲</button>
        <span style={{ marginLeft: "auto" }} />
        <button onClick={fit} style={bar(false)} type="button" title="fit all bars">⤢ fit</button>
        <button onClick={realtime} style={bar(false)} type="button" title="jump to the latest bar">⏵ live</button>
        <button onClick={() => setH((v) => Math.max(260, v - 120))} style={bar(false)} type="button" title="shorter chart">▁</button>
        <button onClick={() => setH((v) => Math.min(1400, v + 120))} style={bar(false)} type="button" title="taller chart">▇</button>
        <button onClick={screenshot} style={bar(false)} type="button" title="download PNG">📷</button>
        <button onClick={toggleFs} style={bar(fs)} type="button" title="fullscreen">{fs ? "⤡" : "⛶"}</button>
      </div>

      <div style={{ display: "flex", flex: fs ? 1 : undefined, minHeight: 0, position: "relative" }}>
        {/* left toolbar: drawing tools */}
        <div className="arc-mono arc-chart-draw" style={{ alignItems: "stretch", borderRight: "1px solid rgba(60,70,90,0.3)", display: "flex", flexDirection: "column", gap: 6, padding: "8px 6px", width: 48, zIndex: 4 }}>
          {([["level", "—", "horizontal level: click a price"], ["trend", "╱", "trend line: click start, click end"], ["ray", "↗", "ray: click start, click direction — extends right"], ["fib", "𝑓", "Fibonacci retracement: click swing low, then swing high (or reverse)"], ["measure", "📐", "measure: click two points → Δ%, bars, time, volume"]] as [Tool, string, string][]).map(([k, icon, tip]) => (
            <button key={k} onClick={() => { const next = toolRef.current === k ? "none" : k; toolRef.current = next; pendingRef.current = null; setTool(next); setMeasure(null); }} style={{ ...bar(tool === k, true), fontSize: 16, height: 34, lineHeight: "22px", padding: 0, textAlign: "center" }} title={tip} type="button">{icon}</button>
          ))}
          <span style={{ borderTop: "1px solid rgba(60,70,90,0.4)", margin: "3px 0" }} />
          <button disabled={!drawings.length} onClick={() => saveDrawings(drawings.slice(0, -1))} style={{ ...bar(false), fontSize: 16, height: 34, lineHeight: "22px", opacity: drawings.length ? 1 : 0.35, padding: 0, textAlign: "center" }} title="undo last drawing (Delete)" type="button">↶</button>
          <button disabled={!drawings.length} onClick={() => { saveDrawings([]); setMeasure(null); }} style={{ ...bar(false), fontSize: 15, height: 34, lineHeight: "22px", opacity: drawings.length ? 1 : 0.35, padding: 0, textAlign: "center" }} title="clear all drawings" type="button">🗑</button>
          {drawings.length > 0 && <span style={{ color: "#5c6880", fontSize: 9, textAlign: "center" }}>{drawings.length}</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {/* legend */}
          {shown && (
            <div className="arc-mono arc-chart-legend" style={{ color: "var(--arc-muted)", fontSize: 11, left: 10, lineHeight: "16px", pointerEvents: "none", position: "absolute", top: 6, zIndex: 2 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {symbol && <b style={{ color: "var(--arc-ink)", fontSize: 12 }}>{symbol}{interval ? <span style={{ color: "var(--arc-muted)", fontWeight: 400 }}> · {interval}</span> : null}{mode === "mcap" ? <span style={{ color: "var(--arc-muted)", fontWeight: 400 }}> · MC</span> : null}</b>}
                <span>O <b style={{ color: upC ? theme.up : theme.down }}>{fmtAxis(shown.o, mode)}</b></span>
                <span>H <b style={{ color: upC ? theme.up : theme.down }}>{fmtAxis(shown.h, mode)}</b></span>
                <span>L <b style={{ color: upC ? theme.up : theme.down }}>{fmtAxis(shown.l, mode)}</b></span>
                <span>C <b style={{ color: upC ? theme.up : theme.down }}>{fmtAxis(shown.c, mode)}</b></span>
                <span style={{ color: upC ? theme.up : theme.down }}>{upC ? "+" : ""}{chg.toFixed(2)}%</span>
                <span>Vol <b style={{ color: "var(--arc-ink)" }}>{fmtVol(shown.v)}</b></span>
                {!hover && lastC && step >= 60 && <span title="time to next bar">⏱ {countdown > 0 ? fmtDur(countdown) : "bar closed"}</span>}
              </div>
              {indLegend.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 2 }}>
                  {indLegend.map(([k, l]) => { const v = hover ? indVals[k] : (indVals[k] ?? lastIndRef.current[k] ?? null); const isPane = k === "rsi" || k.startsWith("macd"); return <span key={k} style={{ color: IND_COLOR[k] ?? "#98a1b3" }}>{l} <b>{v == null ? "—" : isPane ? v.toFixed(k === "rsi" ? 1 : 8).replace(/0+$/, "").replace(/\.$/, "") : fmtAxis(v, k === "volma" ? "mcap" : mode)}</b></span>; })}
                </div>
              )}
            </div>
          )}
          {tool !== "none" && (
            <div className="arc-mono" style={{ background: "rgba(245,197,66,0.18)", border: "1px solid #f5c542", borderRadius: 6, color: "#f5c542", fontSize: 12, padding: "5px 10px", position: "absolute", right: 70, top: 8, zIndex: 3 }}>
              {tool === "level" ? "click a price to drop a level" : pending ? "click the second point" : `click the first point (${tool})`} · Esc to exit
            </div>
          )}
          <div ref={box} style={{ height: fs ? "100%" : h, minHeight: fs ? 300 : undefined, width: "100%", cursor: tool !== "none" ? "crosshair" : undefined }} />
          {measure && (
            <div className="arc-mono" onClick={() => setMeasure(null)} style={{ background: "rgba(14,17,24,0.95)", border: "1px solid #f5c542", borderRadius: 6, color: "#f5c542", fontSize: 11, left: Math.max(4, Math.min(measure.x + 12, (box.current?.clientWidth ?? 400) - 200)), lineHeight: "16px", padding: "6px 9px", position: "absolute", top: Math.max(4, measure.y - 60), zIndex: 5, whiteSpace: "nowrap" }}>
              {measure.text.map((t, i) => <div key={i} style={{ color: i ? "#c3cddc" : undefined, fontWeight: i ? 400 : 700 }}>{t}</div>)}
            </div>
          )}
          {pins.map((p, i) => (
            <a key={i} href={p.a.href} rel="noreferrer" target="_blank" title={p.a.title}
              style={{ left: p.x - 14, position: "absolute", top: p.y - 46, zIndex: 3, display: "block", width: 28, height: 28, pointerEvents: "auto" }}>
              <img alt="" src={p.a.url} width={28} height={28} style={{ borderRadius: "50%", border: "2px solid #ff5fd2", boxShadow: "0 0 0 2px #0b0d13, 0 0 12px rgba(255,95,210,0.6)", display: "block", background: "#0b0d13" }} />
              <span style={{ position: "absolute", left: "50%", top: 27, width: 2, height: 12, background: "#ff5fd2", transform: "translateX(-50%)" }} />
            </a>
          ))}
          {candles.length === 0 && (
            <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, left: 0, position: "absolute", right: 0, textAlign: "center", top: "45%" }}>
              No trades indexed yet for this timeframe.
            </p>
          )}
        </div>
      </div>
      {!fs && (
        <div className="arc-chart-resize" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
          title="drag to resize the chart" style={{ alignItems: "center", cursor: "ns-resize", display: "flex", height: 14, justifyContent: "center", touchAction: "none", userSelect: "none", width: "100%" }}>
          <span style={{ background: "rgba(120,135,160,0.5)", borderRadius: 2, display: "block", height: 4, width: 56 }} />
        </div>
      )}
    </div>
  );
}
