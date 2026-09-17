"""47 — gArc: the KOL database and platform volume, on the waving robot."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); CARD = (18, 24, 36); PINK = (255, 95, 210)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

PANEL = 860

robot = Image.open('robot_wave.png').convert('RGBA')
sc = max(W / robot.width, H / robot.height)
art = robot.resize((int(robot.width * sc) + 1, int(robot.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H)).convert('RGB')
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.95).convert('RGBA')

panel = Image.new('RGBA', (W, H), (0, 0, 0, 0)); pd = ImageDraw.Draw(panel)
pd.rectangle((0, 0, PANEL, H), fill=(8, 10, 16, 238))
for i in range(120):
    pd.line((PANEL + i, 0, PANEL + i, H), fill=(8, 10, 16, int(238 * (1 - i / 120))))
bg = Image.alpha_composite(bg, panel)
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))

# the greeting
d.text((56, 122), 'gArc', font=f(118), fill=INK)
d.text((56, 258), 'the chain says good morning with', font=f(22, R), fill=MUTED)
d.text((56, 288), '$244.7M of volume', font=f(30), fill=GRN)

cards = [('1,016', 'KOLs in our database', PINK), ('105.3M', 'followers behind them', INK), ('$244.7M', '24h volume indexed', GRN)]
cw, ch, gap = 248, 116, 18
for i, (big, lab, col) in enumerate(cards):
    cx = 56 + i * (cw + gap)
    d.rounded_rectangle((cx, 352, cx + cw, 352 + ch), radius=14, fill=CARD + (245,), outline=(255, 255, 255, 42))
    d.text((cx + 18, 374), big, font=f(38), fill=col)
    d.text((cx + 18, 424), lab, font=f(15, R), fill=MUTED)

rows = [('182', 'accounts above 100K followers'),
        ('16', 'accounts above 1M followers'),
        ('574', 'mapped in the following graph'),
        ('2.1M', 'follow edges between them'),
        ('2.57M', 'swaps indexed in 24 hours'),
        ('110,267', 'wallets traded today')]
ry = 504
for big, lab in rows:
    d.rounded_rectangle((58, ry + 12, 68, ry + 22), radius=3, fill=COB)
    d.text((86, ry), big, font=f(24, M), fill=INK)
    tw = d.textlength(big, font=f(24, M))
    d.text((86 + tw + 16, ry + 6), lab, font=f(17, R), fill=MUTED)
    ry += 46

d.text((56, 790), 'WHY WE TRACK THEM', font=f(18), fill=GRN)
d.text((56, 818), 'When one of those 1,016 accounts posts a contract', font=f(17, R), fill=INK)
d.text((56, 844), 'address, the token is flagged on the chart within', font=f(17, R), fill=INK)
d.text((56, 870), 'minutes - a marker on the candle, not a screenshot.', font=f(17, R), fill=INK)

d.text((56, H - 56), 'arctools.fun', font=f(26), fill=INK)
lbl = 'live figures, 17 Sep 2026'
d.text((PANEL - 60 - d.textlength(lbl, font=f(15)), H - 50), lbl, font=f(15), fill=(226, 232, 244))

bg.convert('RGB').save('../47-garc.png', quality=95)
print('saved ../47-garc.png')
