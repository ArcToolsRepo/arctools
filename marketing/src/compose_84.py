"""84 — One terminal for the whole chain: real Terminal screen + what a row gives you."""
from kit import *
from PIL import ImageDraw
bg = backdrop(0); bg = header(bg, 'TERMINAL', 'Every Arc launchpad. One table. One click.', ['25 launchpads and DEXes stream into one live table: new pairs, trending, top volume, insider picks, watchlist and holdings.', 'Pick an amount, hit the lightning bolt. The aggregator finds the best venue and the trade signs locally, no popup.'])
bg, h = shot(bg, 'assets/83s-terminal.png', (70, 250, 940)); d = ImageDraw.Draw(bg); d.text((70, 250 + h + 8), 'arctools.fun/trade2 — real screen', font=f(12, False), fill=DIM)
X = 1050; y = 250; d.text((X, y), 'EVERY ROW SHOWS', font=f(13), fill=GRN); y += 28
for t, s in [('Token Score A–D', 'deployer share, bundle %, top-10, dev selling, rug history'), ('Dev / bundle live', 'what the deployer and the launch-block wallets are doing right now'), ('Smart money', 'insider and pro-wallet buys, KOL mentions'), ('Liquidity and venue', 'V3, V4, bonding curve or stock pair, with the pool depth'), ('Quick Buy + chain-link', 'one-click buy, or pay from Base / Arbitrum / ETH in one signature')]:
    d.text((X, y), t, font=f(17), fill=INK); d.text((X, y + 24), s, font=f(14, False), fill=MUTED); y += 54
y += 6; d.text((X, y), 'SIGN HOW YOU LIKE', font=f(13), fill=GRN); y += 26
for s in ['Trading wallet: key generated in your browser, encrypted with your passcode.', 'Or MetaMask / Rabby. Or the Sniper bot on Telegram. Same router, same 1.5 % fee.']:
    for ln in wrap(s, 48): d.text((X, y), ln, font=f(14, False), fill=MUTED); y += 20
    y += 6
bg = footer(bg, 'arctools.fun/trade', 'Best price across venues · 1.5 % fee funds the ARCT buyback · ArcOne app for Android')
bg.convert('RGB').save('84-terminal.png', quality=95); print('84 ok')
