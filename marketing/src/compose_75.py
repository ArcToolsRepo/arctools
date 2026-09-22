"""75 — How ARCT burns: the number today + the fee → treasury → buyback → 0xdead loop. Live data from /api/arct-burn and /api/buyback-stats."""
import json, math, sys, urllib.request
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); FIRE = (255, 122, 60); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (140, 150, 170)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

def get(u):
    return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "arctools"}), timeout=30).read())
burn = get('https://bot-production-4200.up.railway.app/api/arct-burn')
bb = get('https://bot-production-4200.up.railway.app/api/buyback-stats')
burned, pct, usd, supply = burn['burned'], burn['pct'], burn.get('usd'), burn['supply']
if not usd:
    ts = get('https://bot-production-4200.up.railway.app/api/token-stats?token=0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52'); usd = burned * ts['price1m'] / 1e6

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-200, 200, 700, 1100), fill=FIRE + (60,)); gd.ellipse((1000, -300, 1900, 500), fill=COB + (44,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(180))); d = ImageDraw.Draw(bg)

d.text((70, 56), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((210, 58, 400, 90), radius=8, fill=FIRE); d.text((222, 63), 'ARCT BURN', font=f(19), fill=(30, 10, 4))
d.text((70, 104), 'Every fee ends the same way.', font=f(54), fill=INK)
d.text((70, 172), 'Live from the chain, 22 Sep 2026.', font=f(21, R), fill=MUTED)

# ── ring: burned share of the 1B genesis supply ──
cx, cy, r0 = 330, 560, 215
ring = Image.new('RGBA', (W, H), (0, 0, 0, 0)); rd = ImageDraw.Draw(ring)
rd.arc((cx - r0, cy - r0, cx + r0, cy + r0), 0, 360, fill=(255, 255, 255, 28), width=34)
rd.arc((cx - r0, cy - r0, cx + r0, cy + r0), -90, -90 + 360 * pct / 100, fill=FIRE, width=34)
bg = Image.alpha_composite(bg, ring); d = ImageDraw.Draw(bg)
t1 = f'{burned / 1e6:.2f}M'; w1 = d.textlength(t1, font=f(78)); d.text((cx - w1 / 2, cy - 78), t1, font=f(78), fill=INK)
t2 = 'ARCT burned'; w2 = d.textlength(t2, font=f(22, R)); d.text((cx - w2 / 2, cy + 8), t2, font=f(22, R), fill=MUTED)
t3 = f'{pct:.2f} % of the 1B genesis supply'; w3 = d.textlength(t3, font=f(17, R)); d.text((cx - w3 / 2, cy + 44), t3, font=f(17, R), fill=FIRE)
t4 = '≈ $' + f'{usd:,.0f}' + ' at today\'s price'; w4 = d.textlength(t4, font=f(15, R)); d.text((cx - w4 / 2, cy + 72), t4, font=f(15, R), fill=DIM)
d.text((70, cy + r0 + 40), f'Supply today: {supply / 1e6:,.1f}M ARCT  ·  no mint function, no owner  ·  every burn is a transfer to 0x…dEaD or a burn() call', font=f(14, R), fill=DIM)

# ── the loop, right side ──
X = 640; y = 236
d.text((X, y), 'HOW IT WORKS', font=f(13), fill=GRN); d.line((X + 130, y + 8, W - 70, y + 8), fill=(255, 255, 255, 30)); y += 34
steps = [
    ('1', 'You use a tool', 'Sniper 1 %, swap 0.5 %, bridge 2 %, ArcToolsPad 1 %, orders 1 %, pay links 2 %, locker 50 USDC, banners 250 USDC, ArcPredict 3 %.'),
    ('2', 'The fee lands in one treasury', '0xb35c…5c0d. Public, on-chain, the same address in every contract and every UI.'),
    ('3', 'A keeper buys ARCT every 30 minutes', 'It routes through the ArcTools aggregator at the best price, no fee, and sends the ARCT straight to 0x…dEaD.'),
    ('4', 'Nobody can undo it', 'Dead-address balance is unspendable; burn() reduces supply. The counter on every page reads the chain, not a database.'),
]
for n, t, sub in steps:
    d.ellipse((X, y + 4, X + 30, y + 34), fill=COB); d.text((X + 10, y + 8), n, font=f(16), fill=INK)
    d.text((X + 44, y), t, font=f(21), fill=INK)
    words = sub.split(); line = ''; lines = []
    for w_ in words:
        if len(line) + len(w_) > 88: lines.append(line); line = w_
        else: line = (line + ' ' + w_).strip()
    lines.append(line)
    for i, ln in enumerate(lines): d.text((X + 44, y + 30 + i * 21), ln, font=f(15, R), fill=MUTED)
    y += 30 + len(lines) * 21 + 22

# ── keeper stats strip ──
y += 6
cards = [(f'{bb["runs"]}', 'automatic buybacks'), (f'{bb["usdc_spent"]:,.2f} USDC', 'spent by the keeper'), (f'{bb["burned"] / 1e3:,.1f}K ARCT', 'bought and burned by it'), ('30 min', 'between runs')]
cw = (W - X - 70 - 3 * 14) // 4
for i, (v, l) in enumerate(cards):
    x = X + i * (cw + 14)
    d.rounded_rectangle((x, y, x + cw, y + 74), radius=12, fill=(18, 22, 30), outline=(255, 255, 255, 28), width=1)
    d.text((x + 14, y + 12), v, font=f(20), fill=FIRE if i == 2 else INK); d.text((x + 14, y + 44), l, font=f(12, R), fill=MUTED)
y += 74 + 14
d.text((X, y), 'The rest of the burned supply came from launch-time burns and treasury burns before the keeper existed — all visible on-chain.', font=f(13, R), fill=DIM)

d.rounded_rectangle((70, H - 84, 470, H - 34), radius=10, fill=FIRE); d.text((92, H - 72), 'arctools.fun  ·  burn counter', font=f(24), fill=(30, 10, 4))
d.text((492, H - 68), 'Dead address 0x000…dEaD  ·  ARCT 0x1ea1…de52  ·  treasury 0xb35c…5c0d  ·  keeper source on GitHub', font=f(14, R), fill=MUTED)
bg.convert('RGB').save('75-burn.png', quality=95); print('75 ok', burned, pct, usd, bb['runs'], 'loop end y', y)
