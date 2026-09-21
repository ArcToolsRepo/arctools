import { checkUpdate } from "./lib/update";
import React, { lazy, Suspense, useEffect } from "react";
import { go, tabOf, useRoute } from "./lib/router";
import { loadList, loadTrending } from "./lib/store";
import { Icon, Toasts } from "./components/ui";
import { initNative, tap } from "./lib/native";
import Trending from "./screens/Trending";
import Wallet from "./screens/Wallet";
import Token from "./screens/Token";

const Swap = lazy(() => import("./screens/Swap"));
const More = lazy(() => import("./screens/More"));
const Watch = lazy(() => import("./screens/Watch"));
const Sub = lazy(() => import("./screens/Sub"));

export const APP_VERSION_CODE = 10;
export const APP_VERSION = "1.9";

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
      <Suspense fallback={<div className="empty">…</div>}>{screen}</Suspense>
      <nav className="tabs">
        {TABS.map(([k, l, Ic, to]) => <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => { tap(); go(to); }}><Ic className="" />{l}</button>)}
      </nav>
      <Toasts />
    </div>
  );
}
