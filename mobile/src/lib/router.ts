/** Hash router — works from file:// and any WebView base without server config. #/token/0x… etc. */
import { useEffect, useState } from "react";

export type Route =
  | { name: "trending" } | { name: "watch" } | { name: "swap"; token?: string } | { name: "wallet" } | { name: "more" }
  | { name: "token"; ca: string } | { name: "insiders" } | { name: "launchpad" } | { name: "pay" } | { name: "referrals" }
  | { name: "bridge" } | { name: "rewards" } | { name: "alerts" } | { name: "profile"; wallet?: string } | { name: "settings" }
  | { name: "send" } | { name: "receive" } | { name: "history" } | { name: "search" } | { name: "trades" } | { name: "traders" };

export function parse(hash: string): Route {
  const h = (hash || "#/").replace(/^#/, "");
  const [path, qs] = h.split("?");
  const q = new URLSearchParams(qs || "");
  const seg = path.split("/").filter(Boolean);
  switch (seg[0]) {
    case undefined: case "": case "trending": return { name: "trending" };
    case "watch": return { name: "watch" };
    case "swap": return { name: "swap", token: q.get("token") ?? undefined };
    case "wallet": return { name: "wallet" };
    case "more": return { name: "more" };
    case "token": return seg[1] ? { name: "token", ca: seg[1].toLowerCase() } : { name: "trending" };
    case "profile": return { name: "profile", wallet: seg[1] };
    case "insiders": case "launchpad": case "pay": case "referrals": case "bridge": case "rewards": case "alerts":
    case "settings": case "send": case "receive": case "history": case "search": case "trades": case "traders":
      return { name: seg[0] } as Route;
    default: return { name: "trending" };
  }
}

export const go = (to: string) => { if (location.hash !== `#${to}`) location.hash = to; };
export const back = () => { if (history.length > 1) history.back(); else go("/"); };

export function useRoute(): Route {
  const [r, setR] = useState<Route>(() => parse(location.hash));
  useEffect(() => {
    const on = () => setR(parse(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

/** which bottom tab a route belongs to (token pages light up Trending, sub-pages light up More) */
export const tabOf = (r: Route): "trending" | "watch" | "swap" | "wallet" | "more" => {
  switch (r.name) {
    case "trending": case "token": case "search": case "trades": return "trending";
    case "watch": case "alerts": case "traders": case "insiders": return "watch";
    case "swap": return "swap";
    case "wallet": case "send": case "receive": case "history": return "wallet";
    default: return "more";
  }
};
