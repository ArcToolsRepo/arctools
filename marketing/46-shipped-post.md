# 46 — Shipped today (X post)

## Main post

Shipped to arctools.fun today:

Alpha stopped being empty. It was only ever showing one of three plays — fresh launches with smart money inside the first hour, which fires a few times a day. All three now score in a single pass, plus volume surge, buyer acceleration and first-time buyers. 1 token became 16.

Profile loads in 0.14s. One query behind it was taking 14.1 seconds on every visit; it now answers in 0.34 and the page no longer waits on it at all.

PnL for closed positions. Realized, unrealized and total, with every position you have ever closed listed underneath — not just what you still hold.

Live ARCT burn counter in the top bar. 50.6M burned, 5.03% of supply, read from the chain every 45 seconds.

Curve progress on every row. A faze or sharc coin shows exactly how full its raise is before it graduates into a locked pool.

Top 10 ranked. Gold, silver, bronze, then fading to tenth — tinted under 9% so no number gets harder to read.

Charts open from Telegram. The engine failing to start used to leave a blank box; now it says so and offers a retry.

Logos pulled out of token contracts. Most Arc tokens never touch a launchpad API, but the links are often sitting in the bytecode. 1,690 logos came from there.

arctools.fun

## Thread continuation (optional)

2/ On Alpha: the criteria did not move. Fresh still needs a token under an hour old, eight distinct buyers, no round-trip flow, not already down 40% from its high, and at least one smart-money or KOL signal. What changed is that accumulation and revival now feed the same list instead of sitting behind a query parameter nobody used.

3/ On the burn counter: it reads totalSupply and the dead-address balance directly, so it counts both kinds of burn — tokens taken out of supply and tokens parked where nobody can move them. No spreadsheet, no announcement needed, it just goes up.

4/ Everything above is live now. Three launchpads joined the same week: faze.fun, sharc.fun and creo.family, 713 coins between them.

## Alt text (if posting with graphic 45)

ArcTools Terminal screenshot with ranked top-10 rows, next to cards for the faze.fun, sharc.fun and creo.family launchpads.

## Notes

- Numbers verified in production on 16 Sep 2026: alpha 16 rows, profile 0.137s, balance-moves 0.34s cached, burn 50,276,113 ARCT / 5.028%.
- Pair with graphic 45 (45-launchpads-live.png) or post plain.
