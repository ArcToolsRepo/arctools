# 64 — What the Terminal sees in one day (real numbers, 20 Sep 2026)

## Main post

One day on Arc, as our own index saw it yesterday:

704,877 swaps.
33,470 wallets that traded.
181,568 wallets seen this week.
$51.4M in volume across 6,186 tokens.
24 launchpads, in one table.

That is what the ArcTools Terminal is built on. Not a scraper, not someone else's API — our own node, our own index, a swap in the table as its block closes.

What you do with it:
— every launchpad in one list, with price, cap, liquidity and 5M/1H/6H/24H
— one-click buys from a wallet that never leaves your browser
— dev and bundle risk on every row: net dev activity, launch-block wallets, a sell simulation before you buy
— the insider index: the wallets that were early last time, ranked by what they actually made
— clone farms hidden — one name minted eighty times does not get to own your screen

Mobile app: next week.

arctools.fun

## Short variant

704,877 swaps. 33,470 wallets. $51.4M volume. 24 launchpads. One day on Arc, one table — from our own index, live on the chain head.

arctools.fun

## Notes
- Every number is from /api/db-maint?action=wallets and /api/trending?minutes=1440 at 08:55 UTC, 20 Sep 2026. Re-pull before publishing if it is a different day.
- "wallets seen this week" = distinct wallets with at least one swap in 7 d. Do not call them "users".
- "Mobile app next week" is a commitment — confirm the date.
