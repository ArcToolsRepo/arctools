"""62 — v2 preview: the whole site in a terminal frame, running beside v1."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
AMBER = (255, 183, 74)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-120, 220, 820, 1060), fill=COB + (46,))
gd.ellipse((900, 140, 1760, 980), fill=GRN + (26,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 360, 78), radius=8, fill=AMBER)
d.text((222, 50), 'v2 PREVIEW', font=f(20), fill=(30, 18, 2))

d.text((56, 112), 'A second ArcTools,', font=f(58), fill=INK)
d.text((56, 178), 'running beside the first.', font=f(58), fill=GRN)

lines = [
    'Every page rebuilt in one terminal frame: launchpad rail, chart, trades, stats.',
    'Fifteen pages — Terminal, Swap, token pages, Portfolio, Launchpad, Pay and the rest.',
    'A visible v1/v2 switch that carries your filters across. Nothing redirects by itself.',
    'The live site is untouched and stays the default. v2 is opt-in, at /trade2.',
    'And the index now sits on the chain head: swaps land in the tables as blocks close.',
]
yy = 262
for t in lines:
    d.ellipse((58, yy + 9, 66, yy + 17), fill=GRN)
    d.text((80, yy), t, font=f(20, R), fill=(226, 233, 245))
    yy += 37

# screenshot card
shot = Image.open('assets/62-trade2.png').convert('RGB')
cw = 700
shot = shot.resize((cw, int(shot.height * cw / shot.width)), Image.LANCZOS)
cx, cy = 56, 470
g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(g).rounded_rectangle((cx - 14, cy - 14, cx + shot.width + 14, cy + shot.height + 14), radius=24, fill=(0, 0, 0, 140))
bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(18)))
mask = Image.new('L', shot.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=14, fill=255)
bg.paste(shot, (cx, cy), mask)
d = ImageDraw.Draw(bg)
d.rounded_rectangle((cx - 1, cy - 1, cx + shot.width + 1, cy + shot.height + 1), radius=14, outline=(255, 255, 255, 60), width=2)
print('card', (cx, cy), shot.size, 'bottom', cy + shot.height)

# switch illustration
sx, sy = 820, 480
d.rounded_rectangle((sx, sy, sx + 300, sy + 64), radius=14, fill=(18, 24, 36, 240), outline=(255, 255, 255, 50), width=2)
d.rounded_rectangle((sx + 10, sy + 10, sx + 150, sy + 54), radius=10, fill=(40, 46, 62))
d.text((sx + 80, sy + 22), 'v1', font=f(20), fill=INK, anchor='ma')
d.rounded_rectangle((sx + 156, sy + 10, sx + 290, sy + 54), radius=10, fill=AMBER)
d.text((sx + 223, sy + 22), 'v2', font=f(20), fill=(30, 18, 2), anchor='ma')
d.text((sx, sy + 78), 'one switch, same page, same filters', font=f(17, R), fill=MUTED)

# stat chips
chips = [('15', 'pages rebuilt'), ('27', 'launchpads in the rail'), ('0s', 'index lag')]
cxx = 820
for big, lab in chips:
    wb = d.textlength(big, font=f(30)); wl = d.textlength(lab, font=f(13, R)); cw2 = int(max(wb, wl) + 34)
    d.rounded_rectangle((cxx, 600, cxx + cw2, 668), radius=12, fill=(18, 24, 36, 235), outline=(255, 255, 255, 40))
    d.text((cxx + 17, 608), big, font=f(30), fill=GRN)
    d.text((cxx + 17, 644), lab, font=f(13, R), fill=MUTED)
    cxx += cw2 + 12
print('chips end', cxx)

d.rounded_rectangle((820, 700, 1160, 772), radius=12, fill=(18, 24, 36, 235), outline=(46, 124, 255, 120), width=2)
d.text((838, 714), 'arctools.fun/trade2', font=f(24), fill=(157, 192, 255))
d.text((838, 746), 'the current site stays at /trade', font=f(14, R), fill=MUTED)

d.rounded_rectangle((56, H - 66, 300, H - 16), radius=10, fill=GRN)
d.text((78, H - 54), 'arctools.fun', font=f(26), fill=(4, 20, 10))
bg.convert('RGB').save('62-v2-preview.png', quality=95)
print('62-v2-preview.png')
