# 83 - ArcTools Perps launch (video 30 s: marketing/video-perps/arcperps-30s.mp4, poster.jpg)

## X post (main)
ArcTools Perps is live.

Long or short tokenized stocks (NVDA, TSLA, CRCL, GME, HIMS) and the deepest Arc tokens (ARGUS, TOLLY, ARCT) with up to 3x leverage, 24/7, settled in native USDC on Arc.

- one click from the ArcTools trading wallet, no popups
- live PnL, funding and liquidation price
- fees 0.1% open / 0.1% close: 70% to the fund, 30% buys back and burns ARCT
- anyone can be the house: deposit USDC into the fund and earn the fee share

v1 = market orders, max 2,000 USDC per position. Limit and TP/SL next.

arctools.fun/perps

## Reply 1 (how prices work)
Prices: Arc tokens use a 5-minute USDC-weighted TWAP of the pool from our own index. Stocks use live equity quotes when fresh; off-hours the pool TWAP clamped to a 7% corridor and leverage drops to 2x. The operator signs the price, you attach it to your own transaction. No custody, no admin withdrawal of user funds.

## Reply 2 (risk)
Peer-to-pool with a fee-funded insurance fund covering at most half of the open-interest imbalance, per-market OI caps and an automatic pause if the fund draws down 15%. Leverage is risk: at 3x a 28% move against you liquidates. Start small.

## Notes
- Video: robot intro/outro reused from the feature film (no new generations), three real screenshots of /perps with an actual open NVDA short and a closed ARGUS long, EN VO (British RP narrator, Seed Audio descriptive prompt), captions, ducked music. 29.4 s, 1920x1080.
- Claims verified on-chain: contract 0xCB39e1ec980FF6dC5137141EC5858Fe9D7124291, fee split 70/30, fund 800 USDC seed, 8 active markets (ARCOON, WONK deactivated on-chain), E2E open/close via UI (pos #0 ARGUS long, #1 NVDA short).
