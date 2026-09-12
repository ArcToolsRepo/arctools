# X post — Risk engine + Autopilot (graphic: marketing/16-risk-autopilot-robot.png)

## Main post

ArcTools update: the terminal now thinks before you click, and the sniper trades while you sleep.

RISK ENGINE (Terminal + every token page)
- Token Score 0-100 on every row. One number for deployer share, bundle share, whale concentration, dev and bundle selling, holder count.
- Rug database. We track every deployer on Arc. If they dumped before, the token gets a skull and the page shows which tokens they killed and how much they took out.
- Wallet labels in every trade list: insider #rank, dev of this token, launch-block buyer, fresh wallet, whale, dumped N tokens.
- Live DEV SOLD and BUNDLE SOLD badges plus red toasts the moment it happens.

AUTOPILOT (@ArcSniper_bot)
- Take-profit, stop-loss and trailing stop on any position. Set defaults once, they attach to every fill.
- Deployer-dump guard: if the dev or a launch-block wallet sells after you bought, the bot exits in the next block. Turbo gas, no confirmation.
- Limit buys by market cap: "buy 10 USDC when MC <= 25K".
- Auto-snipe rules: buy every new launch on the venues you pick that passes your filters (min score, max dev %, max bundle %, min liquidity, no known ruggers). Daily cap and max open positions built in.
- Copy-trade filters: minimum leader size, proportional sizing, max open copies, mirror sells.

Same fees as before. Same non-custodial wallet. Everything reads the same index that powers the Terminal.

Link in the first reply.

## First reply

Terminal with Token Score: https://arctools.fun/trade
Sniper: https://t.me/ArcSniper_bot -> Protection / Auto-snipe
Docs on how the score is built are on every token page under TOKEN SCORE.

## Short version (under 280)

ArcTools now scores every Arc token 0-100, tracks every deployer's rug history and labels wallets in the trade feed. The sniper got TP / SL / trailing, limit buys, auto-snipe rules and a deployer-dump guard that exits the block after the dev sells. Link below.
