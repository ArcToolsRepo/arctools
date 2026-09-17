# 48 — Terminal fixes (timeframes, Top volume, logos)

## Main post

Terminal update — three fixes shipped today.

Timeframes are real now. The per-token stats map was never cleared when you switched windows, so a token kept the numbers from whichever window it first loaded in. 1m / 5m / 1h / 6h / 24h now repaint the table. ARCT: $18.94 on 1m, $5,962 on 1h, $633,968 on 24h.

Top volume is an actual leaderboard. It was sorted by volume since launch while the column showed the selected window, so the ranking looked random. Same numbers now drive both, and no token is pinned on top of it.
CRCL $19.33M, USDC $11.27M, USDC $9.98M, DUKE, BOA.

Logos. The list never queried our own token index, only external screeners, so a token could show its artwork on its page and an empty circle in the table. 38 of the top 100 were in that state. Fixed.

arctools.fun/trade

## Thread variant

1/ Terminal update. Three things we broke, found, and fixed today.

2/ Timeframe buttons did nothing for most rows. The stats map was merged forever and never cleared on window change, so a token froze on the first window it loaded in. The backend was always right: ARCT is $18.94 on 1m and $633,968 on 24h.

3/ Top volume ranked by volume since launch but printed the selected window in the column. Two different sources, one list, zero sense. Now both are the same figure and nothing is pinned above the ranking.

4/ Logos: the table asked external screeners and skipped our own index, so token pages had artwork the list did not. 38 of the top 100 tokens were affected.

5/ Live on arctools.fun/trade
