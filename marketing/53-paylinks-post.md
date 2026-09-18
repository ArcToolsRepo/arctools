# 53 — USDC pay links

## Main post

Send USDC with a link.

Type /send 5 in @ArcSniper_bot. You get a link. Share it anywhere — Telegram, X, Discord, a DM. Whoever opens it picks the wallet that should receive the money, and the USDC lands there on Arc.

The person collecting needs nothing up front: no wallet yet, no gas, no app. Open, paste an address (or tap "use my browser wallet"), done. If they do not have a wallet, "Open in Telegram" creates one for them in the sniper. If nobody collects, the link expires and the USDC comes back to you automatically.

Every link is its own record on-chain: who sent it, who collected it, when. Nothing pooled, nothing hidden — a transfer with a deferred recipient, and a 2% fee at collection.

Good for: onboarding a friend to Arc with their first dollar, paying out a giveaway to people who have not shared an address, tipping, splitting a bill, airdrops to a Telegram group.

Contract: 0x9f3eEfD8b4158C09BF134fa6C032745a7D781BE6
Try it: /send in @ArcSniper_bot

## Short variant

/send 5 in @ArcSniper_bot gives you a link. Whoever opens it picks a wallet and the USDC lands there on Arc — no wallet or gas needed to collect, uncollected links come back to you. Every link is a visible on-chain record. 2% fee at collection.

## Notes
- Do not describe it as private/anonymous — it is the opposite: sender and recipient are on-chain for every link. That is the point.
- The link key travels in the URL fragment for the web link; anyone holding the link can collect, say so when someone asks.
- Minimum 0.1 USDC, expiry 1 h – 90 d (default 72 h).
