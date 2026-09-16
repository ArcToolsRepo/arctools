# 24 — Charts upgrade

Image: `24-charts-upgrade.png` (1600x900)

## Short (fits 280)

Every Arc chart, upgraded.

TA toolbar on every token: MA20/50, EMA20, Bollinger, VWAP, RSI pane, price levels, log/linear.

Market caps now priced on what actually trades on Arc, not off-chain reference quotes.

Token pages open in 0.6 s. Lift, eve.fun and Ellipse pools chart from the first swap.

## First reply (link)

arctools.fun/trade

Pick any token, hit the buttons top-right of the chart. Indicators are remembered per browser.

## Long version (X Premium)

Every Arc chart, upgraded.

TA toolbar on every token page: MA20, MA50, EMA20, Bollinger Bands, VWAP, an RSI pane with 30/70 levels, click-to-place horizontal levels and a log/linear toggle. Your selection is remembered.

Real market caps. long.supply pairs used to be valued through the reference stock price. On Arc the wrapped CRCL IOU trades at roughly a third of NYSE, so LONG showed $15M while the chart said under $1M. Now every stock-quoted pair is priced on the deepest USDC pool of the IOU it trades against. Same number in the Terminal and on the chart.

Faster token pages. First render in about 0.6 s from our own index, on-chain details fill in behind. No skeletons, even when public RPCs are struggling.

New launchpads chart properly. Lift, eve.fun and Ellipse pools are picked up from the first swap; a pool the index missed gets backfilled the moment someone opens its page. Thin launch pools stay tradeable instead of being flagged as external.

Plus a faint ArcTools watermark on every chart, so screenshots keep their source.

arctools.fun/trade

## Telegram (caption)

🟢 Charts upgrade

TA toolbar on every token (MA, EMA, Bollinger, VWAP, RSI, levels, log). Market caps priced on what really trades on Arc. Token pages open in 0.6 s. Lift, eve.fun and Ellipse pools chart from the first swap.

👉 arctools.fun/trade
