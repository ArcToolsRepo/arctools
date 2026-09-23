import "./shim";
const { Window } = await import("happy-dom"); const win = new Window({ url: "https://arctools.fun/" }); (globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).HTMLElement = win.HTMLElement; (globalThis as any).Image = win.Image; (globalThis as any).navigator = win.navigator;
const React = await import("react"); const { createRoot } = await import("react-dom/client"); const { act } = await import("react");
const HW = await import("../src/lib/arc-hotwallet"); await HW.importWallet(process.env.E2E_KEY!, "passw0rd"); await HW.unlock("passw0rd");
for (const [name, mod] of [["Predict", "../src/screens/Predict"], ["Market", "../src/screens/Market"]] as const) {
  const C = (await import(mod)).default; const el = document.createElement("div"); document.body.appendChild(el); const root = createRoot(el);
  await act(async () => { root.render(React.createElement(C)); }); await new Promise((r) => setTimeout(r, 6000)); await act(async () => {});
  const t = el.textContent ?? ""; console.log(`${name}: ${t.length} chars |`, name === "Predict" ? `live=${/LIVE #\d+/.test(t)} next=${/NEXT #\d+/.test(t)} rounds=${/RECENT ROUNDS/.test(t)} btnUp=${/▲ UP/.test(t)}` : `gigs=${(t.match(/USDC/g) || []).length} banner=${/banner slot/i.test(t)} loading=${/Loading/.test(t)}`);
  root.unmount();
}
