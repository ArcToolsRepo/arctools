import { BOT_API } from "./bot-api";

/** Real-user render check. 8 s after a page settles, count the placeholders still on screen ("—", "…", "loading")
 *  against the number of data cells, and ping the watchdog (anonymous, ~200 bytes, at most one per page view).
 *  The watchdog aggregates this per page every round: a tab that users see empty gets flagged and repaired even
 *  when every API answers fine from the server's point of view. */
const PLACEHOLDER = /^(—|–|-|…|\.\.\.|loading…?|checking…?|reading[^…]*…|\?)$/i;
let last = "";

function pageKey(path: string): string {
  if (path.startsWith("/token/")) return "/token";
  if (path.startsWith("/insider/")) return "/insider";
  if (path.startsWith("/x/")) return "/x";
  return path.replace(/\/+$/, "") || "/";
}

export function scheduleBeacon() {
  if (typeof window === "undefined") return;
  const path = location.pathname;
  const key = pageKey(path);
  const stamp = `${key}:${Math.floor(Date.now() / 60000)}`;
  if (stamp === last) return;
  last = stamp;
  setTimeout(() => {
    if (location.pathname !== path || document.hidden) return;
    const cells = Array.from(document.querySelectorAll("main .arc-mono, main td, main p"));
    let data = 0, empty = 0;
    for (const el of cells) {
      if (el.children.length > 2) continue;
      const t = (el.textContent ?? "").trim();
      if (!t || t.length > 40) continue;
      const isNum = /[\d$%]/.test(t);
      const isPh = PLACEHOLDER.test(t);
      if (isNum) data++;
      else if (isPh) empty++;
    }
    const body = JSON.stringify({ page: key, data, empty, lang: document.documentElement.lang || "en", w: window.innerWidth, ts: Math.floor(Date.now() / 1000) });
    try {
      if (!navigator.sendBeacon?.(`${BOT_API}/api/ui-beacon`, new Blob([body], { type: "application/json" }))) {
        void fetch(`${BOT_API}/api/ui-beacon`, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => null);
      }
    } catch { /* ignore */ }
  }, 8000);
}
