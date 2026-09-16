"""42 — Platform numbers: robot (presenting) + live index stats pulled from the buybot on 16 Sep."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); CARD = (18, 24, 36)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

PANEL = 880                                   # everything textual stays left of this line; the robot owns the rest

robot = Image.open('robot_present.png').convert('RGBA')
sc = max(W / robot.width, H / robot.height)
art = robot.resize((int(robot.width * sc) + 1, int(robot.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H)).convert('RGB')
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.95).convert('RGBA')

# hard panel (not a blur) so no thin grey type ever lands on the robot's polished arm
panel = Image.new('RGBA', (W, H), (0, 0, 0, 0)); pd = ImageDraw.Draw(panel)
pd.rectangle((0, 0, PANEL, H), fill=(8, 10, 16, 243))
for i in range(90):                            # soft falloff into the art
    pd.line((PANEL + i, 0, PANEL + i, H), fill=(8, 10, 16, int(243 * (1 - i / 90))))
bg = Image.alpha_composite(bg, panel)
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((PANEL - 40, 180, W + 200, 900), fill=COB + (40,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(120)))
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))
d.text((56, 112), 'ARC, FULLY INDEXED', font=f(22), fill=GRN)
d.text((56, 142), 'The whole chain', font=f(64), fill=INK)
d.text((56, 212), 'on one screen', font=f(64), fill=COB)
d.text((56, 296), 'every swap, every wallet, every launchpad - live', font=f(21), fill=MUTED)

cards = [('$291.5M', '24h volume', COB), ('2.78M', '24h swaps', INK), ('95,572', 'wallets', GRN), ('30,129', 'tokens', INK)]
cw, ch, gap = 190, 112, 16
for i, (big, lab, col) in enumerate(cards):
    cx = 56 + i * (cw + gap)
    d.rounded_rectangle((cx, 348, cx + cw, 348 + ch), radius=14, fill=CARD + (245,), outline=(255, 255, 255, 40))
    d.text((cx + 16, 368), big, font=f(34), fill=col)
    d.text((cx + 16, 414), lab, font=f(16, R), fill=MUTED)

rows = [('12,480', 'liquidity pools priced in real time'),
        ('27,749', 'launches in the pad registry'),
        ('26', 'launchpads labelled by name'),
        ('91,134', 'wallets active in the last 24h'),
        ('23.1M', 'ARCT staked, earning platform fees')]
ry = 500
for big, lab in rows:
    d.rounded_rectangle((58, ry + 14, 68, ry + 24), radius=3, fill=GRN)
    d.text((86, ry + 2), big, font=f(26, M), fill=INK)
    tw = d.textlength(big, font=f(26, M))
    d.text((86 + tw + 16, ry + 9), lab, font=f(18, R), fill=MUTED)
    ry += 50

d.text((56, 770), 'LIVE, NOT REFRESHED', font=f(18), fill=GRN)
d.text((56, 798), 'Prints stream straight from our own Arc node - trades, candles and market', font=f(18, R), fill=INK)
d.text((56, 824), 'caps move on the page while the block is still fresh.', font=f(18, R), fill=INK)

px = 56
for name, active in (('Terminal', True), ('Scanner', False), ('Insiders', False), ('Bridge', False), ('Pad', False), ('Staking', False)):
    tw = d.textlength(name, font=f(17)) + 30
    d.rounded_rectangle((px, 866, px + tw, 904), radius=19, fill=(COB + (90,)) if active else (26, 33, 48, 235),
                        outline=COB + (220,) if active else (255, 255, 255, 55))
    d.text((px + 15, 876), name, font=f(17), fill=INK); px += tw + 12

d.text((56, H - 58), 'arctools.fun', font=f(28), fill=INK)
lbl = 'numbers as of 16 Sep 2026'
d.text((PANEL - 40 - d.textlength(lbl, font=f(16)), H - 50), lbl, font=f(16), fill=(226, 232, 244))

bg.convert('RGB').save('../42-stats.png', quality=95)
print('saved ../42-stats.png')
