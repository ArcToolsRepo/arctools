"""91 — Referrals: 25 % of fees, forever (real page) + the maths."""
from kit import *
from PIL import ImageDraw
bg = backdrop(0); bg = header(bg, 'REFERRALS', 'Bring a trader. Keep 25 % of their fees. Forever.', ['One link covers everything: Terminal Quick Buys, Sniper trades, swaps, launches. Paid in USDC on Arc,', 'credited automatically, claimable any time. No caps, no expiry, no tiers to climb.'])
bg, h = shot(bg, 'assets/88s-referrals.png', (70, 250, 900)); d = ImageDraw.Draw(bg); d.text((70, 250 + h + 8), 'arctools.fun/referrals — real screen', font=f(12, False), fill=DIM)
X = 1010; y = 250; d.text((X, y), 'THE MATHS', font=f(13), fill=GRN); y += 28
rows = [('Friend snipes 1,000 USDC', 'fee 10 -> you get 2.50'), ('Friend Quick-Buys 500 USDC', 'fee 7.50 -> you get 1.88'), ('Friend launches on ArcToolsPad', 'fee 30 -> you get 7.50'), ('10 active friends, 5k USDC / mo each', '≈ 125 USDC / month to you')]
y = stat_rows(bg, X, y, rows, w=520, h=54)
d = ImageDraw.Draw(bg); y += 10; d.text((X, y), 'HOW TO START', font=f(13), fill=GRN); y += 26
for s in ['Connect or unlock your trading wallet on /referrals to get your link.', 'Share it; anyone who trades through it is yours for life.', 'Claim USDC from the same page, or let it accumulate.', 'Sniper users: /ref in the bot gives the same link.']:
    for ln in wrap(s, 56): d.text((X, y), ln, font=f(14, False), fill=MUTED); y += 20
    y += 4
bg = footer(bg, 'arctools.fun/referrals', 'Paid from the platform\'s share, not from your friend\'s trade · the remaining 75 % still buys back and burns ARCT')
bg.convert('RGB').save('91-referrals.png', quality=95); print('91 ok')
