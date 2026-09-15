"""38 — KOL tracking numbers: robot (network hologram) + real Smart followers / KOL mentions screenshot + KPI tiles."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 1600, 1000
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (236, 240, 247); MUTED = (176, 186, 204); CARD = (20, 26, 38)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
art = Image.open('bg_arc.png').convert('RGB').transpose(Image.FLIP_LEFT_RIGHT)
sc = max(W / art.width, H / art.height); art = art.resize((int(art.width * sc) + 1, int(art.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H))
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.75).convert('RGBA')
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim); sd.rectangle((560, 0, W, H), fill=(8, 10, 16, 120)); sd.rectangle((0, 0, W, 250), fill=(8, 10, 16, 90))
bg = Image.alpha_composite(bg, scrim.filter(ImageFilter.GaussianBlur(40))); d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((208, 46, 318, 78), radius=8, fill=COB); d.text((222, 50), 'INTEL', font=f(20), fill=INK)
d.text((56, 108), 'WHO IS TALKING ABOUT ARC', font=f(22), fill=GRN)
d.text((56, 138), '526 Arc KOLs', font=f(72), fill=INK)
d.text((56, 232), 'tracked (10k+ followers), mapped and matched to every token', font=f(24), fill=INK)
d.text((56, 266), 'smart followers on each token page  ·  KOL mentions on the chart  ·  /x/<handle> profiles', font=f(19, R), fill=MUTED)
# robot (network hologram) left
robot = Image.open('robot_net.png').convert('RGBA'); LEFT_W = 520
rb = robot.resize((int(robot.width * 660 / robot.height), 660), Image.LANCZOS)
if rb.width > LEFT_W: rb = rb.resize((LEFT_W, int(rb.height * LEFT_W / rb.width)), Image.LANCZOS)
bg.alpha_composite(rb, (30 + (LEFT_W - rb.width) // 2, H - rb.height - 20)); d = ImageDraw.Draw(bg)
# screenshot card
shot = Image.open('crop_kol_sf.png').convert('RGBA'); cx0 = 600; cw = W - 56 - cx0
sw = cw - 16; shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS); sy = 330
d.rounded_rectangle((cx0, sy, cx0 + cw, sy + shot.height + 16), radius=16, fill=CARD + (255,), outline=COB + (210,), width=2)
bg.alpha_composite(shot, (cx0 + 8, sy + 8)); d = ImageDraw.Draw(bg)
d.text((cx0, sy - 24), 'live screenshot  -  arctools.fun/token/COOL  >  Smart followers', font=f(15, R), fill=MUTED)
# tiles
tiles = [('37.3M', 'combined followers', '72 accounts with 100k+'), ('1.46M', 'follow edges mapped', 'who follows whom on Arc X'), ('61', 'token mentions caught', '24 tokens · 277k views'), ('105', 'wallets linked to X', 'deployer wallet to X handle')]
ty = sy + shot.height + 44; gap = 14; tw = (cw - gap) // 2; th = 178
for i, (big, lab, sub) in enumerate(tiles):
    x = cx0 + (i % 2) * (tw + gap); y = ty + (i // 2) * (th + gap)
    d.rounded_rectangle((x, y, x + tw, y + th), radius=14, fill=CARD + (235,), outline=(255, 255, 255, 30))
    d.text((x + 22, y + 18), big, font=f(64), fill=GRN); d.text((x + 22, y + 100), lab, font=f(22), fill=INK); d.text((x + 22, y + 134), sub, font=f(16, R), fill=MUTED)
th = 2 * th + gap
print('tiles bottom', ty + th, 'footer', H - 46)
d.text((56, H - 44), 'KOL = 10k+ followers posting about Arc  ·  a follow is attention, not endorsement  ·  numbers from our own index, 15.09.2026', font=f(15, M), fill=MUTED)
tw_ = d.textlength('arctools.fun', font=f(22)); d.text((W - 56 - tw_, H - 48), 'arctools.fun', font=f(22), fill=COB)
bg.convert('RGB').save('../38-kols.png', quality=95); print('saved')
