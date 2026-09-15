"""33 — Alpha tab announcement. Robot (radar) left, live Fresh-alpha screenshot right, backtest tiles, footer."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (236, 240, 247); MUTED = (150, 160, 178); CARD = (20, 26, 38)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

# robot cut-out: the render has a dark tinted glow, not a flat black bg -> flood-fill the background from the corners (own BFS)
from collections import deque
rgb = Image.open('robot_radar_raw.png').convert('RGB'); a = np.array(rgb).astype(int)
lum = a.max(-1); sat = a.max(-1) - a.min(-1)
darkish = (lum < 95) & ~((sat > 60) & (lum > 60))
hgt, wid = darkish.shape; bgm = np.zeros_like(darkish); q = deque()
for pt in [(0, 0), (0, wid - 1), (hgt - 1, 0), (hgt - 1, wid - 1), (0, wid // 2), (hgt - 1, wid // 2)]:
    if darkish[pt] and not bgm[pt]: bgm[pt] = True; q.append(pt)
while q:
    y, x = q.popleft()
    for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
        if 0 <= ny < hgt and 0 <= nx < wid and darkish[ny, nx] and not bgm[ny, nx]:
            bgm[ny, nx] = True; q.append((ny, nx))
alpha = np.where(bgm, 0, 255).astype(np.uint8)
alpha_img = Image.fromarray(alpha).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
robot = Image.fromarray(a.astype(np.uint8)).convert('RGBA'); robot.putalpha(alpha_img); robot = robot.crop(robot.getbbox())
robot.save('robot_radar.png')

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-200, 300, 600, 1100), fill=(46, 124, 255, 80)); gd.ellipse((1000, -250, 1800, 450), fill=(34, 197, 128, 40))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(130)))
d = ImageDraw.Draw(bg)
for x in range(0, W, 40): d.line((x, 0, x, H), fill=(255, 255, 255, 6))
for y in range(0, H, 40): d.line((0, y, W, y), fill=(255, 255, 255, 6))

# header
d.text((56, 44), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((208, 46, 318, 78), radius=8, fill=COB); d.text((222, 50), 'UPDATE', font=f(20), fill=INK)
d.text((56, 108), 'NEW IN TERMINAL', font=f(22), fill=GRN)
d.polygon([(66, 146), (100, 146), (84, 188), (110, 188), (60, 252), (74, 204), (50, 204)], fill=GRN)
d.text((124, 134), 'Alpha tab', font=f(70), fill=INK)
d.text((56, 228), 'Fresh alpha  ·  Accumulation  ·  Revival', font=f(24), fill=INK)
d.text((56, 262), 'from our own swap index — every pick shows why', font=f(19, R), fill=MUTED)

# left column: robot
LEFT_W = 470
rb = robot.resize((int(robot.width * 600 / robot.height), 600), Image.LANCZOS)
if rb.width > LEFT_W: rb = rb.resize((LEFT_W, int(rb.height * LEFT_W / rb.width)), Image.LANCZOS)
bg.alpha_composite(rb, (40 + (LEFT_W - rb.width) // 2, H - rb.height - 90)); d = ImageDraw.Draw(bg)

# right column: screenshot card
cx0 = 584; cw = W - 56 - cx0
shot = Image.open('crop_fresh_tight.png').convert('RGBA')
sw = cw - 16; shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS)
sy = 300
d.rounded_rectangle((cx0, sy, cx0 + cw, sy + shot.height + 16), radius=16, fill=CARD + (255,), outline=COB + (210,), width=2)
bg.alpha_composite(shot, (cx0 + 8, sy + 8)); d = ImageDraw.Draw(bg)
cap_y = sy + shot.height + 24
d.text((cx0, cap_y), 'live screenshot  -  arctools.fun/trade  >  Alpha  >  Fresh alpha', font=f(16, R), fill=MUTED)

# tiles
tiles = [('2%', 'rug rate  ·  Accumulation ≥75', 'random pick: 39%'), ('42%', '+10% within 24 h  ·  Accum ≥75', 'baseline: 11%'), ('13%', '≥2× within 24 h  ·  Fresh ≥75', 'baseline: 2%')]
ty = cap_y + 34; th = 112; gap = 14; tw = (cw - 2 * gap) // 3
for i, (big, lab, sub) in enumerate(tiles):
    x = cx0 + i * (tw + gap); d.rounded_rectangle((x, ty, x + tw, ty + th), radius=12, fill=CARD + (235,), outline=(255, 255, 255, 30))
    d.text((x + 18, ty + 8), big, font=f(44), fill=GRN); d.text((x + 18, ty + 62), lab, font=f(17), fill=INK); d.text((x + 18, ty + 86), sub, font=f(15, R), fill=MUTED)
print('tiles bottom', ty + th, '(footer at', H - 46, ')')

# footer
fy = H - 44
d.text((56, fy), 'backtest: 5 days  ·  149,639 swaps  ·  193 cutoffs  ·  top 3 free, full list for ARCT stakers', font=f(16, M), fill=MUTED)
tw_ = d.textlength('arctools.fun', font=f(22)); d.text((W - 56 - tw_, fy - 4), 'arctools.fun', font=f(22), fill=COB)
bg.convert('RGB').save('../33-alpha-tab.png', quality=95); print('saved')
