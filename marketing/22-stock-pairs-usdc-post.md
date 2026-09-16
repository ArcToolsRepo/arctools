# X post — stock pairs with plain USDC

Attach: `22-stock-pairs-usdc.png`. No emoji. Link in first reply.

## Short version (fits 280)

Half of the new launches on Arc are paired with wrapped stocks: TOKEN/CRCL, TOKEN/NVDA, TOKEN/TSLA.

You do not need to hold the stock to trade them.

ArcTools routes USDC -> stock -> token in one transaction, both ways, best fill across the stock pool and the USDC pool.

Reply 1: https://arctools.fun/trade

## Long version (X Premium)

Stock-paired tokens on Arc, traded with plain USDC.

long.supply brought wrapped stocks to Arc (CRCL, NVDA, TSLA, SPY, AAPL, GME and more) and launchpads started pairing new tokens against them instead of USDC. Good for the ecosystem, annoying for a trader: to buy TOKEN/CRCL you first had to buy CRCL, then swap, then unwind the same way on exit. Two extra trades, two extra fees, and a stock leg sitting in your wallet.

ArcTools does it in one transaction. The aggregator takes your USDC, buys the exact stock leg it needs, swaps it into the token and delivers the token to your wallet. Selling reverses the path and you get USDC back. Nothing to pre-buy, nothing left over.

It also checks the direct USDC pool when one exists and takes whichever route fills better, with slippage protection on the final leg.

Works everywhere on the site: quick-buy from the Terminal (chip: Stock pairs), the token page, positions, and in the sniper bot. Every stock pair on Arc: long.supply launches, ArcToolsPad stock-quoted curves, Uniswap V3 pools. Fee 1.5%, same as any other swap.

Reply 1: https://arctools.fun/trade
Reply 2: Example, LONG/CRCL: https://arctools.fun/token/0x2164bb17a2d38c1b5170e987b2c0416df1efc752
