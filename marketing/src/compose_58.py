"""58 — ArcTools in three moves (trade / automate / own), with the live Terminal and the crossed-arms robot."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); GOLD = (217, 164, 65)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((980, 180, 1780, 1060), fill=COB + (44,)); gd.ellipse((60, 260, 880, 980), fill=GRN + (30,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

rob = Image.open('assets/58-robot.png').convert('RGBA')
arr = np.array(rob).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
arr[:, :, 3] = np.clip((np.abs(arr[:, :, :3] - bgc).sum(axis=2) - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
rh = 900; rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 120
bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128
print('robot', rob.size, 'solid from x', rx + int(np.where(a.any(axis=0))[0].min()))

d = ImageDraw.Draw(bg)
d.text((56, 42), 'ArcTools', font=f(32), fill=INK)
d.rounded_rectangle((214, 45, 336, 78), radius=8, fill=COB); d.text((228, 49), 'ON ARC', font=f(20), fill=(255, 255, 255))
d.text((56, 102), 'Trade it. Automate it.', font=f(58), fill=INK)
d.text((56, 166), 'Own your record.', font=f(58), fill=GRN)

pillars = [
    ('01', 'TRADE', ['27 launchpads in one table', 'score · dev & bundle · smart money', 'one click, best route across venues']),
    ('02', 'AUTOMATE', ['snipe the block a launch opens', 'limit · TP · SL · copy-trade', 'alerts and PnL in Telegram']),
    ('03', 'OWN', ['profile built from your own swaps', 'PnL · ROI · win rate, signed wallets', 'USDC pay links, staking, bridge']),
]
x0, y0, cw, ch, gap = 56, 250, 268, 188, 16
for i, (num, title, bullets) in enumerate(pillars):
    cx = x0 + i * (cw + gap)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle((cx - 8, y0 - 8, cx + cw + 8, y0 + ch + 8), radius=20, fill=(0, 0, 0, 115))
    bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((cx, y0, cx + cw, y0 + ch), radius=14, fill=(17, 23, 35, 240), outline=(255, 255, 255, 48), width=2)
    d.text((cx + 16, y0 + 14), num, font=f(15), fill=COB)
    d.text((cx + 16, y0 + 36), title, font=f(26), fill=INK)
    yy = y0 + 76
    for b in bullets:
        d.ellipse((cx + 17, yy + 6, cx + 23, yy + 12), fill=GRN)
        d.text((cx + 32, yy), b, font=f(13, R), fill=MUTED)
        yy += 30
    print('pillar', title, (cx, y0), 'right', cx + cw)

# measured stats (18.09.2026)
d = ImageDraw.Draw(bg)
stats = [('27', 'launchpads'), ('45.6K', 'tokens tracked'), ('4.1M', 'swaps decoded'), ('54.9M', 'ARCT burned')]
sx = 56
for big, lab in stats:
    wb = d.textlength(big, font=f(26)); wl = d.textlength(lab, font=f(13, R)); cw2 = int(max(wb, wl) + 34)
    d.rounded_rectangle((sx, 468, sx + cw2, 524), radius=12, fill=(18, 24, 36, 235), outline=(255, 255, 255, 40))
    d.text((sx + 17, 474), big, font=f(26), fill=GRN); d.text((sx + 17, 504), lab, font=f(13, R), fill=MUTED)
    sx += cw2 + 12
print('stats end x', sx)

def card(img, x, y, w, radius=16, tag=None):
    global bg
    im = img.convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle((x - 14, y - 14, x + im.width + 14, y + im.height + 14), radius=radius + 8, fill=(0, 0, 0, 130))
    bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height), radius=radius, fill=255)
    bg.paste(im, (x, y), mask)
    dd = ImageDraw.Draw(bg)
    dd.rounded_rectangle((x - 1, y - 1, x + im.width + 1, y + im.height + 1), radius=radius, outline=(255, 255, 255, 60), width=2)
    if tag:
        tw = dd.textlength(tag, font=f(14)) + 20
        dd.rounded_rectangle((x + 12, y - 26, x + 12 + tw, y - 4), radius=7, fill=GOLD); dd.text((x + 22, y - 24), tag, font=f(14), fill=(26, 18, 4))
    print('card', tag, (x, y), im.size, 'right', x + im.width, 'bottom', y + im.height)
    return im.size

term = Image.open('assets/58-terminal.png')
tw_, th_ = card(term.crop((232, 150, 1560, 700)), 56, 566, 880, tag='TERMINAL · live')

d = ImageDraw.Draw(bg)
d.rounded_rectangle((56, H - 66, 300, H - 16), radius=10, fill=GRN)
d.text((78, H - 54), 'arctools.fun', font=f(26), fill=(4, 20, 10))
bg.convert('RGB').save('58-three-moves.png', quality=95); print('58-three-moves.png')
