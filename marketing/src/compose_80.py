"""80 — Pay from another chain: ETH on Base or Arbitrum to token on Arc in one signature (Relay + ArcAggregator). Real modal, real timings."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 1600, 1000
NAVY = (10, 12, 16); GRN = (34, 197, 128); COB = (46, 124, 255); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (140, 150, 170)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'; R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
bg = Image.new('RGBA', (W, H), NAVY + (255,)); glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-300, 300, 600, 1200), fill=COB + (56,)); gd.ellipse((1100, -300, 1900, 500), fill=GRN + (50,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(180))); d = ImageDraw.Draw(bg)
d.text((70, 56), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((210, 58, 470, 90), radius=8, fill=GRN); d.text((222, 63), 'NEW · CROSS-CHAIN BUY', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'ETH on Base. Token on Arc. One signature.', font=f(50), fill=INK)
d.text((70, 168), 'No bridge tab, no swap tab, no gas on Arc first. Pick the chain where your money is, sign once, the token lands in your wallet in seconds.', font=f(20, R), fill=MUTED)
# modal (real)
m = Image.open('assets/80-modal.png').convert('RGB'); mh = 640; m = m.resize((int(m.width * mh / m.height), mh), Image.LANCZOS)
mask = Image.new('L', m.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, m.width - 1, m.height - 1), radius=12, fill=255)
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((60, 260, 60 + m.width + 20, 260 + mh + 30), radius=18, fill=(0, 0, 0, 180)); bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(40)))
bg.paste(m, (70, 240), mask); d = ImageDraw.Draw(bg); d.text((70, 240 + mh + 8), 'token page, "Pay from another chain" — real screen', font=f(12, R), fill=DIM)
X = 70 + m.width + 50; y = 240
d.text((X, y), 'HOW IT WORKS', font=f(13), fill=GRN); y += 28
steps = [('1  Pick the chain', 'Base, Arbitrum, Ethereum, Optimism, BNB Chain or Polygon. Pay in ETH / BNB / POL or in USDC.'),
         ('2  Choose the size', '1 to 2,000 USDC of the token. You see what you pay, what you get, the route and both fees before signing.'),
         ('3  Sign once', 'One transaction on your chain. Relay bridges the money and calls the ArcTools aggregator on Arc in the same fill.'),
         ('4  Token on Arc', 'Lands in your wallet, or in your ArcTools trading wallet if you prefer. Same 1.5 % fee as Quick Buy, plus Relay (about 5 cents).')]
for t, s in steps:
    d.text((X, y), t, font=f(18), fill=INK); words = s.split(); line = ''; lines = []
    for w_ in words:
        if len(line) + len(w_) > 60: lines.append(line); line = w_
        else: line = (line + ' ' + w_).strip()
    lines.append(line)
    for i, ln in enumerate(lines): d.text((X, y + 26 + i * 20), ln, font=f(15, R), fill=MUTED)
    y += 26 + len(lines) * 20 + 14
y += 6; d.text((X, y), 'MEASURED ON MAINNET TODAY', font=f(13), fill=GRN); y += 28
rows = [('Base to ARCT (Uniswap V3)', '4.6 s', '0.000393 ETH'), ('Base to ARCPET (ArcToolsPad curve)', '2.4 s', '0.000213 ETH'), ('Arbitrum to ARCT (from the site UI)', '< 3 s', '0.000391 ETH')]
for a, b, c in rows:
    d.rounded_rectangle((X, y, W - 70, y + 44), radius=8, fill=(18, 22, 30), outline=(255, 255, 255, 28), width=1)
    d.text((X + 14, y + 12), a, font=f(15, R), fill=INK); d.text((W - 70 - 14 - d.textlength(c, font=f(14, R)), y + 13), c, font=f(14, R), fill=DIM); d.text((X + 400, y + 11), b, font=f(17), fill=GRN); y += 52
d.text((X, y + 6), 'Works for Uniswap V3 / V4 tokens and bonding-curve launchpad tokens — the same router as Quick Buy.', font=f(13, R), fill=DIM)
d.rounded_rectangle((70, H - 84, 380, H - 34), radius=10, fill=GRN); d.text((92, H - 72), 'arctools.fun/trade', font=f(24), fill=(4, 20, 10))
d.text((402, H - 68), 'The chain-link button next to every Quick Buy, and on every token page · bridging by Relay · if the Arc swap fails, USDC is refunded on Arc', font=f(13, R), fill=MUTED)
bg.convert('RGB').save('80-crosschain.png', quality=95); print('80 ok', y)
