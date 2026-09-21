/** Browser globals the app's libs expect, for Node/Bun test runs. */
const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };
(globalThis as any).localStorage = storage;
(globalThis as any).sessionStorage = { ...storage, getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
(globalThis as any).window = globalThis;
(globalThis as any).document = { addEventListener: () => undefined, visibilityState: "visible" };
(globalThis as any).navigator = { userAgent: "node", vibrate: () => false };
export {};
(globalThis as any).location = { hash: "#/", href: "https://localhost/#/", search: "" };
(globalThis as any).history = { back: () => undefined, pushState: () => undefined, replaceState: () => undefined };
(globalThis as any).addEventListener = () => undefined; (globalThis as any).removeEventListener = () => undefined;
