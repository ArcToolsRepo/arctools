"""69 — CMC listing submitted: robot + official CoinMarketCap wordmark (monochrome variant recoloured white)."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-250, 250, 650, 1150), fill=GRN + (44,)); gd.ellipse((950, -250, 1850, 550), fill=COB + (48,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(170)))

robot = Image.open(sys.argv[1]).convert('RGBA'); rh = 760; rw = int(robot.width * rh / robot.height)
robot = robot.resize((rw, rh), Image.LANCZOS).crop((0, 0, int(rw * 0.47), rh))
fade = np.full((rh, robot.width), 255, dtype=np.float32); fade[:, -80:] *= np.linspace(1, 0, 80)[None, :]; fade[-60:, :] *= np.linspace(1, 0, 60)[:, None]
robot.putalpha(Image.fromarray(np.minimum(np.array(robot.split()[3], dtype=np.float32), fade).astype('uint8')))
bg.alpha_composite(robot, (0, H - rh - 10))
d = ImageDraw.Draw(bg)

d.text((650, 70), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((790, 72, 940, 104), radius=8, fill=GRN); d.text((802, 77), 'ARCT · ARC', font=f(19), fill=(4, 20, 10))
d.text((650, 130), 'Listing submitted.', font=f(60), fill=INK)

# CMC wordmark, recoloured white, on a dark card
cmc = Image.open('assets/cmc_logo.png').convert('RGBA'); a = np.array(cmc)
a[:, :, :3] = 255; cmc = Image.fromarray(a)
lw = 720; lh = int(cmc.height * lw / cmc.width); cmc = cmc.resize((lw, lh), Image.LANCZOS)
cx, cy = 650, 236; cw, ch = 890, 200
d.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=22, fill=(20, 24, 32), outline=(255, 255, 255, 30), width=2)
bg.alpha_composite(cmc, (cx + (cw - lw) // 2, cy + (ch - lh) // 2)); d = ImageDraw.Draw(bg)

lines = [('Verified listing request filed with CoinMarketCap for ARCT.', INK, 24, F),
         ('ARCT is already indexed by CMC DexScan (ARCT/USDC, Uniswap V3 on Arc).', MUTED, 20, R),
         ('We asked for the full page: name, logo, links, supply, market cap.', MUTED, 20, R),
         ('Supply feeds are live at arctools.fun/api/supply. Contract below.', MUTED, 20, R)]
y = 470
for t, c, s, p in lines:
    d.text((650, y), t, font=f(s, p), fill=c); y += s + 16

# steps row
steps = [('1', 'Submitted', GRN), ('2', 'Under review', (255, 200, 60)), ('3', 'Verified page', (90, 100, 120))]
x = 650; y = 660
for n, lab, col in steps:
    d.ellipse((x, y, x + 44, y + 44), fill=col); d.text((x + 22, y + 10), n, font=f(22), fill=(4, 20, 10) if col != (90, 100, 120) else INK, anchor='ma')
    d.text((x + 58, y + 10), lab, font=f(22), fill=INK)
    x += 58 + int(d.textlength(lab, font=f(22))) + 60
    if n != '3': d.line((x - 40, y + 22, x - 12, y + 22), fill=(60, 68, 80), width=3)

d.text((650, 740), 'Contract (Arc, chain 5042)', font=f(14, R), fill=MUTED)
d.rounded_rectangle((650, 762, 1540, 806), radius=8, fill=(20, 24, 32), outline=(255, 255, 255, 30))
d.text((666, 773), '0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52', font=f(21), fill=GRN)

d.rounded_rectangle((650, H - 78, 820, H - 28), radius=10, fill=GRN); d.text((672, H - 66), 'arctools.fun', font=f(26), fill=(4, 20, 10))
d.text((910, H - 62), 'CoinMarketCap is a trademark of its owner · listing pending review, not a CMC endorsement', font=f(13, R), fill=MUTED)
bg.convert('RGB').save('69-cmc-submitted.png', quality=95); print('69-cmc-submitted.png')
