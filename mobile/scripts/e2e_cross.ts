import "./shim";
const { Window } = await import("happy-dom"); const win = new Window({ url: "https://arctools.fun/" }); (globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).HTMLElement = win.HTMLElement; (globalThis as any).navigator = win.navigator;
const React = await import("react"); const { createRoot } = await import("react-dom/client"); const { act } = await import("react");
const HW = await import("../src/lib/arc-hotwallet"); await HW.importWallet(process.env.E2E_KEY!, "passw0rd"); await HW.unlock("passw0rd"); console.log("wallet", HW.hotAddress());
const Cross = (await import("../src/screens/Cross")).default;
const el = document.createElement("div"); document.body.appendChild(el); const root = createRoot(el);
await act(async () => { root.render(React.createElement(Cross, { token: "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52" })); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// pick Arbitrum, amount 1
await act(async () => { ([...el.querySelectorAll("button")] as any[]).find((b) => b.textContent === "Arbitrum").click(); });
const inp = ([...el.querySelectorAll("input")] as any[]).find((i) => i.inputMode === "decimal");
await act(async () => { const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!; setter.call(inp, "1"); inp.dispatchEvent(new win.Event("input", { bubbles: true })); });
for (let i = 0; i < 20; i++) { await wait(1000); await act(async () => {}); if (/You pay on Arbitrum/.test(el.textContent ?? "") && !/refreshing|Quoting/.test(el.textContent ?? "")) break; }
console.log("QUOTE:", (el.textContent ?? "").match(/You pay on Arbitrum.*?Time~\d+ s/)?.[0]);
const pay = ([...el.querySelectorAll("button")] as any[]).find((b) => b.textContent.startsWith("Pay "));
console.log("pay button:", pay?.textContent, "disabled", pay?.disabled);
if (process.env.SEND !== "1") { root.unmount(); process.exit(0); }
await act(async () => { pay.click(); });
for (let i = 0; i < 120; i++) { await wait(2000); await act(async () => {}); const t = el.textContent ?? ""; if (/Done — buy again|Fill failed|Still pending|Simulation failed|Wallet locked|refunded/.test(t)) break; }
console.log("LOG:", (el.textContent ?? "").match(/Paid on Arbitrum.*$/)?.[0]?.slice(0, 300));
root.unmount(); process.exit(0);
