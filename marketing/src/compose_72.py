"""72 — ArcLocker launch: robot closing a vault + what locks, rules, fee."""
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
robot = Image.open(sys.argv[1]).convert('RGBA'); rh = 780; rw = int(robot.width * rh / robot.height)
robot = robot.resize((rw, rh), Image.LANCZOS).crop((0, 0, int(rw * 0.56), rh))
fade = np.full((rh, robot.width), 255, dtype=np.float32); fade[:, -90:] *= np.linspace(1, 0, 90)[None, :]; fade[-60:, :] *= np.linspace(1, 0, 60)[:, None]
robot.putalpha(Image.fromarray(np.minimum(np.array(robot.split()[3], dtype=np.float32), fade).astype('uint8')))
bg.alpha_composite(robot, (0, H - rh - 10)); d = ImageDraw.Draw(bg)

X = 770
d.text((X, 60), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((X + 140, 62, X + 290, 94), radius=8, fill=GRN); d.text((X + 152, 67), 'NEW TOOL', font=f(19), fill=(4, 20, 10))
d.text((X, 110), 'ArcLocker', font=f(72), fill=INK)
d.text((X, 196), 'Lock tokens, LP and Uniswap positions. Nobody can open it early.', font=f(22, R), fill=MUTED)

cards = [('Tokens & team allocations', 'Cliff or linear vesting. Fee-on-transfer safe.'),
         ('Uniswap V2 LP tokens', 'Pair resolved on-chain — shows on the token page.'),
         ('Uniswap V3 positions', 'NFT locked, swap fees still collectable.'),
         ('Uniswap v4 positions', 'Positions NFT locked until the date. Any NFT works.')]
y = 250
for i, (t, sub) in enumerate(cards):
    cx = X + (i % 2) * 400; cy = y + (i // 2) * 104
    d.rounded_rectangle((cx, cy, cx + 385, cy + 90), radius=14, fill=(18, 22, 30), outline=(255, 255, 255, 28), width=1)
    d.rounded_rectangle((cx + 16, cy + 30, cx + 40, cy + 54), radius=6, outline=GRN, width=3); d.rectangle((cx + 20, cy + 40, cx + 36, cy + 54), fill=GRN)
    d.text((cx + 54, cy + 18), t, font=f(19), fill=INK); d.text((cx + 54, cy + 46), sub, font=f(14, R), fill=MUTED)

rules = ['Unlock date can only move later — never earlier.',
         'No admin key over your assets. The only emergency path returns them to YOU, after a public 48-hour notice.',
         'Extend, transfer, collect V3 fees, withdraw: free. 50 USDC per new lock, spent on ARCT buyback and burn.',
         'Every lock shows on the token page: "LP locked · 62% of pool until Mar 2027".']
yy = 470
for r in rules:
    d.ellipse((X + 2, yy + 8, X + 14, yy + 20), fill=GRN)
    # wrap at ~78 chars
    words = r.split(); line = ''; lines = []
    for w_ in words:
        if len(line) + len(w_) > 72: lines.append(line); line = w_
        else: line = (line + ' ' + w_).strip()
    lines.append(line)
    for ln in lines: d.text((X + 26, yy), ln, font=f(16, R), fill=(226, 233, 245)); yy += 24
    yy += 10

d.rounded_rectangle((X, H - 78, X + 300, H - 28), radius=10, fill=GRN); d.text((X + 22, H - 66), 'arctools.fun/locker', font=f(24), fill=(4, 20, 10))
d.text((X + 320, H - 62), 'also in ArcOne (More, Locker) · contract 0x0786…bb94 · source on GitHub', font=f(13, R), fill=MUTED)
bg.convert('RGB').save('72-arclocker.png', quality=95); print('72-arclocker.png; rules end y', yy)
