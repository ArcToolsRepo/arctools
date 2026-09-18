"""55 — ArcClaim audit card: inspector robot + a report card of what was checked (internal audit + tests, stated as such)."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); GOLD = (217, 164, 65); AMBER = (229, 163, 59)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/RobotoMono-Regular.ttf'
import os
if not os.path.exists(M): M = R
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((1050, 300, 1750, 1100), fill=GRN + (36,)); gd.ellipse((100, 100, 900, 800), fill=COB + (48,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

robot = Image.open('assets/55-robot.png').convert('RGBA')
arr = np.array(robot).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
arr[:, :, 3] = np.clip((np.abs(arr[:, :, :3] - bgc).sum(axis=2) - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
rh = 900; rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 100; bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128

d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 400, 78), radius=8, fill=COB); d.text((222, 50), 'CONTRACT AUDIT', font=f(20), fill=(255, 255, 255))
d.text((56, 104), 'ArcClaim', font=f(84), fill=INK)
d.text((56, 194), 'checked, line by line.', font=f(64), fill=GRN)
d.text((56, 282), 'USDC pay links contract - internal audit and test report, 18 Sep 2026', font=f(22, R), fill=(228, 235, 246))

# report card
x0, y0, cw = 56, 340, 830
rows = [
    ('PASS', '28 / 28 unit tests', 'claim, refund, replay, redirect, malleability, limits, rounding'),
    ('PASS', 'Mainnet end-to-end', 'create -> collect by another wallet -> 2% to treasury; expired link refunded automatically'),
    ('PASS', 'Signature bound to recipient', 'a watcher who sees the claim in flight cannot redirect the funds'),
    ('PASS', 'No pooling, no mixing', 'every link is its own record: sender, recipient and time are public on-chain'),
    ('PASS', 'Refund only to sender', 'anyone may trigger it after expiry; the money has one possible destination'),
    ('PASS', 'One-time keys, high-s rejected', 'a claim key can never be reused; malleable signatures are refused'),
    ('PASS', 'Fee fixed in code', '2% at collection, constant, sent to the treasury in the same transaction'),
    ('NOTE', 'Whoever holds the link can collect', 'by design - share a link with the person you mean'),
    ('NOTE', 'Internal review, not a third-party audit', 'source and tests are in the repo; the contract is verified on Arc'),
]
rh_ = 54
card_h = 20 + len(rows) * rh_ + 44
g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(g).rounded_rectangle((x0 - 14, y0 - 14, x0 + cw + 14, y0 + card_h + 14), radius=22, fill=(0, 0, 0, 120))
bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(18)))
d = ImageDraw.Draw(bg)
d.rounded_rectangle((x0, y0, x0 + cw, y0 + card_h), radius=16, fill=(18, 24, 36, 240), outline=(255, 255, 255, 50), width=2)
y = y0 + 20
for tag, title, sub in rows:
    col = GRN if tag == 'PASS' else AMBER
    d.rounded_rectangle((x0 + 18, y + 6, x0 + 18 + 62, y + 30), radius=6, fill=col)
    d.text((x0 + 18 + (10 if tag == 'PASS' else 8), y + 9), tag, font=f(14), fill=(4, 20, 10))
    d.text((x0 + 96, y + 2), title, font=f(20), fill=INK)
    d.text((x0 + 96, y + 27), sub, font=f(14, R), fill=MUTED)
    y += rh_
d.line((x0 + 18, y + 6, x0 + cw - 18, y + 6), fill=(255, 255, 255, 40), width=1)
d.text((x0 + 18, y + 14), 'contract 0x9f3eEfD8b4158C09BF134fa6C032745a7D781BE6', font=f(15, M), fill=MUTED)
print('card bottom', y0 + card_h, 'right', x0 + cw)
band = a[max(0, y0 - (H - rob.height)):, :]
cols = np.where(band.any(axis=0))[0]
print('robot solid start x =', rx + int(cols.min()))
bg.convert('RGB').save('55-audit.png', quality=95); print('55-audit.png')
