import "./shim";
const HW = await import("../src/lib/arc-hotwallet"); await HW.importWallet(process.env.E2E_KEY!, "passw0rd"); await HW.unlock("passw0rd");
const { renderToString } = await import("react-dom/server"); const React = await import("react");
const { Launch } = await import("../src/screens/Launch");
const html = renderToString(React.createElement(Launch));
const has = (s: string) => html.includes(s);
console.log("len", html.length, "| picture:", has("launch__pic"), "| TICKER:", has("TICKER"), "| description:", has("Description (optional)"), "| modes:", has("Bonding curve") && has("Instant Uniswap"), "| first buy:", has("Buy first"), "| taxes:", has("Taxes on trades"), "| CTA:", has("Launch token on the curve"));
