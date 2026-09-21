/** Run the BUILT app bundle (www/) in a real DOM with live APIs — what the WebView does, not what SSR does. */
import { Window } from "happy-dom";
import { readFileSync } from "fs";

const html = readFileSync("www/index.html", "utf8");
const win = new Window({ url: process.env.APP_URL || "https://localhost/", width: 390, height: 844, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
const doc = win.document;
doc.write(html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, ""));
// globals the bundle expects
const g = globalThis as any;
Object.assign(g, { window: win, document: doc, navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage, location: win.location, history: win.history, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, Event: win.Event, CustomEvent: win.CustomEvent, MutationObserver: win.MutationObserver, getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: (f: any) => setTimeout(f, 16), cancelAnimationFrame: clearTimeout, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, scrollTo() {}, innerWidth: 390, innerHeight: 844, devicePixelRatio: 2 });
class ES { url: string; constructor(u: string) { this.url = u; } addEventListener() {} close() {} onerror: any = null; }
g.EventSource = ES; g.window.EventSource = ES; g.window.matchMedia = g.matchMedia; g.window.ResizeObserver = g.ResizeObserver; g.window.scrollTo = () => {};
g.window.Capacitor = undefined;
const errors: string[] = [];
win.addEventListener("error", (e: any) => errors.push("window.error: " + (e.message || e.error?.message)));
const origErr = console.error; console.error = (...a: any[]) => { errors.push("console.error: " + a.map(String).join(" ").slice(0, 200)); };
process.on("unhandledRejection", (r) => errors.push("unhandledRejection: " + String((r as Error)?.message || r).slice(0, 200)));

// optional: preset state to test a scenario (stale prefs / tab)
if (process.env.PRESET) { for (const [k, v] of Object.entries(JSON.parse(process.env.PRESET))) win.localStorage.setItem(k, String(v)); }
if (process.env.HASH) win.location.hash = process.env.HASH;

const entry = html.match(/<script[^>]*src="([^"]*index[^"]*\.js)"/)![1];
const t0 = Date.now();
if (process.env.APP_URL) { const code = await (await fetch(process.env.APP_URL + entry.replace(/^\.?\//, ""))).text(); await import("data:text/javascript;base64," + Buffer.from(code.replace(/import\("\.\/([^"]+)"\)/g, (m, f) => `import("${process.env.APP_URL}assets/${f}")`).replace(/from"\.\/([^"]+)"/g, (m, f) => `from"${process.env.APP_URL}assets/${f}"`)).toString("base64")); } else await import("../www/" + entry.replace(/^\.?\//, ""));
const snap = (label: string) => {
  const rows = doc.querySelectorAll(".row").length; const empty = doc.querySelector(".empty")?.textContent ?? "";
  const chips = Array.from(doc.querySelectorAll(".chip")).map((c: any) => c.textContent.trim()).slice(0, 14);
  const header = doc.querySelector(".brand")?.textContent?.trim() ?? doc.querySelector("header")?.textContent?.trim().slice(0, 40);
  console.log(`[${label} +${((Date.now() - t0) / 1000).toFixed(1)}s] rows=${rows} imgs=${doc.querySelectorAll(".row img").length} empty="${empty.slice(0, 60)}" root=${doc.getElementById("root")?.innerHTML.length ?? 0}ch header="${header}" chips=${JSON.stringify(chips)}`);
};
for (const ms of [500, 2000, 5000, 9000, 14000]) { await new Promise((r) => setTimeout(r, ms - (Date.now() - t0) > 0 ? ms - (Date.now() - t0) : 0)); snap(`t${ms}`); }
const click = async (label: string) => { const el = Array.from(doc.querySelectorAll(".chip")).find((c: any) => c.textContent.trim().startsWith(label)) as any; if (!el) { console.log(`no chip "${label}"`); return; } el.click(); await new Promise((r) => setTimeout(r, 4000)); snap(`after "${label}"`); };
for (const l of ["Insider picks", "ArcToolsPad", "Trending", "New 15m", "Arguspad", "All"]) await click(l);
const nav = async (hash: string) => { win.location.hash = hash; win.dispatchEvent(new win.Event("hashchange")); await new Promise((r) => setTimeout(r, 5000)); const root = doc.getElementById("root")!; const txt = root.textContent!.replace(/\s+/g, " "); console.log(`[nav ${hash}] ${root.innerHTML.length}ch rows=${doc.querySelectorAll(".row").length} loading=${/Loading…|Loading\.\.\./.test(txt)} text="${txt.slice(0, 140)}"`); };
const first = doc.querySelector(".row"); if (first) console.log("first row:", first.textContent?.replace(/\s+/g, " ").slice(0, 160));
console.log("errors:", errors.length ? errors.slice(0, 8) : "none");
process.exit(0);
