# 60 — Swap tab announcement

## Main post

New tab: Swap.

arctools.fun/swap

One router for everything on Arc. Paste a contract address or search by name, and the token comes up with the launchpad it was born on — Hopium, Minara, Lift, ArcPad, UBI.fun, peach.ag, Tolly, a plain Uniswap pool, whatever it is. If nobody indexed it yet, you can still swap it: the router goes looking for its pool.

Every quote is live. Uniswap V3, Uniswap V4, launchpad bonding curves and the wrapped-stock pairs are all priced at once, and when splitting the order across two venues pays more, it splits — you see the route before you sign, together with the rate and the minimum you will receive.

Slippage is yours. 0.5%, 1%, 5% or a number you type; it is remembered between visits and the minimum received updates with it. No hidden auto-slippage, no "optimal" setting deciding for you.

The fee is 0.5% of the USDC side, taken by the router contract in the same transaction — not by the page. It is spent buying ARCT on the open market, and every token bought goes straight to the burn address in that same buyback transaction. The counter under the card only moves when a buyback actually lands on chain; nothing there is a projection.

Swap, and the fee comes back to the token.

arctools.fun/swap

## Short variant

New tab: Swap. Every token on Arc in one router — paste a contract, see its launchpad, set your own slippage, watch the route split across Uniswap V3, V4 and launchpad curves. 0.5% per swap, in USDC, spent buying ARCT back and burning it.

arctools.fun/swap

## Notes
- Fee is enforced on chain (ArcAggregator, feeBps = 50). Verified with a live 0.5 USDC buy: 0.002500 USDC landed at the treasury.
- Do NOT claim buybacks are running yet — the keeper ships disabled until the budget is set. The counter reads 0 until the first buyback transaction.
- The card's border animation is decorative; mention "route shown before you sign" rather than "MEV protection", which we do not provide.
