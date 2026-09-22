"""74 — "Everything ArcTools does today": 9 real screenshots + the full tool list. 1600×2000 (tall, X-friendly 4:5)."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 2000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (150, 160, 180)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
A = '/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/assets/74/'

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-300, -200, 700, 700), fill=COB + (46,)); gd.ellipse((1000, 1300, 1900, 2200), fill=GRN + (36,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(180))); d = ImageDraw.Draw(bg)

d.text((70, 56), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((210, 58, 470, 90), radius=8, fill=COB); d.text((222, 63), 'ONE TERMINAL FOR ARC', font=f(19), fill=INK)
d.text((70, 104), 'Everything ArcTools does today.', font=f(54), fill=INK)
d.text((70, 172), 'Real screens from arctools.fun, 22 Sep 2026. Every fee below buys and burns ARCT.', font=f(21, R), fill=MUTED)

# ── screenshot grid: 3 × 3, each 480×270 (16:9), cropped to the content column ──
shots = [('trade2', 'Terminal'), ('predict', 'ArcPredict'), ('locker', 'ArcLocker'),
         ('launchpad', 'ArcToolsPad'), ('insiders', 'Insiders'), ('swap', 'Swap'),
         ('buy', 'Buy ARCT with card'), ('pay', 'Pay links'), ('advertise', 'Banner slots')]
cw, ch, gap = 480, 270, 20; x0 = 70; y0 = 226
for i, (name, label) in enumerate(shots):
    im = Image.open(A + name + '.png').convert('RGB')
    im = im.crop((240, 0, 1920, 945)).resize((cw, ch), Image.LANCZOS)          # drop the rail: the content column is what changes per tool
    x = x0 + (i % 3) * (cw + gap); y = y0 + (i // 3) * (ch + 52)
    frame = Image.new('RGBA', (cw + 2, ch + 2), (255, 255, 255, 40)); frame.paste(im, (1, 1))
    mask = Image.new('L', frame.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw + 1, ch + 1), radius=12, fill=255)
    bg.paste(frame, (x, y), mask); d = ImageDraw.Draw(bg)
    d.text((x, y + ch + 10), label, font=f(16), fill=INK)
    d.text((x + cw - 8 - d.textlength('arctools.fun/' + name.replace('2', ''), font=f(12, R)), y + ch + 13), 'arctools.fun/' + name.replace('2', ''), font=f(12, R), fill=DIM)

# ── tool list, two columns ──
ty = y0 + 3 * (ch + 52) + 6
d.text((70, ty), 'THE TOOLS', font=f(13), fill=GRN); d.line((160, ty + 8, W - 70, ty + 8), fill=(255, 255, 255, 30)); ty += 30
tools = [
    ('Terminal', 'every Arc launchpad and pool in one table, one-click buys, live data'),
    ('Sniper bot (Telegram)', 'buy new launches the second they exist, auto-snipe rules, copy-trade'),
    ('Buy bot + @ARCTrends', 'buy alerts for any group, the trending channel of Arc'),
    ('Aggregator / Swap', 'best price across every venue on Arc, 0.5 % fee'),
    ('ArcPredict', 'BTC / ETH / SOL up-or-down rounds every 2 minutes, paid in USDC'),
    ('ArcLocker', 'lock tokens, LP and Uniswap V3 / v4 positions, proof link per lock'),
    ('ArcToolsPad', 'launch a token in one click, liquidity locked at graduation'),
    ('ArcOrders', 'limit and stop orders that execute on-chain'),
    ('Insiders', 'the smart-money leaderboard: who buys before the pump'),
    ('Scanner + dev audit', 'holders, bundles, dev wallets, clone farms, sell simulation'),
    ('Intel', 'Arc voices on X and crypto headlines, with a buy button'),
    ('Portfolio + profiles', 'PnL, holdings and history for any wallet, public trader pages'),
    ('Bridge (CCTP)', 'USDC in and out of Arc from any Circle chain'),
    ('Pay links / ArcClaim', 'send USDC to anyone with a link, escrow until they claim'),
    ('Buy ARCT with card', 'MoonPay card purchase, USDC on Arc, one-click swap to ARCT'),
    ('Banner slots', 'three sponsored slots on the Terminal, human-reviewed'),
    ('Rewards (ARCT staking)', 'stake ARCT, earn from launchpad fees'),
    ('Referrals', '25 % of the fees of everyone you bring, paid in USDC'),
    ('ArcOne (Android)', 'the whole terminal in an app, in-app updates'),
    ('Archy', 'the assistant that knows every tool and every fee'),
]
col_w = (W - 140 - 30) // 2
for i, (name, desc) in enumerate(tools):
    x = 70 + (i % 2) * (col_w + 30); y = ty + (i // 2) * 44
    d.ellipse((x, y + 9, x + 8, y + 17), fill=COB)
    d.text((x + 18, y), name, font=f(17), fill=INK)
    d.text((x + 18, y + 22), desc, font=f(13, R), fill=MUTED)

d.rounded_rectangle((70, H - 84, 330, H - 34), radius=10, fill=COB); d.text((92, H - 72), 'arctools.fun', font=f(24), fill=INK)
d.text((352, H - 68), 'Telegram @ArcSniper_bot · X @ArcToolsBackup · source on GitHub (ArcToolsRepo/arctools)', font=f(14, R), fill=MUTED)
bg.convert('RGB').save('74-everything.png', quality=95); print('74 ok, list ends y', ty + 10 * 44)
