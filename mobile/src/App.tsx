import React, { lazy, Suspense, useEffect } from "react";
import { go, tabOf, useRoute } from "./lib/router";
import { loadList, loadTrending } from "./lib/store";
import { Icon, Toasts } from "./components/ui";
import Trending from "./screens/Trending";
import Wallet from "./screens/Wallet";
import Token from "./screens/Token";

const Swap = lazy(() => import("./screens/Swap"));
const More = lazy(() => import("./screens/More"));
const Watch = lazy(() => import("./screens/Watch"));
const Sub = lazy(() => import("./screens/Sub"));

export const APP_VERSION_CODE = 1;
export const APP_VERSION = "1.0";

const TABS = [
  ["trending", "Trending", Icon.fire, "/"], ["watch", "Watch", Icon.star, "/watch"], ["swap", "Swap", Icon.swap, "/swap"],
  ["wallet", "Wallet", Icon.wallet, "/wallet"], ["more", "More", Icon.more, "/more"],
] as const;

export default function App() {
  const r = useRoute(); const tab = tabOf(r);
  useEffect(() => { void loadTrending(); void loadList(); }, []);
  // Android back button (Capacitor) → history.back(); at the root, let the OS handle it
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { Plugins?: { App?: { addListener: (e: string, f: () => void) => void } } } }).Capacitor;
    cap?.Plugins?.App?.addListener?.("backButton", () => { if (location.hash && location.hash !== "#/") history.back(); });
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [r]);
  // no store = nobody updates the app for you: check the site's manifest once per launch and offer the download
  useEffect(() => {
    fetch("https://arctools.fun/assets/app/manifest.json", { cache: "no-store" }).then((x) => x.json()).then((m: { versionCode?: number; version?: string; file?: string }) => {
      if ((m.versionCode ?? 0) > APP_VERSION_CODE) {
        const el = document.createElement("div"); el.className = "toasts"; el.style.pointerEvents = "auto";
        el.innerHTML = `<div class="toast ok">ArcTools ${m.version} is out. <a href="https://arctools.fun/assets/app/${m.file}" style="color:var(--up);font-weight:700">Download</a></div>`;
        document.body.appendChild(el); setTimeout(() => el.remove(), 12_000);
      }
    }).catch(() => undefined);
  }, []);

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
        {TABS.map(([k, l, Ic, to]) => <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => go(to)}><Ic className="" />{l}</button>)}
      </nav>
      <Toasts />
    </div>
  );
}
