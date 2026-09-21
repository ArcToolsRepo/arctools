import "./shim";
const HW = await import("../src/lib/arc-hotwallet"); await HW.importWallet(process.env.E2E_KEY!, "passw0rd"); await HW.unlock("passw0rd");
const S = await import("../src/lib/store"); await S.loadTrending(); await S.loadList(); const TM = await import("../src/lib/token-meta");
const hot = S.orders().hot.slice(0, 40); await S.loadLogos(hot); await TM.loadMeta(hot); await S.loadRisk(hot);
const { renderToString } = await import("react-dom/server"); const React = await import("react");
const ARCT = "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52";
const mods: Record<string, () => Promise<Record<string, unknown>>> = { Trending: () => import("../src/screens/Trending"), Token: () => import("../src/screens/Token"), Wallet: () => import("../src/screens/Wallet"), Swap: () => import("../src/screens/Swap"), More: () => import("../src/screens/More"), Watch: () => import("../src/screens/Watch"), Sub: () => import("../src/screens/Sub"), Native: () => import("../src/screens/Native"), Launch: () => import("../src/screens/Launch"), Archy: () => import("../src/screens/Archy") };
const cases: [string, string, unknown][] = [["Trending","Trending",{}],["Token","Token",{ ca: ARCT }],["Wallet","Wallet",{}],["Swap","Swap",{}],["More","More",{}],["Watch","Watch",{}],["Launch","Launch",{}],["Archy","Archy",{}],["Native","Pay",{}],["Native","Referrals",{}],["Native","Bridge",{}],["Native","Trades",{}],["Native","Traders",{}]];
for (const [mod, comp, props] of cases) {
  try { const m = await mods[mod](); const C = (m[comp] ?? m.default) as React.FC<any>; if (!C) { console.log(`SKIP ${mod}.${comp} (no export)`); continue; }
    const html = renderToString(React.createElement(C, props as any)); const rows = (html.match(/class="row"/g) || []).length; const loading = /Loading…|loading/i.test(html);
    console.log(`OK   ${mod}.${comp}: ${html.length} chars, rows=${rows}, loadingText=${loading}, imgs=${(html.match(/<img/g)||[]).length}`);
  } catch (e) { console.log(`FAIL ${mod}.${comp}: ${String((e as Error).message).slice(0, 140)}`); }
}
// Sub screens by route
try { const Sub = ((await import("../src/screens/Sub")) as any).default; for (const name of ["insiders","alerts","rewards","history","profile","settings","launchpad","pay","referrals","bridge","archy"]) { try { const html = renderToString(React.createElement(Sub, { route: { name } as any })); console.log(`OK   Sub/${name}: ${html.length} chars`); } catch (e) { console.log(`FAIL Sub/${name}: ${String((e as Error).message).slice(0, 120)}`); } } } catch (e) { console.log("Sub import fail", String(e).slice(0, 100)); }
process.exit(0);
