import { useEffect, useRef, useState } from "react";

/**
 * TradingView lightweight-charts wrapper: candles + volume histogram, crosshair
 * OHLC readout, price/market-cap axis modes. Loaded client-side only (the lib
 * touches `window`), so SSR renders an empty box of the right height.
 */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; vb: number; n: number };
/** Badge drawn on a bar: DB/DS = dev buy/sell, IB/IS = insider, PB/PS = pro wallet (75%+ win rate). */
export type ChartMarker = { t: number; side: "buy" | "sell"; kind: "dev" | "insider" | "pro" | "kol"; text: string; title?: string };
/** KOL avatar pinned above the bar where the tweet happened (HTML overlay — the chart lib cannot draw images). */
export type ChartAvatar = { t: number; url: string; title: string; href: string; label: string };

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
};

const fmtAxis = (v: number, mode: "price" | "mcap") => {
  if (mode === "mcap") {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  }
  if (v === 0) return "$0";
  if (v >= 1) return `$${v.toFixed(4)}`;
  const digits = Math.min(10, Math.max(4, -Math.floor(Math.log10(v)) + 3));
  return `$${v.toFixed(digits)}`;
};

const MARKER_COLOR: Record<ChartMarker["kind"], { buy: string; sell: string }> = {
  dev: { buy: "#22c580", sell: "#f0534f" },
  insider: { buy: "#2e7cff", sell: "#ff8a3d" },
  pro: { buy: "#9b7bff", sell: "#f5c542" },
  kol: { buy: "#ff5fd2", sell: "#ff5fd2" },
};

