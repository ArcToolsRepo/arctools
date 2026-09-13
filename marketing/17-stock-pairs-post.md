# X post — Stock pairs (graphic: marketing/17-stock-pairs-robot.png)

## Main post

ArcTools update: tokenized stocks are now a first-class pair on Arc.

LAUNCH
- ArcToolsPad lets you launch a token paired with a wrapped stock: CRCL, NVDA, SPY, TSLA, AAPL, GME, AMC, HIMS, SNAP, SPCX, OPENAI, ANTHROPIC or WETH (long.supply IOUs bridged from Robinhood Chain).
- The form checks the stock's USDC pool on-chain and tells you before you sign whether that pair is safe, thin or dangerous for your buyers. It also simulates the launch and shows the exact reason if it would revert.

TRADE
- Every stock-paired token trades for plain USDC on arctools.fun and in @ArcSniper_bot. Our aggregator buys the stock and swaps it into the token in one transaction, and sells the same way. No bridge, no stock balance needed.
- Works for tokens launched on ArcToolsPad and for the 180+ tokens on long.supply's own pools. When a token also has a USDC pool, the router quotes both routes and takes the better fill.

TERMINAL
- New chips: Stock pairs and Stocks. Every row shows its quote token (/CRCL, /NVDA) and wrapped stocks carry an IOU badge instead of a risk score, because the risk there is the custodian, not the deployer.
- Token pages show the real market (stock-quoted pool, liquidity, USD price derived through the stock) and an honest note about what a wrapped stock is.

Also shipped: every row now carries volume, trades, change and ATH (not only the trending top 100), logos and metadata are remembered and self-heal after upstream outages, sniper bot responses are several times faster, and token pages render instantly.

Link in the first reply.

## First reply

Launch: https://arctools.fun/launchpad
Terminal, Stock pairs chip: https://arctools.fun/trade
Sniper: https://t.me/ArcSniper_bot

## Short version (under 280)

You can now launch a token on Arc paired with tokenized stocks (CRCL, NVDA, SPY, TSLA and more) and anyone can buy it with plain USDC. ArcTools routes the stock hop in one transaction, on the site and in the sniper. Link below.
