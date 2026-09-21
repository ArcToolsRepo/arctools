/** App state that must survive navigation and remounts: module-level, persisted, subscribable.
 *  (Component state is not a cache — the web Terminal learned that at 826 requests in 17 s.) */
import { useEffect, useState } from "react";
import { api, type PadToken, type Trend, type Risk } from "./api";

type Listener = () => void;
const subs = new Set<Listener>();
const emit = () => { for (const l of subs) l(); };
export function useStore<T>(read: () => T): T {
  const [v, setV] = useState(read);
  useEffect(() => { const l = () => setV(read()); subs.add(l); return () => { subs.delete(l); }; }, [read]);
  return v;
}

// ---- persisted prefs ----
const P = "arct.prefs";
export type Prefs = { slippage: number; presets: number[]; hideClones: boolean; quickBuy: number; lang: string; haptics: boolean };
const DEF: Prefs = { slippage: 5, presets: [1, 5, 20, 100], hideClones: true, quickBuy: 5, lang: "en", haptics: true };
let prefs: Prefs = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(P) || "{}") }; } catch { return DEF; } })();
export const getPrefs = () => prefs;
export const setPrefs = (patch: Partial<Prefs>) => { prefs = { ...prefs, ...patch }; localStorage.setItem(P, JSON.stringify(prefs)); emit(); };

// ---- watchlist ----
const WL = "arct.watch";
let watch: Set<string> = (() => { try { return new Set(JSON.parse(localStorage.getItem(WL) || "[]")); } catch { return new Set(); } })();
export const getWatch = () => watch;
export const isWatched = (ca: string) => watch.has(ca.toLowerCase());
export const toggleWatch = (ca: string) => { const k = ca.toLowerCase(); if (watch.has(k)) watch.delete(k); else watch.add(k); localStorage.setItem(WL, JSON.stringify([...watch])); emit(); };

// ---- token universe: the lite list + trending windows + risk, merged by address ----
const tokens = new Map<string, PadToken>();
const trend = new Map<string, Trend>();          // 24 h window
const hot = new Map<string, Trend>();            // sort=trend
const risk = new Map<string, Risk>();
let hotOrder: string[] = []; let trendOrder: string[] = []; let allOrder: string[] = [];
let lastList = 0; let lastTrend = 0;

export const getToken = (ca: string) => tokens.get(ca.toLowerCase());
export const getTrend = (ca: string) => trend.get(ca.toLowerCase());
export const getHot = (ca: string) => hot.get(ca.toLowerCase());
export const getRisk = (ca: string) => risk.get(ca.toLowerCase());
export const orders = () => ({ hot: hotOrder, trend: trendOrder, all: allOrder });
export const allTokens = () => [...tokens.values()];

let haveFull = false;
export const hasFullList = () => haveFull;
/** Two-stage list: `alive` rows first (~9 k, fast on a phone), the full 16 k only when a tab needs the long tail.
 *  Parsing 5 MB of JSON in the WebView blocked the UI for ~10 s and the tabs sat on "loading". */
export async function loadList(force = false, full = false) {
  if (!force && Date.now() - lastList < 60_000 && tokens.size && (haveFull || !full)) return;
  try {
    const rows = await api.tokens(!full);
    for (const t of rows) tokens.set(t.token.toLowerCase(), t);
    if (full || !haveFull) allOrder = rows.map((t) => t.token.toLowerCase());
    if (full) haveFull = true;
    lastList = Date.now(); emit();
  } catch { /* keep what we have */ }
}
export async function loadTrending(force = false) {
  if (!force && Date.now() - lastTrend < 15_000 && hot.size) return;
  try {
    const [h, t] = await Promise.all([api.trending(1440, 200, "trend"), api.trending(1440, 400)]);
    hot.clear(); for (const r of h) hot.set(r.token.toLowerCase(), r); hotOrder = h.map((r) => r.token.toLowerCase());
    trend.clear(); for (const r of t) trend.set(r.token.toLowerCase(), r); trendOrder = t.map((r) => r.token.toLowerCase());
    lastTrend = Date.now(); emit();
  } catch { /* keep */ }
}
const riskInflight = new Set<string>();
export async function loadRisk(cas: string[]) {
  const need = cas.map((c) => c.toLowerCase()).filter((c) => !risk.has(c) && !riskInflight.has(c)).slice(0, 40);
  if (!need.length) return;
  for (const c of need) riskInflight.add(c);
  try { const r = await api.risk(need); for (const [k, v] of Object.entries(r)) risk.set(k.toLowerCase(), v); for (const c of need) if (!risk.has(c)) risk.set(c, {}); emit(); }
  catch { /* retry next time */ }
  finally { for (const c of need) riskInflight.delete(c); }
}
/** apply a pushed trending frame from SSE */
export function applyTrendFrame(q: string, rows: Trend[]) {
  if (q.includes("sort=trend")) { hot.clear(); for (const r of rows) hot.set(r.token.toLowerCase(), r); hotOrder = rows.map((r) => r.token.toLowerCase()); }
  else { trend.clear(); for (const r of rows) trend.set(r.token.toLowerCase(), r); trendOrder = rows.map((r) => r.token.toLowerCase()); }
  lastTrend = Date.now(); emit();
}

// ---- logos from the bot's meta (edge-cached) for rows the lite list left blank ----
const logos = new Map<string, string | null>();
const logoInflight = new Set<string>();
/** logo URL usable from the app's own origin (https://localhost): the site hands out relative paths for images it
 *  serves itself (/api/logo/…, /api/pad-logo/…) — 330 of them, every ArcToolsPad launch included — which resolved
 *  against the WebView origin and 404'd into letter placeholders. */
const absLogo = (u: string | null | undefined) => (u && u.startsWith("/") ? "https://arctools.fun" + u : u ?? null);
export const getLogo = (ca: string) => absLogo(tokens.get(ca.toLowerCase())?.logo ?? logos.get(ca.toLowerCase()) ?? null);
export async function loadLogos(cas: string[]) {
  const need = cas.map((c) => c.toLowerCase()).filter((c) => !tokens.get(c)?.logo && !logos.has(c) && !logoInflight.has(c)).slice(0, 40);
  if (!need.length) return;
  for (const c of need) logoInflight.add(c);
  try { const m = await api.tokenMeta(need); for (const c of need) { const x = m[c]; logos.set(c, x?.logo ?? null); const tk = tokens.get(c); if (tk && x) { if (!tk.symbol && x.symbol) tk.symbol = x.symbol; if (!tk.name && x.name) tk.name = x.name; } } emit(); }
  catch { /* next time */ } finally { for (const c of need) logoInflight.delete(c); }
}

// ---- toasts ----
export type Toast = { id: number; text: string; kind: "ok" | "err" | "info"; tx?: string };
let toasts: Toast[] = []; let tid = 0;
export const getToasts = () => toasts;
export function toast(text: string, kind: Toast["kind"] = "info", tx?: string) {
  const t = { id: ++tid, text, kind, tx }; toasts = [...toasts, t]; emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); emit(); }, kind === "err" ? 7000 : 4500);
}
