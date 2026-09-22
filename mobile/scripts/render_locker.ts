import "./shim";
const HW = await import("../src/lib/arc-hotwallet"); await HW.importWallet(process.env.E2E_KEY!, "passw0rd"); await HW.unlock("passw0rd");
const { renderToString } = await import("react-dom/server"); const React = await import("react");
const Locker = (await import("../src/screens/Locker")).default;
const html = renderToString(React.createElement(Locker));
const has = (s: string) => html.includes(s);
console.log("len", html.length, "| modes:", has("Uniswap V3 position") && has("Uniswap v4 position"), "| durations:", has("1 yr"), "| vesting:", has("Vesting after unlock"), "| my locks:", has("My locks"), "| CTA:", has("Lock"));
process.exit(0);
