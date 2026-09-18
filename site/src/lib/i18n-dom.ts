/**
 * Whole-page translation without touching every component: after React renders (and on every DOM mutation) we walk the
 * text nodes + title/placeholder/aria-label attributes under <body>, look each English string up in the dictionary and
 * swap it. Project names, tickers, addresses and numbers never match a dictionary key, so they stay as they are.
 * Elements (or subtrees) marked `data-notranslate` are skipped. Switching language re-translates from the remembered
 * English originals. The dictionary is loaded lazily, only when the language is not English.
 */
import type { Lang } from "./i18n";

type Dict = Record<string, string>;
const originals = new WeakMap<Node, string>();          // text node → English
const attrOriginals = new WeakMap<Element, Record<string, string>>();
let dict: Dict | null = null;
let currentLang: Lang = "en";
let observer: MutationObserver | null = null;
let scheduled = false;
const ATTRS = ["title", "placeholder", "aria-label"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "NOSCRIPT"]);

/** Audit hook: every English-looking string the dictionary could not translate (read it as window.__i18nMisses). */
const misses = new Set<string>();
if (typeof window !== "undefined") (window as unknown as { __i18nMisses: Set<string> }).__i18nMisses = misses;
const LOOKS_ENGLISH = /[A-Za-z]{3,}/;
const NOT_TEXT = /^(0x[0-9a-fA-F]{6,}|[\d\s.,%$+\-–—:/·…()KMBkmb]+|https?:\/\/\S+|@\w+|\$?[A-Z0-9]{2,12})$/;

function lookup(en: string): string | null {
  if (!dict) return null;
  const key = en.trim().replace(/\s+/g, " ");   // multi-line JSX paragraphs arrive with newlines + indentation
  if (!key) return null;
  const hit = dict[key];
  if (hit) return en.replace(en.trim(), hit);
  const tr = translateKey(key);
  if (tr) return en.replace(en.trim(), tr);
  if (LOOKS_ENGLISH.test(key) && !NOT_TEXT.test(key) && key.length < 400) misses.add(key);
  return null;
}

/** Composite strings: "2 red flags", "(3 older than …)", "dev holds 20% · top-10 hold 49%", "Foo:" → translate the parts. */
function translateKey(key: string, depth = 0): string | null {
  if (!dict || depth > 3) return null;
  const direct = dict[key];
  if (direct) return direct;
  // wrapping punctuation
  let m = key.match(/^([(\[]\s*)(.*?)(\s*[)\]])$/);
  if (m) { const inner = translateKey(m[2], depth + 1); if (inner) return m[1] + inner + m[3]; }
  // trailing decoration ":" "→" "↗" "·" "…"
  m = key.match(/^(.*?)(\s*[:→↗·…]+)$/);
  if (m && m[1] !== key) { const inner = translateKey(m[1].trim(), depth + 1); if (inner) return inner + m[2]; }
  // leading number / amount: "2 red flags", "14 on chart", "$1.5M vol"
  m = key.match(/^([-+]?[$€]?[\d.,]+[KMB%]?\s+)(.+)$/);
  if (m) { const inner = translateKey(m[2].trim(), depth + 1); if (inner) return m[1] + inner; }
  // trailing number: "dev holds 20%"
  m = key.match(/^(.+?)(\s+[-+]?[$]?[\d.,]+[KMB%]?)$/);
  if (m) { const inner = translateKey(m[1].trim(), depth + 1); if (inner) return inner + m[2]; }
  // "registered 12d ago", "2d ago", "age 12d"
  m = key.match(/^(.*?)\s*(\d+(?:\.\d+)?[smhdwy])\s+ago$/);
  if (m) { const pre = m[1].trim(); const preT = pre ? (translateKey(pre, depth + 1) ?? pre) : ""; const ago = dict["ago"] ?? "ago"; return `${preT ? preT + " " : ""}${m[2]} ${ago}`.trim(); }
  m = key.match(/^(.*?)\s*(\d+(?:\.\d+)?[smhdwy])$/);
  if (m && m[1].trim()) { const inner = translateKey(m[1].trim(), depth + 1); if (inner) return `${inner} ${m[2]}`; }
  // segments joined by " · "
  if (key.includes(" · ")) {
    const parts = key.split(" · ");
    const out = parts.map((p) => translateKey(p.trim(), depth + 1) ?? p);
    if (out.some((o, i) => o !== parts[i])) return out.join(" · ");
  }
  return null;
}

