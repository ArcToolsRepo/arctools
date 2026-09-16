# 44 — faze.fun added to the Terminal (X post)

## Main post

faze.fun is live in the ArcTools Terminal.

350 coins indexed, every one with its artwork and name. But the part that took the work: faze runs its own bonding curve, so a coin that has not graduated has no Uniswap pool — most screeners show it as a blank row.

We decode the curve itself. Buys and sells read straight off the chain, price and FDV live while the curve fills, and when it graduates into the locked V4 pool the coin keeps its faze label and carries on in the same chart.

One tap to buy, whether it is still on the curve or already in the pool.

27 launchpads labelled and counting.

arctools.fun

## Alt text

ArcTools card announcing faze.fun support: 350 coins indexed, 100% with artwork, curve trades decoded, list of what ArcTools reads from the faze bonding curve.

## Thread continuation (optional)

2/ Why a bonding curve is harder than a pool: there is no pair to read, no reserves to price against, no Swap event to parse. Every launchpad invents its own. We decode faze's two curve events directly — the chart exists from the very first buy, not from graduation.

3/ Graduated faze coins move into a Uniswap V4 pool whose LP NFT is burned to 0x…dEaD — liquidity nobody can pull, not the creator, not the platform. Those pools are indexed behind their hook, so nothing breaks at the handover.

## Notes

- Numbers verified in production: 350 faze rows in /api/tokens, all with logo and market cap.
- Keep "27 launchpads labelled" in sync with FACTORIES in pads_registry.py.
