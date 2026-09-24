"""89 — Insiders: the smart-money leaderboard (real screen) + how PnL is computed + copy-trade."""
from kit import *
from PIL import ImageDraw
bg = backdrop(1); bg = header(bg, 'INSIDERS', 'Follow the wallets that actually win.', ['The 100 most profitable wallets on Arc, ranked by realised 30-day PnL from our own swap index, not by follower count.', 'Watch them, copy them from the Sniper, or check who is buying a token before you do.'])
bg, h = shot(bg, 'assets/88s-insiders.png', (70, 250, 940)); d = ImageDraw.Draw(bg); d.text((70, 250 + h + 8), 'arctools.fun/insiders — real screen (top 3 free, 4–100 unlock by staking ARCT)', font=f(12, False), fill=DIM)
X = 1050; y = 250; d.text((X, y), 'HOW THE RANK WORKS', font=f(13), fill=GRN); y += 28
for t, s in [('Realised PnL', 'USDC in minus USDC out per wallet, every DEX and curve on Arc, 30 days'), ('Win rate', 'share of closed positions above break-even'), ('Clusters', 'linked wallets (gas funding, timing) counted as one insider'), ('Badges on charts', 'IB / IS insider buy and sell marks on every token page'), ('Copy trade', 'Sniper mirrors a wallet\'s buys with your size and your stop')]:
    d.text((X, y), t, font=f(17), fill=INK); y += 24
    for ln in wrap(s, 46): d.text((X, y), ln, font=f(14, False), fill=MUTED); y += 19
    y += 8
bg = footer(bg, 'arctools.fun/insiders', 'Same index feeds the Buy bot alerts, Intel whale feed and the x402 API')
bg.convert('RGB').save('89-insiders.png', quality=95); print('89 ok')
