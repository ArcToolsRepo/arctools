# 30 — Terminal update: pro charts, self-healing data, desktop app in the works

Image: `30-terminal-update.png` (1600x900; real screenshots: Terminal table, token chart with fib/trend/measure; robot in ArcTools colors)

## Short (fits 280)

Terminal update, all live at arctools.fun/trade:

- TradingView-grade charts: 6 chart types, EMA/BB/VWAP/RSI/MACD, fib, trend, ray, measure, resize, fullscreen, PNG
- every row fills every time: MC, liquidity, Score and dev/bundle are checked every 3 min and repaired automatically
- Sniper bot: Maestro-style panels, fills in ~5 s

Desktop app in the works. More soon.

## First reply (link)

arctools.fun/trade — paste any CA or open a row to try the new chart. Draw a fib with two clicks, drag the handle under the chart to make it taller.

## Long version (X Premium)

Terminal update. Everything below is live at arctools.fun/trade.

Charts, rebuilt:
- 6 chart types: candles, hollow, bars, line, area, Heikin Ashi
- indicators with live values in the legend: MA 20/50, EMA 20/50/200, Bollinger, VWAP, volume MA, RSI and MACD in their own panes
- drawing tools that stick to the token and timeframe: horizontal level, trend line, ray, Fibonacci retracement, measure (change %, bars, time, volume)
- log / linear / percent scale, magnet crosshair, countdown to the next bar, fullscreen, PNG export, drag-to-resize

Data, self-healing:
- market cap, liquidity, Token Score and dev/bundle share on the top rows are verified every 3 minutes; a miss triggers a repair on the spot (supply refetch across three RPCs, risk recompute) and shows up in the System pill
- Score and dev/bundle now load straight from the swap index, no extra hop

Sniper bot (@ArcSniper_bot):
- Maestro-style buy and position cards: price, MC, liquidity, 5m/1h/24h, buys/sells, your entry, worth, PnL
- correct venue every time (V3 tier by real quote, else V4 pool), fills in about 5 seconds, positions priced on any venue

Also: five languages (English, Chinese, Spanish, Russian, Polish) and light/dark theme across the whole site.

Desktop app: the Terminal as a native Windows / macOS application is in the works. More information soon.

## Telegram (caption)

🟢 Terminal update

Pro charts (6 types, indicators, fib/trend/measure, resize, fullscreen), self-healing data (MC, liquidity, Score checked and repaired every 3 min), Maestro-style sniper panels with ~5 s fills.

Desktop app in the works — more soon.

👉 arctools.fun/trade
