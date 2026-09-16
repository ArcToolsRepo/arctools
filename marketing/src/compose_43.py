"""43 — ARCT burn: robot holding fire + on-chain burn figures (verified against the node on 16 Sep)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); CARD = (18, 24, 36); FIRE = (255, 146, 43)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

PANEL = 830

robot = Image.open('robot_fire.png').convert('RGBA')
sc = max(W / robot.width, H / robot.height)
art = robot.resize((int(robot.width * sc) + 1, int(robot.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H)).convert('RGB')
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.95).convert('RGBA')

panel = Image.new('RGBA', (W, H), (0, 0, 0, 0)); pd = ImageDraw.Draw(panel)
pd.rectangle((0, 0, PANEL, H), fill=(8, 10, 16, 240))
for i in range(110):
    pd.line((PANEL + i, 0, PANEL + i, H), fill=(8, 10, 16, int(240 * (1 - i / 110))))
bg = Image.alpha_composite(bg, panel)
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 306, 78), radius=8, fill=FIRE); d.text((222, 50), 'BURN', font=f(20), fill=(20, 14, 6))
d.text((56, 116), 'SUPPLY GOES ONE WAY', font=f(22), fill=FIRE)
d.text((56, 148), '35.17M ARCT', font=f(72), fill=INK)
d.text((56, 228), 'burned, for good', font=f(48), fill=FIRE)

d.text((56, 306), 'Sent to burn addresses and out of circulation forever.', font=f(20, R), fill=MUTED)
d.text((56, 334), 'Verified on-chain, 11 burn transactions.', font=f(20, R), fill=MUTED)

cards = [('35.17M', 'ARCT burned', FIRE), ('3.5%', 'of the 1B supply', INK), ('$16.6K', 'at today\'s price', GRN)]
cw, ch, gap = 236, 118, 18
for i, (big, lab, col) in enumerate(cards):
    cx = 56 + i * (cw + gap)
    d.rounded_rectangle((cx, 390, cx + cw, 390 + ch), radius=14, fill=CARD + (245,), outline=(255, 255, 255, 42))
    d.text((cx + 18, 412), big, font=f(42), fill=col)
    d.text((cx + 18, 464), lab, font=f(16, R), fill=MUTED)

rows = [('21.73M', 'held at the dead address, unspendable'),
        ('13.44M', 'burned straight out of totalSupply'),
        ('972.73M', 'ARCT left in existence, down from 1B'),
        ('23.1M', 'ARCT staked and earning platform fees')]
ry = 552
for big, lab in rows:
    d.rounded_rectangle((58, ry + 14, 68, ry + 24), radius=3, fill=FIRE)
    d.text((86, ry + 2), big, font=f(26, M), fill=INK)
    tw = d.textlength(big, font=f(26, M))
    d.text((86 + tw + 16, ry + 9), lab, font=f(18, R), fill=MUTED)
    ry += 50

d.text((56, 772), 'WHY IT MATTERS', font=f(18), fill=GRN)
d.text((56, 800), 'Platform fees buy ARCT back. Part goes to stakers, part goes to the fire.', font=f(18, R), fill=INK)
d.text((56, 826), 'Fewer tokens, same fee flow - every burn is a permanent one.', font=f(18, R), fill=INK)

d.text((56, H - 84), 'arctools.fun', font=f(28), fill=INK)
d.text((56, H - 46), 'Terminal - Scanner - Insiders - CCTP bridge - launchpad - ARCT staking', font=f(17, R), fill=MUTED)
lbl = 'on-chain as of 16 Sep 2026'
d.text((PANEL - 40 - d.textlength(lbl, font=f(16)), H - 46), lbl, font=f(16), fill=(226, 232, 244))

bg.convert('RGB').save('../43-burn.png', quality=95)
print('saved ../43-burn.png')
