"""48 — Arc feed: X voices + crypto headlines in the Terminal, with a buy button per post."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); CARD = (18, 24, 36)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

PANEL = 830

robot = Image.open('assets/48-robot.png').convert('RGBA')
sc = max(W / robot.width, H / robot.height)
art = robot.resize((int(robot.width * sc) + 1, int(robot.height * sc) + 1), Image.LANCZOS)
ox, oy = (art.width - W) // 2, (art.height - H) // 2
art = art.crop((ox, oy, ox + W, oy + H)).convert('RGB')
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.5).convert('RGBA')

# left reading column, faded into the render so the robot keeps its lamp visible on the right
col = Image.new('RGBA', (W, H), (0, 0, 0, 0)); cd = ImageDraw.Draw(col)
cd.rectangle((0, 0, PANEL, H), fill=(8, 10, 16, 252))
for i in range(130):
    cd.line((PANEL + i, 0, PANEL + i, H), fill=(8, 10, 16, int(240 * (1 - i / 130))))
bg = Image.alpha_composite(bg, col)
d = ImageDraw.Draw(bg)

d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB)
d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))

d.text((56, 118), 'Arc feed', font=f(104), fill=INK)
d.text((56, 240), 'what Arc is posting, and what crypto media', font=f(23, R), fill=MUTED)
d.text((56, 272), 'is publishing — in the same column you trade in', font=f(23, R), fill=MUTED)

# the live lamp, drawn the way the site draws it
lx, ly = 60, 336
for rad, a in ((16, 40), (11, 80), (7, 160)):
    d.ellipse((lx - rad, ly - rad, lx + rad, ly + rad), fill=GRN + (a,))
d.ellipse((lx - 5, ly - 5, lx + 5, ly + 5), fill=GRN)
d.text((86, 322), 'live', font=f(22), fill=GRN)
d.text((136, 323), '· X timelines every 2 min · headlines every 7 min', font=f(20, R), fill=MUTED)

cards = [('140', 'posts indexed', INK), ('227', 'headlines', INK), ('4', 'news sources', COB)]
cw, ch, gap = 236, 112, 18
for i, (big, lab, colr) in enumerate(cards):
    cx = 56 + i * (cw + gap)
    d.rounded_rectangle((cx, 382, cx + cw, 382 + ch), radius=14, fill=CARD + (245,), outline=(255, 255, 255, 42))
    d.text((cx + 18, 402), big, font=f(40), fill=colr)
    d.text((cx + 18, 452), lab, font=f(15, R), fill=MUTED)

rows = [('A post naming an Arc token', 'carries its own buy button'),
        ('Ticker resolved to one contract', 'or it stays plain text'),
        ('Arc voices, not outlets', 'ranked by how much they post about Arc')]
y = 536
for head, tail in rows:
    d.rounded_rectangle((56, y, 56 + 3, y + 46), radius=2, fill=COB)
    d.text((78, y + 2), head, font=f(21), fill=INK)
    d.text((78, y + 26), tail, font=f(17, R), fill=MUTED)
    y += 64

d.text((56, 774), 'no wrong buttons: a cashtag counts only with Arc context in the post', font=f(18), fill=(228, 235, 246))
d.rounded_rectangle((56, 828, 300, 878), radius=10, fill=GRN)
d.text((78, 840), 'arctools.fun', font=f(26), fill=(4, 20, 10))
d.text((330, 842), '/trade', font=f(24, R), fill=MUTED)

# the real panel, straight off the live site
shot = Image.open('assets/48-panel.png').convert('RGB')
th = 700
shot = shot.resize((int(shot.width * th / shot.height), th), Image.LANCZOS)
sx, sy = W - shot.width - 70, (H - th) // 2
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).rounded_rectangle((sx - 14, sy - 14, sx + shot.width + 14, sy + th + 14), radius=22, fill=COB + (120,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(18)))
fade = Image.new('L', (shot.width, th), 255)
fd = ImageDraw.Draw(fade)
for i in range(110):
    fd.line((0, th - 1 - i, shot.width, th - 1 - i), fill=int(255 * (i / 110) ** 0.8))
bg.paste(shot, (sx, sy), fade)
d = ImageDraw.Draw(bg)
d.rounded_rectangle((sx - 1, sy - 1, sx + shot.width + 1, sy + th + 1), radius=12, outline=(255, 255, 255, 70), width=2)

bg.convert('RGB').save('48-feed.png', quality=95)
print('48-feed.png', bg.size)
