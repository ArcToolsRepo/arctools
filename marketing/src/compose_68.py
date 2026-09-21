"""68 — code is public: robot + a GitHub-style repo card drawn from REAL repo data (API), not a browser render
(Firecrawl's GitHub render came with three dropdown menus open)."""
import json, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
D = json.load(open('assets/68-repo.json'))
LANG_COL = {'TypeScript': (49, 120, 198), 'Python': (53, 114, 165), 'CSS': (86, 61, 124), 'Solidity': (170, 103, 70), 'JavaScript': (241, 224, 90)}

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-250, 250, 650, 1150), fill=GRN + (44,)); gd.ellipse((950, -250, 1850, 550), fill=COB + (48,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(170)))

import numpy as np
robot = Image.open(sys.argv[1]).convert('RGBA'); rh = 700; rw = int(robot.width * rh / robot.height)
robot = robot.resize((rw, rh), Image.LANCZOS).crop((0, 0, int(rw * 0.50), rh))
fade = np.full((rh, robot.width), 255, dtype=np.float32); fade[:, -90:] *= np.linspace(1, 0, 90)[None, :]; fade[-60:, :] *= np.linspace(1, 0, 60)[:, None]
robot.putalpha(Image.fromarray(np.minimum(np.array(robot.split()[3], dtype=np.float32), fade).astype('uint8')))
bg.alpha_composite(robot, (0, H - rh - 10))
d = ImageDraw.Draw(bg)

d.text((580, 56), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((720, 58, 900, 90), radius=8, fill=GRN); d.text((732, 63), 'OPEN SOURCE', font=f(19), fill=(4, 20, 10))
d.text((580, 108), 'The code is public.', font=f(54), fill=INK)
d.text((580, 176), 'Sniper, buybot, aggregator, launchpad, site, app — one repo, every commit.', font=f(21, R), fill=MUTED)

# repo card (GitHub dark palette, real data)
cx, cy, cw, ch = 580, 222, 960, 640
d.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=16, fill=(13, 17, 23), outline=(48, 54, 61), width=2)
d.ellipse((cx + 22, cy + 20, cx + 46, cy + 44), fill=(139, 148, 158))
d.text((cx + 58, cy + 20), D['name'].split('/')[0] + ' / ', font=f(22, R), fill=(139, 148, 158))
d.text((cx + 58 + d.textlength(D['name'].split('/')[0] + ' / ', font=f(22, R)), cy + 20), D['name'].split('/')[1], font=f(22), fill=(88, 166, 255))
d.rounded_rectangle((cx + cw - 110, cy + 20, cx + cw - 22, cy + 48), radius=14, outline=(48, 54, 61), width=2); d.text((cx + cw - 66, cy + 26), 'Public', font=f(14, R), fill=(139, 148, 158), anchor='ma')
# branch row
d.rounded_rectangle((cx + 22, cy + 64, cx + 130, cy + 96), radius=6, fill=(33, 38, 45)); bx, by = cx + 40, cy + 70
d.ellipse((bx, by, bx + 6, by + 6), fill=INK); d.ellipse((bx, by + 14, bx + 6, by + 20), fill=INK); d.ellipse((bx + 10, by + 4, bx + 16, by + 10), fill=INK)
d.line((bx + 3, by + 6, bx + 3, by + 14), fill=INK, width=2); d.line((bx + 13, by + 10, bx + 13, by + 12, bx + 3, by + 14), fill=INK, width=2)
d.text((bx + 26, cy + 72), D['branch'], font=f(15), fill=INK)
d.text((cx + cw - 22, cy + 72), f"{D['commits']} commits", font=f(15, R), fill=(139, 148, 158), anchor='ra')
# last commit bar
d.rounded_rectangle((cx + 22, cy + 110, cx + cw - 22, cy + 150), radius=8, fill=(22, 27, 34), outline=(48, 54, 61))
d.text((cx + 40, cy + 121), 'ArcTools  ' + D['last'], font=f(15, R), fill=MUTED)
# file rows
y = cy + 166
for name, kind in [x for x in D['files'] if x[0] not in ('.gitignore', 'audit.py', 'HANDOVER.md')]:
    d.line((cx + 22, y, cx + cw - 22, y), fill=(33, 38, 45))
    if kind == 'dir':
        d.rounded_rectangle((cx + 40, y + 11, cx + 60, y + 25), radius=3, fill=(84, 174, 255)); d.rectangle((cx + 40, y + 9, cx + 49, y + 13), fill=(84, 174, 255))
    else:
        d.rectangle((cx + 43, y + 8, cx + 57, y + 26), outline=(139, 148, 158), width=2)
    d.text((cx + 74, y + 7), name, font=f(16, R), fill=INK)
    y += 30
# languages
ly = y + 14; d.text((cx + 22, ly), 'Languages', font=f(15), fill=INK); ly += 28
x = cx + 22; bw = cw - 44
for lang, pct in D['langs']:
    w = int(bw * pct / 100); d.rectangle((x, ly, x + max(w, 3), ly + 10), fill=LANG_COL.get(lang, (120, 120, 120))); x += w + 2
ly += 22; x = cx + 22
for lang, pct in D['langs']:
    d.ellipse((x, ly + 4, x + 10, ly + 14), fill=LANG_COL.get(lang, (120, 120, 120))); t = f'{lang} {pct}%'; d.text((x + 16, ly), t, font=f(14, R), fill=MUTED); x += 16 + d.textlength(t, font=f(14, R)) + 22

d.rounded_rectangle((580, H - 66, 1080, H - 16), radius=10, fill=GRN)
d.text((602, H - 54), 'github.com/ArcToolsRepo/arctools', font=f(26), fill=(4, 20, 10))
bg.convert('RGB').save('68-open-source.png', quality=95); print('68-open-source.png; files end y', y, 'langs end', ly + 20)