function skip(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName) || e.hasAttribute("data-notranslate")) return true;
  }
  return false;
}

function translateText(n: Text) {
  const parent = n.parentElement;
  if (!parent || skip(parent)) return;
  const en = originals.get(n) ?? n.nodeValue ?? "";
  if (!originals.has(n)) originals.set(n, en);
  const want = currentLang === "en" ? en : (lookup(en) ?? en);
  if (n.nodeValue !== want) n.nodeValue = want;
}

function translateAttrs(el: Element) {
  if (skip(el)) return;
  let store = attrOriginals.get(el);
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur == null) continue;
    if (!store) { store = {}; attrOriginals.set(el, store); }
    if (!(a in store)) store[a] = cur;
    const en = store[a];
    const want = currentLang === "en" ? en : (lookup(en) ?? en);
    if (cur !== want) el.setAttribute(a, want);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { translateText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  const el = root as Element;
  if (root.nodeType === Node.ELEMENT_NODE) { if (SKIP_TAGS.has(el.tagName)) return; translateAttrs(el); }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let cur = tw.nextNode();
  while (cur) {
    if (cur.nodeType === Node.TEXT_NODE) translateText(cur as Text);
    else translateAttrs(cur as Element);
    cur = tw.nextNode();
  }
}

function schedule(nodes?: Node[]) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    observer?.disconnect();
    try { if (nodes) for (const n of nodes) walk(n); else walk(document.body); translateTitle(); } finally { observe(); }
  });
}

function observe() {
  if (!observer) {
    observer = new MutationObserver((muts) => {
      const nodes: Node[] = [];
      for (const m of muts) {
        if (m.type === "characterData") {
          // React changed the text (a number arrived, "…" became a score): that NEW text is the English original now.
          // Without this the cached first value ("—") was re-applied and every in-place update on the site was reverted.
          originals.set(m.target, m.target.nodeValue ?? "");
          nodes.push(m.target);
        } else if (m.type === "attributes") {
          const el = m.target as Element; const a = m.attributeName ?? "";
          const store = attrOriginals.get(el);
          if (store && a in store) store[a] = el.getAttribute(a) ?? "";
          nodes.push(m.target);
        } else m.addedNodes.forEach((n) => nodes.push(n));
      }
      if (nodes.length) schedule(nodes.length > 200 ? undefined : nodes);
    });
  }
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

let titleEn: string | null = null;
function translateTitle() {
  if (titleEn === null || !document.title.startsWith(titleEn.split(" · ")[0].slice(0, 8))) titleEn = document.title;
  let want = currentLang === "en" ? titleEn : (lookup(titleEn) ?? titleEn);
  if (want === titleEn && currentLang !== "en" && dict) {
    // "LONG · LONG on Arc: chart, trades, swap" → keep the ticker/name, translate the fixed tail
    const m = titleEn.match(/^(.*?) (on Arc: chart, trades, swap)$/);
    if (m && dict[m[2]]) want = `${m[1]} ${dict[m[2]]}`;
  }
  if (document.title !== want) document.title = want;
}

/** Apply `lang` to the whole document (idempotent; call on every language change). The first pass is synchronous once the
 *  dictionary is in memory, and the page stays hidden (data-i18n-pending, set by the head script) until it has run — no
 *  flash of English. */
export async function applyLanguage(lang: Lang) {
  if (typeof document === "undefined") return;
  currentLang = lang;
  misses.clear();
  if (lang !== "en") {
    // one small JSON per language (generated at build: scripts/gen-i18n.ts → public/i18n/<lang>.json, ~30 KB) instead of the
    // 156 KB five-language module; the module stays as fallback when the JSON is missing
    try {
      const r = await fetch(`/i18n/${lang}.json`, { cache: "force-cache" });
      if (!r.ok) throw new Error(String(r.status));
      dict = (await r.json()) as Dict;
    } catch {
      const m = await import("./i18n-dict");
      dict = m.dictFor(lang);
    }
  }
  observer?.disconnect();
  walk(document.body);
  translateTitle();
  observe();
  delete document.documentElement.dataset.i18nPending;
}
