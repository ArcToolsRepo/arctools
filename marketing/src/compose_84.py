"""84 - ArcStockpad joins the ArcTools launchpad list (26th pad). Robot render on the right, real ArcStockpad 'Graduated' panel, facts column."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 1600, 1000
GRN = (34, 197, 128); COB = (46, 124, 255); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (150, 160, 180)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'; R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
bg = Image.open('assets/84-robot.png').convert('RGB'); bg = bg.resize((W, int(bg.height * W / bg.width)), Image.LANCZOS); bg = bg.crop((0, (bg.height - H) // 2, W, (bg.height - H) // 2 + H)).convert('RGBA')
# darken the left 62 % so the type reads
grad = Image.new('L', (W, 1), 0); gp = grad.load()
for x in range(W): gp[x, 0] = int(215 * max(0.0, min(1.0, (0.70 - x / W) / 0.30)))
dark = Image.new('RGBA', (W, H), (6, 9, 14, 255)); dark.putalpha(grad.resize((W, H))); bg = Image.alpha_composite(bg, dark)
d = ImageDraw.Draw(bg)
d.text((70, 52), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((210, 54, 462, 86), radius=8, fill=GRN); d.text((222, 59), 'NEW LAUNCHPAD ADDED', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'ArcStockpad is now in ArcTools.', font=f(54), fill=INK)
d.text((70, 172), 'Coins paired with USDC or a real stock token (NVDA, CRCL, GME, SPY, AAPL...) on a hook-owned Uniswap V4 curve.', font=f(19, R), fill=MUTED)
d.text((70, 198), 'Every ArcStockpad launch now shows in the Terminal, the Sniper and the buy alerts, with one-click buys through the aggregator.', font=f(19, R), fill=MUTED)
# their logo (X avatar) as a pad mark next to the headline area
lg = Image.open('assets/84-arcstockpad-x.jpg').convert('RGB').resize((64, 64), Image.LANCZOS)
m = Image.new('L', (64, 64), 0); ImageDraw.Draw(m).ellipse((0, 0, 63, 63), fill=255)
bg.paste(lg, (70, 244), m); d = ImageDraw.Draw(bg)
d.text((148, 250), 'ArcStockpad', font=f(26), fill=INK); d.text((148, 284), 'arcstockpad.com  ·  X @ARCSTOCKPAD  ·  t.me/arcstockpad', font=f(15, R), fill=DIM)
# real ArcStockpad panel (left column only; the robot keeps the right third clean)
pan = Image.open('assets/84-graduated.png').convert('RGB'); pw = 860; pan = pan.resize((pw, int(pan.height * pw / pan.width)), Image.LANCZOS); ph = pan.height
mask = Image.new('L', pan.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, pan.width - 1, pan.height - 1), radius=14, fill=255)
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((60, 344, 60 + pw + 20, 344 + ph + 30), radius=20, fill=(0, 0, 0, 200)); bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(18)))
bg.paste(pan, (70, 330), mask); d = ImageDraw.Draw(bg)
d.text((70, 330 + ph + 6), 'arcstockpad.com/explore - real screen, 24 Sep 2026: two coins graduated (ASPAD, NOVA), 26 more on the curve', font=f(12, R), fill=DIM)
# facts: two columns under the panel
y0 = 330 + ph + 34
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(scrim).rounded_rectangle((58, y0 - 12, 70 + pw + 10, H - 98), radius=14, fill=(6, 9, 14, 200)); bg = Image.alpha_composite(bg, scrim.filter(ImageFilter.GaussianBlur(2))); d = ImageDraw.Draw(bg)
X = 70; y = y0
d.text((X, y), 'HOW IT WORKS', font=f(13), fill=GRN); y += 26
for t, s_ in (('Pick the pair', 'USDC or a stock token: NVDA, CRCL, GME, SPY, AAPL, AMC, SPCX, HIMS, cirBTC.'),
              ('Curve inside a live V4 pool', 'Whole supply in one hook-owned position. No LP token, no withdraw.'),
              ('Bonded at 17,000 USDC FDV', 'One-way flag, no migration wick. Liquidity locked from block one.'),
              ('Fees to creators and holders', 'LP fee 0.1-10 % set by the creator; 80 % rewards, 20 % their treasury.')):
    d.text((X, y), t, font=f(15), fill=INK); d.text((X, y + 21), s_, font=f(12, R), fill=MUTED); y += 46
X2 = 70 + 520; y = y0
d.text((X2, y), 'IN ARCTOOLS', font=f(13), fill=COB); y += 26
for t in ('30 launches indexed (v2.4, v2.3, v2.2 factories)', 'Terminal chip + filter, Sniper snipes it', 'Buy bot alerts with the ArcStockpad label', 'Best price across venues, 1.5 % Quick Buy fee', 'Hooked V4 pools routed like every other pad'):
    d.ellipse((X2, y + 5, X2 + 8, y + 13), fill=COB); d.text((X2 + 18, y), t, font=f(14, R), fill=MUTED); y += 26
d.rounded_rectangle((70, H - 84, 560, H - 34), radius=10, fill=GRN); d.text((92, H - 72), 'arctools.fun/trade2  ->  ArcStockpad', font=f(24), fill=(4, 20, 10))
d.text((582, H - 66), '26 launchpads tracked on Arc. Factory 0x79Cc...08ea, hook 0xe92F...2840, verified on explorer.arc.io', font=f(12, R), fill=MUTED)
bg.convert('RGB').save('assets/84-arcstockpad.png', quality=95); print('84 ok', y)
