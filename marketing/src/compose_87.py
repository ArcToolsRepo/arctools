"""87 — Built for builders: launch, lock, hire, predict, query — five real screens in a grid."""
from kit import *
from PIL import ImageDraw
bg = backdrop(0); bg = header(bg, 'FOR BUILDERS', 'Launch it. Lock it. Hire for it. Query it.', ['Launch a token in a minute, lock the LP with a public proof page, hire a designer through escrow, offer your community a', 'two-minute market, and pull the same data we use through a pay-per-call API. All on Arc, all in USDC.'])
tiles = [('assets/83s-launchpad.png', 'ArcToolsPad', '30 USDC instant launch · curve to Uniswap'), ('assets/83s-locker.png', 'ArcLocker', '50 USDC per lock · public proof page'), ('assets/83s-market.png', 'Market', 'USDC escrow · 2 % on completion'), ('assets/83s-predict.png', 'ArcPredict', 'BTC / ETH / SOL · 2-minute rounds'), ('assets/83s-api.png', 'x402 API', 'from 0.005 USDC per call · no keys'), ('assets/83s-intel.png', 'Intel', 'whales, clusters, dev wallets, alerts')]
tw = 470; th = 264; gx = 70; gy = 250
for i, (p, t, s) in enumerate(tiles):
    x = gx + (i % 3) * (tw + 25); y = gy + (i // 3) * (th + 70)
    bg, h = shot(bg, p, (x, y, tw), radius=10); d = ImageDraw.Draw(bg)
    d.text((x, y + h + 8), t, font=f(18), fill=INK); d.text((x + d.textlength(t, font=f(18)) + 12, y + h + 12), s, font=f(13, False), fill=MUTED)
bg = footer(bg, 'arctools.fun', 'Real screens, 24 Sep 2026 · every fee funds the ARCT buyback and burn')
bg.convert('RGB').save('87-builders.png', quality=95); print('87 ok')
