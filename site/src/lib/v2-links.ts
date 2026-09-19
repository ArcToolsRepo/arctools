/** Keeping the v2 preview inside v2.
 *
 *  The v2 pages reuse the same components as the live site, and several of them link to v1 paths: the Terminal's
 *  row click navigates to /token/$ca, the chain search and the toasts link to /token/…, the wallet panel points at
 *  /bridge. Rewriting every component would fork the codebase, so v2 installs one capture-phase click guard that
 *  rewrites a v1 destination to its v2 twin. v1 never loads this file, so nothing about the live site changes.
 */

const PAGES = [
  "trade", "swap", "portfolio", "wallets", "rewards", "launchpad", "pay", "bridge",
  "insiders", "leaderboard", "scan", "intel", "profile", "referrals",
];

/** /token/0xabc → /token2/0xabc, /trade?pad=X → /trade2?pad=X. Anything else is returned untouched. */
export function toV2(href: string): string {
  if (!href.startsWith("/")) return href;
  const [path, rest] = [href.split(/[?#]/)[0], href.slice(href.split(/[?#]/)[0].length)];
  if (path.startsWith("/token/")) return `/token2/${path.slice("/token/".length)}${rest}`;
  const page = path.replace(/^\//, "").split("/")[0];
  if (PAGES.includes(page)) return `/${page}2${path.slice(page.length + 1)}${rest}`;
  return href;
}

export function isV2Path(pathname: string): boolean {
  const first = pathname.replace(/^\//, "").split("/")[0];
  return first.endsWith("2") && (first === "token2" || PAGES.includes(first.slice(0, -1)));
}

/** Install the guard. Returns the cleanup function. */
export function installV2LinkGuard(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement | null)?.closest?.("a");
    if (!a) return;
    if (a.target === "_blank" || a.hasAttribute("download")) return;
    // the version switch exists to leave v2; rewriting its href back to v2 made the button do nothing
    if (a.hasAttribute("data-leave-v2")) return;
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("/api/") || href.startsWith("/assets/") || href.startsWith("/bot/")) return;
    const dest = toV2(href);
    if (dest === href) return;
    // capture phase + preventDefault also stops the router's own Link handler
    e.preventDefault();
    e.stopPropagation();
    window.location.assign(dest);
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}


/** /token2/0xabc → /token/0xabc, /trade2?pad=X → /trade?pad=X. The inverse of toV2. */
export function toV1(href: string): string {
  if (!href.startsWith("/")) return href;
  const path = href.split(/[?#]/)[0];
  const rest = href.slice(path.length);
  if (path.startsWith("/token2/")) return `/token/${path.slice("/token2/".length)}${rest}`;
  const page = path.replace(/^\//, "").split("/")[0];
  if (page.endsWith("2") && PAGES.includes(page.slice(0, -1))) {
    return `/${page.slice(0, -1)}${path.slice(page.length + 1)}${rest}`;
  }
  return href;
}

/** The same page in the other version, keeping the query and hash. Returns null when there is no twin. */
export function counterpart(): { href: string; to: "v1" | "v2" } | null {
  if (typeof location === "undefined") return null;
  const here = location.pathname + location.search + location.hash;
  if (isV2Path(location.pathname)) {
    const v1 = toV1(here);
    return v1 === here ? null : { href: v1, to: "v1" };
  }
  const v2 = toV2(here);
  return v2 === here ? null : { href: v2, to: "v2" };
}
