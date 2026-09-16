# 45 — faze / sharc / creo live in the Terminal (X post)

## Main post

Three more launchpads are in the ArcTools Terminal: faze.fun, sharc.fun, creo.family.

713 coins between them, each with its own artwork, name and socials, and for the curve pads a fill bar showing exactly how far the raise is from graduating into a locked pool.

The hard part was never the listing. faze runs its own bonding curve, so a coin that has not graduated has no Uniswap pool and no Swap event to read — we decode the curve itself. creo launches through o1 infrastructure, which on-chain is indistinguishable from another pad, so attribution comes from each front-end's own feed.

Shipped in the same pass: top-10 ranked and tinted, a live ARCT burn counter, logos read straight out of token contracts, and Alpha now scoring every play instead of one.

arctools.fun

## Alt text

ArcTools card showing the live Terminal token table with ranked rows, next to cards for faze.fun (362 coins), sharc.fun (303 coins) and creo.family (48 coins).

## Notes

- Screenshot is the real production Terminal, taken after this deploy.
- Coin counts read from /api/pad-tokens on 16 Sep 2026.
- "29 launchpads labelled" = FACTORIES + the feed-backed pads; keep in sync with pads_registry.py.
