import "./shim";
const t0 = Date.now(); const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const S = await import("../src/lib/store"); const TM = await import("../src/lib/token-meta");
await S.loadList(); console.log(`alive list: ${S.orders().all.length} rows (${lap()}) full=${S.hasFullList()}`);
await S.loadList(true, true); console.log(`full list: ${S.orders().all.length} rows (${lap()}) full=${S.hasFullList()}`);
await S.loadTrending(); const hot = S.orders().hot.slice(0, 8); await TM.loadMeta(hot);
const b = TM.peekBirthdays(hot); const now = Date.now() / 1000;
for (const c of hot) { const t = S.getToken(c); const seen = t?.createdAt ? Date.parse(t.createdAt) / 1000 : null; const mint = b.get(c); console.log(`  ${t?.symbol?.padEnd(8)} seen ${seen ? ((now - seen) / 3600).toFixed(1) : "-"}h  mint ${mint ? ((now - mint) / 3600).toFixed(1) : "-"}h  → age ${(((now - Math.min(mint ?? seen ?? now, seen ?? mint ?? now))) / 3600).toFixed(1)}h  logo ${S.getLogo(c) ? "y" : "n"}`); }
process.exit(0);
