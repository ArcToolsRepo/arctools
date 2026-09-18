"""51 — gARC: morning coffee robot, the Terminal with every launchpad populated, and the trader board."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); GOLD = (217, 164, 65); AMBER = (255, 146, 43)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
# sunrise glow bottom-right (the robot's warm side), cool glow behind the cards
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((1050, 350, 1750, 1150), fill=AMBER + (48,))
gd.ellipse((150, 200, 1000, 900), fill=COB + (55,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

# robot keyed off its navy plate, right column, drawn first
robot = Image.open('assets/51-robot.png').convert('RGBA')
arr = np.array(robot).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
dist = np.abs(arr[:, :, :3] - bgc).sum(axis=2)
arr[:, :, 3] = np.clip((dist - 18) * 6, 0, 255).astype('uint8')
robot = Image.fromarray(arr.astype('uint8'), 'RGBA').crop(Image.fromarray(arr.astype('uint8'), 'RGBA').getbbox())
rh = H - 60
robot = robot.resize((int(robot.width * rh / robot.height), rh), Image.LANCZOS)
rx = W - robot.width + 170
bg.alpha_composite(robot, (rx, H - robot.height))
print('robot', robot.size, 'x', rx, '->', rx + robot.width)


def card(img, x, y, w, radius=14, tag=None):
    global bg
    im = img.convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle((x - 14, y - 14, x + im.width + 14, y + im.height + 14), radius=radius + 8, fill=(0, 0, 0, 120))
    bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height), radius=radius, fill=255)
    bg.paste(im, (x, y), mask)
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((x - 1, y - 1, x + im.width + 1, y + im.height + 1), radius=radius, outline=(255, 255, 255, 60), width=2)
    if tag:
        tw = d.textlength(tag, font=f(14)) + 20
        d.rounded_rectangle((x + 12, y - 26, x + 12 + tw, y - 4), radius=7, fill=GOLD)
        d.text((x + 22, y - 24), tag, font=f(14), fill=(26, 18, 4))
    print('card', tag, (x, y), im.size, 'bottom', y + im.height)
    return im.size


d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))

# the greeting, big
d.text((56, 104), 'gARC', font=f(150), fill=INK)
d.text((56, 262), 'every Arc launchpad in one table,', font=f(24), fill=(228, 235, 246))
d.text((56, 294), 'every trader with a name', font=f(24), fill=GRN)

# stat chips
chips = [('14', 'launchpads live'), ('98K', 'tokens in the registry'), ('54.8M', 'ARCT burned')]
cx = 56
for big, lab in chips:
    wbig = d.textlength(big, font=f(28)); wlab = d.textlength(lab, font=f(14, R))
    cw = int(max(wbig, wlab) + 36)
    d.rounded_rectangle((cx, 344, cx + cw, 404), radius=12, fill=(18, 24, 36, 235), outline=(255, 255, 255, 40))
    d.text((cx + 18, 350), big, font=f(28), fill=GRN if 'burn' not in lab else AMBER)
    d.text((cx + 18, 382), lab, font=f(14, R), fill=MUTED)
    cx += cw + 12

# screens
term = Image.open('assets/51-terminal-panel.png')
lb = Image.open('assets/50-lb-panel.png')
tw_, th_ = card(term, 56, 460, 760, tag='TERMINAL · sharc.fun · 126 tokens')
lw_, lh_ = card(lb, 56 + 760 - 320, 460 + th_ - 110, 420, tag='TRADERS · /leaderboard')

d = ImageDraw.Draw(bg)
d.rounded_rectangle((56, H - 90, 300, H - 40), radius=10, fill=GRN)
d.text((78, H - 78), 'arctools.fun', font=f(26), fill=(4, 20, 10))

bg.convert('RGB').save('51-garc.png', quality=95)
print('51-garc.png', bg.size)
