"""57 — what ArcTools is: the feature board (Terminal, sniper, pay links, profiles, pad, bridge) + the robot."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); GOLD = (217, 164, 65)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((1000, 250, 1750, 1100), fill=COB + (46,)); gd.ellipse((80, 120, 900, 860), fill=GRN + (34,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

rob = Image.open('assets/57-robot.png').convert('RGBA')
arr = np.array(rob).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
arr[:, :, 3] = np.clip((np.abs(arr[:, :, :3] - bgc).sum(axis=2) - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
rh = 860; rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 350          # the render's open hands reach far left; let them leave the frame
bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128
cols = np.where(a.any(axis=0))[0]
print('robot', rob.size, 'solid from x', rx + int(cols.min()))

d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(32), fill=INK)
d.rounded_rectangle((214, 47, 360, 80), radius=8, fill=GRN); d.text((228, 51), 'ARC CHAIN', font=f(20), fill=(3, 26, 14))
d.text((56, 104), 'Everything on Arc,', font=f(70), fill=INK)
d.text((56, 180), 'in one place.', font=f(70), fill=GRN)
d.text((56, 268), 'One terminal, one bot, one wallet — 27 launchpads, every pool, every trader.', font=f(22, R), fill=(228, 235, 246))

cards = [
    ('TERMINAL', 'arctools.fun/trade', ['every Arc launchpad in one table', 'score, dev & bundle, smart money', 'one-click buy, best route across venues']),
    ('SNIPER BOT', '@ArcSniper_bot', ['snipe a launch the block it opens', 'limit / TP / SL, copy-trade, alerts', 'positions and PnL in the chat']),
    ('PAY LINKS', 'arctools.fun/pay', ['send USDC with a link', 'no wallet or gas needed to collect', 'uncollected links come back to you']),
    ('TRADER PROFILES', 'arctools.fun/leaderboard', ['your on-chain record, with a name', 'PnL, ROI, win rate from real swaps', 'follow and copy the ones that win']),
    ('LAUNCHPAD', 'arctools.fun/launchpad', ['launch a coin in one transaction', 'liquidity locked, fees to stakers', 'instant or bonding curve']),
    ('BRIDGE & REWARDS', 'arctools.fun/bridge', ['USDC in from any CCTP chain', 'stake ARCT, earn the platform fees', 'burn counter runs on real buybacks']),
]
x0, y0, cw, ch, gap = 56, 330, 290, 176, 18
for i, (title, where, bullets) in enumerate(cards):
    cx = x0 + (i % 3) * (cw + gap); cy = y0 + (i // 3) * (ch + gap)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle((cx - 8, cy - 8, cx + cw + 8, cy + ch + 8), radius=20, fill=(0, 0, 0, 110))
    bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=14, fill=(17, 23, 35, 238), outline=(255, 255, 255, 46), width=2)
    d.text((cx + 16, cy + 14), title, font=f(20), fill=INK)
    d.text((cx + 16, cy + 40), where, font=f(13, R), fill=COB)
    yy = cy + 68
    for b in bullets:
        d.ellipse((cx + 17, yy + 6, cx + 23, yy + 12), fill=GRN)
        d.text((cx + 32, yy), b, font=f(14, R), fill=MUTED)
        yy += 26
    print('card', title, (cx, cy), 'right', cx + cw, 'bottom', cy + ch)

d = ImageDraw.Draw(bg)
d.rounded_rectangle((56, H - 78, 300, H - 28), radius=10, fill=GRN)
d.text((78, H - 66), 'arctools.fun', font=f(26), fill=(4, 20, 10))
d.text((320, H - 62), 'ARCT · fees buy it back and burn it', font=f(16, R), fill=MUTED)
bg.convert('RGB').save('57-overview.png', quality=95); print('57-overview.png')