export function TvChart({ candles, scale, mode, height = 440, markers, avatars, onVisible }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<import("lightweight-charts").IChartApi | null>(null);
  const candleRef = useRef<import("lightweight-charts").ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<import("lightweight-charts").ISeriesApi<"Histogram"> | null>(null);
  const markRef = useRef<import("lightweight-charts").ISeriesMarkersPluginApi<import("lightweight-charts").Time> | null>(null);
  const lwRef = useRef<typeof import("lightweight-charts") | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [pins, setPins] = useState<{ x: number; y: number; a: ChartAvatar }[]>([]);
  const [rangeTick, setRangeTick] = useState(0);
  const [ready, setReady] = useState(false);
  // ---- simple technical analysis: overlays, RSI pane, horizontal levels, log/linear
  type Ind = "ma20" | "ma50" | "ema20" | "bb" | "vwap" | "rsi";
  const [ind, setInd] = useState<Record<Ind, boolean>>(() => {
    try { return { ma20: false, ma50: false, ema20: false, bb: false, vwap: false, rsi: false, ...(JSON.parse(localStorage.getItem("arc_chart_ind") || "{}") as Partial<Record<Ind, boolean>>) }; }
    catch { return { ma20: false, ma50: false, ema20: false, bb: false, vwap: false, rsi: false }; }
  });
  const [logScale, setLogScale] = useState(true);
  const [lineTool, setLineTool] = useState(false);
  const lineToolRef = useRef(false);
  const levelsRef = useRef<import("lightweight-charts").IPriceLine[]>([]);
  const [levelCount, setLevelCount] = useState(0);
  const indSeries = useRef<Record<string, import("lightweight-charts").ISeriesApi<"Line">>>({});
  const toggleInd = (k: Ind) => setInd((o) => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem("arc_chart_ind", JSON.stringify(n)); } catch { /* ignore */ } return n; });

  // create once
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    void (async () => {
      const lw = await import("lightweight-charts");
      if (disposed || !box.current) return;
      const chart = lw.createChart(box.current, {
        autoSize: true,
        crosshair: { mode: lw.CrosshairMode.Normal },
        grid: { horzLines: { color: "rgba(60,70,90,0.18)" }, vertLines: { color: "rgba(60,70,90,0.10)" } },
        layout: {
          attributionLogo: false,
          background: { color: "transparent", type: lw.ColorType.Solid },
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          textColor: "#7c889e",
        },
        rightPriceScale: { borderColor: "rgba(60,70,90,0.35)", scaleMargins: { bottom: 0.22, top: 0.08 } },
        timeScale: { borderColor: "rgba(60,70,90,0.35)", rightOffset: 4, secondsVisible: false, timeVisible: true },
      });
      const cs = chart.addSeries(lw.CandlestickSeries, {
        borderVisible: false,
        downColor: "#f0534f",
        priceFormat: { formatter: (p: number) => fmtAxis(p, mode), type: "custom" },
        upColor: "#22c580",
        wickDownColor: "#f0534f",
        wickUpColor: "#22c580",
      });
      const vs = chart.addSeries(lw.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { bottom: 0, top: 0.82 } });
      // log: brak ujemnych podzialek przy duzych knotach, czytelne ruchy 10x typowe dla memecoinow
      chart.priceScale("right").applyOptions({ mode: lw.PriceScaleMode.Logarithmic });
      chart.subscribeCrosshairMove((p) => {
        if (!p.time || !p.seriesData.size) {
          setHover(null);
          return;
        }
        const d = p.seriesData.get(cs) as { open: number; high: number; low: number; close: number } | undefined;
        const v = p.seriesData.get(vs) as { value: number } | undefined;
        if (d) setHover({ c: d.close, h: d.high, l: d.low, n: 0, o: d.open, t: Number(p.time), v: v?.value ?? 0, vb: 0 });
      });
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => setRangeTick((n) => n + 1));
      // ArcTools watermark: logo mark + wordmark, very faint, centred behind the candles
      try {
        const pane = chart.panes()[0];
        lw.createImageWatermark(pane, "/assets/brand/logo-mark.png", { alpha: 0.055, maxHeight: Math.min(220, height * 0.5), maxWidth: 220, padding: 0 });
        lw.createTextWatermark(pane, { horzAlign: "center", vertAlign: "bottom", lines: [{ text: "ArcTools", color: "rgba(150,170,200,0.07)", fontSize: 44, fontStyle: "bold", fontFamily: "Inter, system-ui, sans-serif" }] });
      } catch { /* watermark is cosmetic */ }
      // horizontal level tool: click on the chart → price line at that price (removable via the toolbar)
      chart.subscribeClick((p) => {
        if (!lineToolRef.current || !p.point) return;
        const price = cs.coordinateToPrice(p.point.y);
        if (price == null) return;
        const line = cs.createPriceLine({ price: Number(price), color: "#f5c542", lineWidth: 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: true, title: "" });
        levelsRef.current.push(line);
        setLevelCount(levelsRef.current.length);
      });
      chartRef.current = chart;
      lwRef.current = lw;
      candleRef.current = cs;
      volRef.current = vs;
      ro = new ResizeObserver(() => chart.timeScale().fitContent());
      ro.observe(box.current);
      setReady(true);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // feed data (also whenever mode/scale changes)
  useEffect(() => {
    const cs = candleRef.current;
    const vs = volRef.current;
    if (!cs || !vs) return; // re-runs when `ready` flips after the async import
    cs.applyOptions({ priceFormat: { formatter: (p: number) => fmtAxis(p, mode), type: "custom" } });
    const data = candles.map((k) => ({
      close: k.c * scale, high: k.h * scale, low: k.l * scale, open: k.o * scale, time: k.t as import("lightweight-charts").UTCTimestamp,
    }));
    cs.setData(data);
    vs.setData(
      candles.map((k) => ({
        color: k.c >= k.o ? "rgba(34,197,128,0.45)" : "rgba(240,83,79,0.45)",
        time: k.t as import("lightweight-charts").UTCTimestamp,
        value: k.v,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles, scale, mode, ready]);

  // avatar pins: (time → x) via the time scale, (bar high → y) via the price scale; recomputed on every pan/zoom/resize
  useEffect(() => {
    const chart = chartRef.current; const cs = candleRef.current;
    if (!chart || !cs || !avatars?.length || candles.length === 0) { setPins([]); return; }
    const times = candles.map((k) => k.t);
    const step = times.length > 1 ? times[1] - times[0] : 60;
    const out: { x: number; y: number; a: ChartAvatar }[] = [];
    for (const a of avatars) {
      if (a.t < times[0] || a.t >= times[times.length - 1] + step) continue;
      let lo = 0, hi = times.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid] <= a.t) lo = mid; else hi = mid - 1; }
      const k = candles[lo];
      const x = chart.timeScale().timeToCoordinate(k.t as import("lightweight-charts").UTCTimestamp);
      const y = cs.priceToCoordinate(k.h * scale);
      if (x == null || y == null) continue;
      out.push({ x, y, a });
    }
    // stack pins that land on the same bar
    const seen = new Map<number, number>();
    for (const p of out) { const n = seen.get(Math.round(p.x)) ?? 0; p.y -= n * 30; seen.set(Math.round(p.x), n + 1); }
    setPins(out);
  }, [avatars, candles, scale, ready, rangeTick]);

  // badges: snap each event to the bar that contains it (markers must sit on an existing bar time)
  useEffect(() => {
    const cs = candleRef.current; const lw = lwRef.current;
    if (!cs || !lw || candles.length === 0) return;
    const times = candles.map((k) => k.t);
    const snap = (t: number) => { let lo = 0, hi = times.length - 1; if (t <= times[0]) return times[0]; if (t >= times[hi]) return times[hi]; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid] <= t) lo = mid; else hi = mid - 1; } return times[lo]; };
    const step = times.length > 1 ? times[1] - times[0] : 60;
    const first = times[0]; const lastT = times[times.length - 1] + step;
    // only events inside the loaded candle range — older ones would all pile up on the first bar
    const list = (markers ?? []).filter((m) => m.t >= first && m.t < lastT).map((m) => ({
      color: MARKER_COLOR[m.kind][m.side],
      position: (m.kind === "kol" ? "aboveBar" : m.side === "buy" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
      shape: (m.kind === "kol" ? "circle" : m.side === "buy" ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown" | "circle",
      size: m.kind === "dev" ? 1.6 : m.kind === "kol" ? 1.4 : 1.1,
      text: m.text,
      time: snap(m.t) as import("lightweight-charts").UTCTimestamp,
    })).sort((a, b) => (a.time as number) - (b.time as number));
    onVisible?.(list.length);
    if (!markRef.current) markRef.current = lw.createSeriesMarkers(cs, list);
    else markRef.current.setMarkers(list);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, candles, ready]);

  useEffect(() => { lineToolRef.current = lineTool; }, [lineTool]);
  useEffect(() => {
    const lw = lwRef.current; if (!chartRef.current || !lw) return;
    chartRef.current.priceScale("right").applyOptions({ mode: logScale ? lw.PriceScaleMode.Logarithmic : lw.PriceScaleMode.Normal });
  }, [logScale, ready]);
  // indicators: computed from the (scaled) closes; each toggle adds/removes its line series
  useEffect(() => {
    const chart = chartRef.current; const lw = lwRef.current; const cs = candleRef.current;
    if (!chart || !lw || !cs) return;
    const T = (t: number) => t as import("lightweight-charts").UTCTimestamp;
    const closes = candles.map((k) => k.c * scale);
    const sma = (n: number) => candles.map((k, i) => { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += closes[j]; return { time: T(k.t), value: s / n }; }).filter(Boolean) as { time: import("lightweight-charts").UTCTimestamp; value: number }[];
    const ema = (n: number) => { const k2 = 2 / (n + 1); let e: number | null = null; return candles.map((k, i) => { e = e == null ? closes[i] : closes[i] * k2 + e * (1 - k2); return i < n - 1 ? null : { time: T(k.t), value: e }; }).filter(Boolean) as { time: import("lightweight-charts").UTCTimestamp; value: number }[]; };
    const bb = () => { const n = 20; const up: { time: import("lightweight-charts").UTCTimestamp; value: number }[] = [], lo: typeof up = []; candles.forEach((k, i) => { if (i < n - 1) return; let s = 0, s2 = 0; for (let j = i - n + 1; j <= i; j++) { s += closes[j]; s2 += closes[j] * closes[j]; } const m = s / n; const sd = Math.sqrt(Math.max(0, s2 / n - m * m)); up.push({ time: T(k.t), value: m + 2 * sd }); lo.push({ time: T(k.t), value: Math.max(1e-12, m - 2 * sd) }); }); return { up, lo }; };
    const vwap = () => { let pv = 0, vv = 0; return candles.map((k) => { const tp = ((k.h + k.l + k.c) / 3) * scale; pv += tp * k.v; vv += k.v; return { time: T(k.t), value: vv > 0 ? pv / vv : tp }; }); };
    const rsi = () => { const n = 14; let g = 0, l = 0; const out: { time: import("lightweight-charts").UTCTimestamp; value: number }[] = []; for (let i = 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; const gain = Math.max(d, 0), loss = Math.max(-d, 0); if (i <= n) { g += gain / n; l += loss / n; if (i < n) continue; } else { g = (g * (n - 1) + gain) / n; l = (l * (n - 1) + loss) / n; } out.push({ time: T(candles[i].t), value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); } return out; };
    const want: Record<string, { data: { time: import("lightweight-charts").UTCTimestamp; value: number }[]; color: string; pane?: number; title: string }> = {};
    if (ind.ma20) want.ma20 = { data: sma(20), color: "#f5c542", title: "MA20" };
    if (ind.ma50) want.ma50 = { data: sma(50), color: "#ff8a3d", title: "MA50" };
    if (ind.ema20) want.ema20 = { data: ema(20), color: "#2e7cff", title: "EMA20" };
    if (ind.bb) { const b = bb(); want.bbu = { data: b.up, color: "rgba(155,123,255,0.8)", title: "BB+" }; want.bbl = { data: b.lo, color: "rgba(155,123,255,0.8)", title: "BB−" }; }
    if (ind.vwap) want.vwap = { data: vwap(), color: "#ff5fd2", title: "VWAP" };
    if (ind.rsi) want.rsi = { data: rsi(), color: "#9b7bff", pane: 1, title: "RSI 14" };
    // remove what is no longer wanted
    for (const k of Object.keys(indSeries.current)) if (!want[k]) { try { chart.removeSeries(indSeries.current[k]); } catch { /* gone */ } delete indSeries.current[k]; }
    for (const [k, w] of Object.entries(want)) {
      let sr = indSeries.current[k];
      if (!sr) {
        sr = chart.addSeries(lw.LineSeries, { color: w.color, lineWidth: k === "rsi" ? 2 : 1, priceLineVisible: false, lastValueVisible: k === "rsi", crosshairMarkerVisible: false, title: w.title, priceFormat: k === "rsi" ? { type: "price", precision: 0, minMove: 1 } : { formatter: (p: number) => fmtAxis(p, mode), type: "custom" } }, w.pane ?? 0);
        indSeries.current[k] = sr;
        if (k === "rsi") { try { chart.panes()[1]?.setHeight(90); sr.createPriceLine({ price: 70, color: "rgba(240,83,79,0.5)", lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: false, title: "" }); sr.createPriceLine({ price: 30, color: "rgba(34,197,128,0.5)", lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: false, title: "" }); } catch { /* pane API optional */ } }
      }
      sr.setData(w.data);
    }
  }, [ind, candles, scale, mode, ready]);
  const clearLevels = () => { const cs = candleRef.current; for (const l of levelsRef.current) { try { cs?.removePriceLine(l); } catch { /* gone */ } } levelsRef.current = []; setLevelCount(0); };

  const last = hover ?? (candles.length ? { ...candles[candles.length - 1] } : null);
  const sc = hover ? 1 : scale; // hover values are already scaled by the chart
  const chg = last && last.o > 0 ? ((last.c - last.o) / last.o) * 100 : 0;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {last && (
        <div
          className="arc-mono"
          style={{
            color: "var(--arc-muted)", display: "flex", flexWrap: "wrap", fontSize: 11, gap: 12,
            left: 10, pointerEvents: "none", position: "absolute", top: 8, zIndex: 2,
          }}
        >
          <span>O <b style={{ color: "var(--arc-ink)" }}>{fmtAxis(last.o * sc, mode)}</b></span>
          <span>H <b style={{ color: "var(--arc-ink)" }}>{fmtAxis(last.h * sc, mode)}</b></span>
          <span>L <b style={{ color: "var(--arc-ink)" }}>{fmtAxis(last.l * sc, mode)}</b></span>
          <span>C <b style={{ color: "var(--arc-ink)" }}>{fmtAxis(last.c * sc, mode)}</b></span>
          <span style={{ color: chg >= 0 ? "#22c580" : "#f0534f" }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
          <span>Vol <b style={{ color: "var(--arc-ink)" }}>${last.v.toFixed(0)}</b></span>
        </div>
      )}
      <div className="arc-mono arc-chart-tools" style={{ position: "absolute", right: 64, top: 6, zIndex: 3, display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "60%" }}>
        {([["ma20", "MA20"], ["ma50", "MA50"], ["ema20", "EMA20"], ["bb", "BB"], ["vwap", "VWAP"], ["rsi", "RSI"]] as [Ind, string][]).map(([k, l]) => (
          <button key={k} onClick={() => toggleInd(k)} type="button" title={`toggle ${l}`}
            style={{ background: ind[k] ? "rgba(34,197,128,0.18)" : "rgba(20,24,32,0.75)", border: "1px solid " + (ind[k] ? "rgba(34,197,128,0.6)" : "rgba(60,70,90,0.5)"), borderRadius: 4, color: ind[k] ? "#22c580" : "#7c889e", cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>{l}</button>
        ))}
        <button onClick={() => setLineTool((v) => !v)} type="button" title="Horizontal level: turn on, then click the chart at a price. Click again to turn off."
          style={{ background: lineTool ? "rgba(245,197,66,0.2)" : "rgba(20,24,32,0.75)", border: "1px solid " + (lineTool ? "#f5c542" : "rgba(60,70,90,0.5)"), borderRadius: 4, color: lineTool ? "#f5c542" : "#7c889e", cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>— level{levelCount ? ` ${levelCount}` : ""}</button>
        {levelCount > 0 && <button onClick={clearLevels} type="button" title="remove all levels" style={{ background: "rgba(20,24,32,0.75)", border: "1px solid rgba(60,70,90,0.5)", borderRadius: 4, color: "#7c889e", cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>×</button>}
        <button onClick={() => setLogScale((v) => !v)} type="button" title="price scale: logarithmic / linear"
          style={{ background: "rgba(20,24,32,0.75)", border: "1px solid rgba(60,70,90,0.5)", borderRadius: 4, color: "#7c889e", cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>{logScale ? "log" : "lin"}</button>
      </div>
      <div ref={box} style={{ height, width: "100%", cursor: lineTool ? "crosshair" : undefined }} />
      {pins.map((p, i) => (
        <a key={i} href={p.a.href} rel="noreferrer" target="_blank" title={p.a.title}
          style={{ left: p.x - 14, position: "absolute", top: p.y - 46 + (candles.length ? 0 : 0), zIndex: 3, display: "block", width: 28, height: 28, pointerEvents: "auto" }}>
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
  );
}
