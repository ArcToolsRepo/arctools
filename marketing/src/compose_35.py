"""35 — Bubble map + Orders. Robot (radar) left, live Fresh-alpha screenshot right, backtest tiles, footer."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

W, H = 1600, 1010
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (236, 240, 247); MUTED = (150, 160, 178); CARD = (20, 26, 38)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

# robot cut-out: this render has a usable alpha channel (body ~253, glow haze ~0) -> hard threshold + 1px erosion
raw = Image.open('robot_net_raw.png').convert('RGBA'); a = np.array(raw)
alpha = np.where(a[..., 3] > 120, 255, 0).astype(np.uint8)
alpha_img = Image.fromarray(alpha).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
robot = raw.copy(); robot.putalpha(alpha_img); robot = robot.crop(robot.getbbox())
robot.save('robot_net.png')

art = Image.open('bg_arc.png').convert('RGB').transpose(Image.FLIP_LEFT_RIGHT)
sc = max(W / art.width, H / art.height); art = art.resize((int(art.width * sc) + 1, int(art.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H))
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.78).convert('RGBA')
# darken the right column a little so the UI card and tiles read cleanly
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim)
sd.rectangle((560, 0, W, H), fill=(8, 10, 16, 110)); sd.rectangle((0, 0, W, 300), fill=(8, 10, 16, 90))
bg = Image.alpha_composite(bg, scrim.filter(ImageFilter.GaussianBlur(40)))
d = ImageDraw.Draw(bg)

# header
d.text((56, 44), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((208, 46, 318, 78), radius=8, fill=COB); d.text((222, 50), 'UPDATE', font=f(20), fill=INK)
d.text((56, 108), 'NEW ON EVERY TOKEN PAGE', font=f(22), fill=GRN)
d.polygon([(66, 146), (100, 146), (84, 188), (110, 188), (60, 252), (74, 204), (50, 204)], fill=GRN)
d.text((124, 134), 'Bubble map', font=f(70), fill=INK)
d.text((56, 228), 'Who is connected to whom', font=f(24), fill=INK)
d.text((56, 262), 'funding, transfers, bundles, insider windows', font=f(19, R), fill=MUTED)

# left column: robot
LEFT_W = 600
rb = robot.resize((int(robot.width * 700 / robot.height), 700), Image.LANCZOS)
if rb.width > LEFT_W: rb = rb.resize((LEFT_W, int(rb.height * LEFT_W / rb.width)), Image.LANCZOS)
bg.alpha_composite(rb, (20 + (LEFT_W - rb.width) // 2, H - rb.height - 10)); d = ImageDraw.Draw(bg)

# right column: screenshot card
cx0 = 660; cw = W - 56 - cx0
shot = Image.open('crop_bubbles.png').convert('RGBA')
sw = min(cw - 16, 880); shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS)
sy = 300
cxs = cx0 + (cw - sw - 16) // 2
d.rounded_rectangle((cxs, sy, cxs + sw + 16, sy + shot.height + 16), radius=16, fill=CARD + (255,), outline=COB + (210,), width=2)
bg.alpha_composite(shot, (cxs + 8, sy + 8)); d = ImageDraw.Draw(bg)
cap_y = sy + shot.height + 24
d.text((cx0, cap_y), 'live screenshot  -  arctools.fun/token/COOL  >  Bubble map', font=f(16, R), fill=MUTED)

# tiles
tiles = [('16.5%', 'largest cluster on COOL', '27 wallets, one funder'), ('5 link types', 'funding · transfer · bundle · insider', 'every line has a reason'), ('Orders', 'limit buy · take profit · stop loss', 'non-custodial, drawn on the chart')]
ty = cap_y + 34; th = 112; gap = 14; tw = (cw - 2 * gap) // 3
for i, (big, lab, sub) in enumerate(tiles):
    x = cx0 + i * (tw + gap); d.rounded_rectangle((x, ty, x + tw, ty + th), radius=12, fill=CARD + (235,), outline=(255, 255, 255, 30))
    d.text((x + 18, ty + 8), big, font=f(44), fill=GRN); d.text((x + 18, ty + 62), lab, font=f(15), fill=INK); d.text((x + 18, ty + 86), sub, font=f(15, R), fill=MUTED)
print('tiles bottom', ty + th, '(footer at', H - 46, ')')

# footer
fy = H - 44
d.text((56, fy), 'bubble area = share of supply  ·  a line = proven on-chain link  ·  gold ring = deployer  ·  green ring = insider', font=f(16, M), fill=MUTED)
tw_ = d.textlength('arctools.fun', font=f(22)); d.text((W - 56 - tw_, fy - 4), 'arctools.fun', font=f(22), fill=COB)
bg.convert('RGB').save('../35-bubble-map.png', quality=95); print('saved')
