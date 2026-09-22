# 75 — How ARCT burns

## Main post

Every fee on ArcTools ends the same way.

58.63M ARCT burned — 5.86 % of the 1B genesis supply, gone for good. Supply today: 963.4M. No mint function, no owner key.

How it works, in four steps:

1. You use a tool. Sniper 1 %, swap 0.5 %, bridge 2 %, ArcToolsPad 1 %, orders 1 %, pay links 2 %, locker 50 USDC, banners 250 USDC, ArcPredict 3 %.
2. The fee lands in one treasury: 0xb35c…5c0d. The same address in every contract and every screen — check it.
3. A keeper buys ARCT every 30 minutes. It routes through our own aggregator at the best price, pays no fee to itself, and sends the ARCT straight to 0x…dEaD. 34 automatic buybacks so far, 305K ARCT bought and burned by it.
4. Nobody can undo it. Tokens at the dead address cannot move; burn() lowers the supply. The counter in the top bar of arctools.fun reads the chain, not a database.

More volume on Arc, more fees. More fees, fewer ARCT. That is the whole design.

arctools.fun

## Short variant

58.63M ARCT burned (5.86 % of supply). Every ArcTools fee → one treasury → a keeper buys ARCT every 30 min → 0xdead. No mint, no owner, counter reads the chain. arctools.fun

## Notes
- Numbers come from /api/arct-burn and /api/buyback-stats at post time; compose_75.py re-reads them, so regenerate before posting.
- The 58.63M includes launch-time and earlier treasury burns; the keeper's own share is 305K — the graphic says so explicitly. Do not imply the keeper burned all of it.
- Do not write "deflationary token" as a promise of price; write what happens (fees → burn), not what it means for price.
