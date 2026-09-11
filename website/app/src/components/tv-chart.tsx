import { useEffect, useRef, useState } from "react";

/**
 * TradingView lightweight-charts wrapper: candles + volume histogram, crosshair
 * OHLC readout, price/market-cap axis modes. Loaded client-side only (the lib
 * touches `window`), so SSR renders an empty box of the right height.
 */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; vb: number; n: number };

type Props = {
  candles: Candle[];
  /** multiply price1m by this to get the displayed unit (1e-6 for price/token, supply/1e6 for mcap) */
  scale: number;
  mode: "price" | "mcap";
  height?: number;
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

export function TvChart({ candles, scale, mode, height = 440 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<import("lightweight-charts").IChartApi | null>(null);
  const candleRef = useRef<import("lightweight-charts").ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<import("lightweight-charts").ISeriesApi<"Histogram"> | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [ready, setReady] = useState(false);

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
      chartRef.current = chart;
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
      <div ref={box} style={{ height, width: "100%" }} />
      {candles.length === 0 && (
        <p className="arc-mono" style={{ color: "var(--arc-muted)", fontSize: 12, left: 0, position: "absolute", right: 0, textAlign: "center", top: "45%" }}>
          No trades indexed yet for this timeframe.
        </p>
      )}
    </div>
  );
}
