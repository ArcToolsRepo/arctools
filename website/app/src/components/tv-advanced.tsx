import { useEffect, useRef, useState } from "react";

/**
 * TradingView Advanced Charts (the exact chart DexScreener / GMGN embed) fed by our UDF datafeed
 * (buybot /udf/*). The library is proprietary: TradingView grants it free of charge after a licence
 * application (tradingview.com/advanced-charts). Drop the package into public/charting_library/ and
 * public/datafeeds/ — this component detects it at runtime and takes over; until then the caller falls
 * back to our lightweight-charts implementation.
 */
declare global {
  interface Window {
    TradingView?: { widget: new (opts: Record<string, unknown>) => TvWidget };
    Datafeeds?: { UDFCompatibleDatafeed: new (url: string, updateFrequency?: number) => unknown };
  }
}
type TvWidget = { onChartReady: (cb: () => void) => void; remove: () => void; activeChart: () => { setResolution: (r: string, cb?: () => void) => void; setSymbol: (s: string, cb?: () => void) => void }; changeTheme?: (t: "dark" | "light") => Promise<void> };

export const UDF_URL = "https://bot-production-4200.up.railway.app/udf";
const LIB = "/charting_library/charting_library.standalone.js";
const FEED = "/datafeeds/udf/dist/bundle.js";
const RES: Record<string, string> = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "1D" };

let libState: "unknown" | "yes" | "no" = "unknown";
let libPromise: Promise<boolean> | null = null;

/** true when the licensed library is deployed next to the site */
export function advancedAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (libState !== "unknown") return Promise.resolve(libState === "yes");
  if (!libPromise) {
    libPromise = fetch(LIB, { method: "HEAD" }).then((r) => {
      const ok = r.ok && (r.headers.get("content-type") || "").includes("javascript");
      libState = ok ? "yes" : "no"; return ok;
    }).catch(() => { libState = "no"; return false; });
  }
  return libPromise;
}

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script"); s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error(src)); document.head.appendChild(s);
  });
}

type Props = { token: string; interval: string; mode: "price" | "mcap"; height: number; light?: boolean; onFail?: () => void };

export function TvAdvanced({ token, interval, mode, height, light, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const w = useRef<TvWidget | null>(null);
  const [ready, setReady] = useState(false);
  const symbol = mode === "mcap" ? `${token}:mcap` : token;

  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        await loadScript(LIB); await loadScript(FEED);
        if (dead || !box.current || !window.TradingView || !window.Datafeeds) { onFail?.(); return; }
        const widget = new window.TradingView.widget({
          symbol, interval: RES[interval] ?? "5", container: box.current, library_path: "/charting_library/",
          datafeed: new window.Datafeeds.UDFCompatibleDatafeed(UDF_URL, 10_000),
          locale: "en", autosize: true, theme: light ? "light" : "dark", timezone: "Etc/UTC",
          custom_css_url: "/assets/tv-theme.css",
          disabled_features: ["header_symbol_search", "symbol_search_hot_key", "header_compare", "display_market_status", "popup_hints", "header_saveload"],
          enabled_features: ["hide_left_toolbar_by_default", "seconds_resolution", "items_favoriting", "study_templates", "use_localstorage_for_settings"],
          overrides: {
            "paneProperties.background": light ? "#ffffff" : "#0b0d13", "paneProperties.backgroundType": "solid",
            "paneProperties.vertGridProperties.color": light ? "rgba(15,21,34,0.06)" : "rgba(60,70,90,0.12)",
            "paneProperties.horzGridProperties.color": light ? "rgba(15,21,34,0.08)" : "rgba(60,70,90,0.18)",
            "mainSeriesProperties.candleStyle.upColor": "#22c580", "mainSeriesProperties.candleStyle.downColor": "#f0534f",
            "mainSeriesProperties.candleStyle.borderUpColor": "#22c580", "mainSeriesProperties.candleStyle.borderDownColor": "#f0534f",
            "mainSeriesProperties.candleStyle.wickUpColor": "#22c580", "mainSeriesProperties.candleStyle.wickDownColor": "#f0534f",
            "scalesProperties.textColor": light ? "#5c6880" : "#7c889e", "scalesProperties.lineColor": light ? "rgba(15,21,34,0.18)" : "rgba(60,70,90,0.35)",
            "mainSeriesProperties.priceAxisProperties.log": true,
          },
          studies_overrides: { "volume.volume.color.0": "rgba(240,83,79,0.45)", "volume.volume.color.1": "rgba(34,197,128,0.45)" },
          loading_screen: { backgroundColor: light ? "#ffffff" : "#0b0d13", foregroundColor: "#2e7cff" },
          time_frames: [
            { text: "1h", resolution: "1", description: "1 hour" }, { text: "6h", resolution: "5", description: "6 hours" },
            { text: "1d", resolution: "15", description: "1 day" }, { text: "7d", resolution: "60", description: "7 days" },
            { text: "1m", resolution: "240", description: "1 month" }, { text: "all", resolution: "1D", description: "everything" },
          ],
          favorites: { intervals: ["1", "5", "15", "60", "240", "1D"], chartTypes: ["Candles", "Hollow Candles", "Line", "Area", "Heiken Ashi"] },
          custom_formatters: undefined,
        });
        widget.onChartReady(() => { if (!dead) setReady(true); });
        w.current = widget;
      } catch { onFail?.(); }
    })();
    return () => { dead = true; try { w.current?.remove(); } catch { /* gone */ } w.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { if (ready) try { w.current?.activeChart().setResolution(RES[interval] ?? "5"); } catch { /* ignore */ } }, [interval, ready]);
  useEffect(() => { if (ready) try { w.current?.activeChart().setSymbol(symbol); } catch { /* ignore */ } }, [symbol, ready]);
  useEffect(() => { if (ready) void w.current?.changeTheme?.(light ? "light" : "dark"); }, [light, ready]);

  return <div ref={box} style={{ height, width: "100%" }} />;
}
