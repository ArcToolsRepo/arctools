# 72 — ArcLocker

## Main post

ArcLocker is live.

Lock what you promised to lock — and let the token page prove it.

- Tokens and team allocations, with a cliff or linear vesting
- Uniswap V2 LP tokens
- Uniswap V3 positions (swap fees stay collectable while locked)
- Uniswap v4 positions

The rules are simple because they have to be: the unlock date can only move later. There is no admin key over your assets. The only emergency path returns them to you, the lock owner, after a public 48-hour notice on-chain — never anywhere else.

Every lock shows on the token's ArcTools page: "LP locked · 62% of pool until Mar 2027". Extend, transfer, collect, withdraw: free. 50 USDC per new lock, spent on ARCT buyback and burn.

arctools.fun/locker · also in ArcOne (More → Locker)
Contract: 0x07868eB2E92D4F1D9967f6Dc3B8a8Af5623Dbb94 · source on GitHub

## Short variant

ArcLocker: lock tokens, V2 LP, Uniswap V3 and v4 positions on Arc. Extend-only, no admin key, shows on the token page. 50 USDC per lock. arctools.fun/locker

## Notes
- "No admin key over your assets" is exact: the rescue path can only send to the lock owner, after announceRescue + 48 h. Say exactly that if asked; do not say "no admin functions at all" (fee/exempt list are owner-settable).
- Tested on mainnet with real transactions (vesting math, V3 position lock + fee collect + withdraw). Not a third-party audit — say "internal review, source public".
