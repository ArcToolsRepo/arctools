# 61 — first swap-fee buyback (burn counter)

## Main post

The first swap fees just came back to the token.

10.70 USDC of router fees bought 35,354.85 ARCT on the open market, and the tokens went straight to the burn address in the same transaction — the keeper never holds them.

0x0bc6be56ab04a4d2a8baac85baf81b96946a59e6cf1869b1e8e5f69460c33850

That brings the total burned to 56,017,944 ARCT — 5.60% of the supply, 965.7M left.

How it works: you swap on arctools.fun/swap, the router takes 0.5% in USDC in the same transaction, and the keeper spends exactly those fees buying ARCT and burning it. Nothing is minted to pay for it, nothing is pooled, and there is no schedule to miss. The counter under the swap card only moves when a buyback transaction lands on chain — if the fees are small, the burn is small, and if nobody swaps, nothing happens at all.

Every burn from here is somebody's trade.

arctools.fun/swap

## Short variant

First swap-fee buyback is on chain: 10.70 USDC bought 35,354.85 ARCT and burned it in the same transaction. Total burned 56,017,944 ARCT — 5.60% of supply.

0x0bc6be56ab04a4d2a8baac85baf81b96946a59e6cf1869b1e8e5f69460c33850

arctools.fun/swap

## Notes
- Numbers read from /api/arct-burn and /api/buyback-stats on 18.09.2026: burned 56,017,944.66 (5.602%), supply left 965,748,078, first buyback 10.70 USDC → 35,354.85 ARCT.
- Total burned includes earlier burns, not only buybacks — say "total burned", never "burned by buybacks".
- The keeper keeps a 10 USDC operating reserve (relayer gas for pay links and referral payouts); do not claim it spends the whole treasury.
