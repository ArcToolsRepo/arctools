import { checkUpdate } from "./lib/update";
import React, { lazy, Suspense, useEffect } from "react";
import { go, tabOf, useRoute } from "./lib/router";
import { loadList, loadTrending } from "./lib/store";
import { Icon, Toasts } from "./components/ui";
import { initNative, tap } from "./lib/native";
import Trending from "./screens/Trending";
import Wallet from "./screens/Wallet";
import Token from "./screens/Token";

/** lazy chunk with one retry: after an update the old page can reference a chunk hash that no longer exists,
 *  or a flaky connection drops the fetch — without this the screen simply went blank. */
const retry = <T,>(load: () => Promise<T>): Promise<T> => load().catch(() => new Promise<T>((res, rej) => setTimeout(() => load().then(res, rej), 800)));
const Swap = lazy(() => retry(() => import("./screens/Swap")));
const More = lazy(() => retry(() => import("./screens/More")));
const Watch = lazy(() => retry(() => import("./screens/Watch")));
const Sub = lazy(() => retry(() => import("./screens/Sub")));

/** A screen that throws must not take the whole app with it: show what broke and a way back. */
class Boundary extends React.Component<{ children: React.ReactNode; routeKey: string }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { err: String((e as Error)?.message || e).slice(0, 200) }; }
  componentDidUpdate(prev: { routeKey: string }) { if (prev.routeKey !== this.props.routeKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="card" style={{ margin: 14, display: "grid", gap: 10 }}>
        <b>This screen hit an error</b>
        <small className="muted" style={{ wordBreak: "break-word" }}>{this.state.err}</small>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary sm" onClick={() => location.reload()}>Reload app</button>
          <button className="btn sm" onClick={() => { this.setState({ err: null }); go("/"); }}>Back to Trending</button>
        </div>
      </div>
    );
  }
}

export const APP_VERSION_CODE = 14;
export const APP_VERSION = "2.3";

const TABS = [
  ["trending", "Trending", Icon.fire, "/"], ["watch", "Watch", Icon.star, "/watch"], ["swap", "Swap", Icon.swap, "/swap"],
  ["wallet", "Wallet", Icon.wallet, "/wallet"], ["more", "More", Icon.more, "/more"],
] as const;

export default function App() {
  const r = useRoute(); const tab = tabOf(r);
  useEffect(() => { void loadTrending(); void loadList(); }, []);
  // status bar + hardware back (no-ops in a browser)
  useEffect(() => { void initNative(() => { if (location.hash && location.hash !== "#/") { history.back(); return true; } return false; }); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [r]);
  // updates: src/lib/update.ts + <UpdateBanner/> (Trending, Settings) — in-app download + installer, no browser
  useEffect(() => { void checkUpdate(); const id = setInterval(() => void checkUpdate(), 60 * 60_000); return () => clearInterval(id); }, []);

  let screen: React.ReactElement;
  switch (r.name) {
    case "trending": case "search": screen = <Trending />; break;
    case "token": screen = <Token ca={r.ca} />; break;
    case "wallet": screen = <Wallet />; break;
    case "swap": screen = <Swap token={r.token} />; break;
    case "watch": screen = <Watch />; break;
    case "more": screen = <More />; break;
    default: screen = <Sub route={r} />;
  }
  return (
    <div className="app">
      <Boundary routeKey={JSON.stringify(r)}><Suspense fallback={<div className="empty">…</div>}>{screen}</Suspense></Boundary>
      <nav className="tabs">
        {TABS.map(([k, l, Ic, to]) => <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => { tap(); go(to); }}><Ic className="" />{l}</button>)}
      </nav>
      <Toasts />
    </div>
  );
}
