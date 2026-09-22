"""71 — gARC: robot with coffee, sunrise, huge gARC wordmark, the day's real Arc numbers from the index."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); AMBER = (255, 176, 84)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
STATS = [('766,318', 'swaps · 24h'), ('46,260', 'wallets · 24h'), ('5,706', 'tokens traded · 24h'), ('23', 'launchpads in one list')]

# the render already carries the sunrise; use it full-bleed and darken the right side for type
art = Image.open(sys.argv[1]).convert('RGBA').resize((W, H), Image.LANCZOS)
shade = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(shade)
for x in range(560, W):
    a = int(150 * min(1, (x - 560) / 300)); sd.line((x, 0, x, H), fill=(6, 8, 12, a))
art = Image.alpha_composite(art, shade)
d = ImageDraw.Draw(art)

d.text((640, 90), 'ArcTools', font=f(30), fill=INK); d.text((770, 100), 'the terminal for Arc', font=f(16, R), fill=MUTED)
# the wordmark: g in muted, ARC in green, huge
big = f(280); x = 700; y = 120
d.text((x, y), 'g', font=big, fill=INK); x += int(d.textlength('g', font=big))
d.text((x, y), 'ARC', font=big, fill=GRN)
d.text((640, 468), 'Coffee first. Then the new pairs.', font=f(30, R), fill=INK)
d.text((640, 512), 'While you slept the index kept counting:', font=f(18, R), fill=MUTED)
# stats row 2x2
sx, sy, sw, sh = 640, 560, 420, 92
for i, (v, l) in enumerate(STATS):
    cx = sx + (i % 2) * (sw + 20); cy = sy + (i // 2) * (sh + 16)
    d.rounded_rectangle((cx, cy, cx + sw, cy + sh), radius=14, fill=(14, 18, 26, 210), outline=(255, 255, 255, 30), width=1)
    d.text((cx + 18, cy + 14), v, font=f(34), fill=AMBER if i == 0 else INK); d.text((cx + 18, cy + 58), l, font=f(14, R), fill=MUTED)
d.rounded_rectangle((640, H - 78, 900, H - 28), radius=10, fill=GRN); d.text((662, H - 66), 'arctools.fun', font=f(26), fill=(4, 20, 10))
d.text((920, H - 62), 'numbers from our own swap index · 2026-09-22 UTC', font=f(14, R), fill=MUTED)
art.convert('RGB').save('71-garc.png', quality=95); print('71-garc.png')
