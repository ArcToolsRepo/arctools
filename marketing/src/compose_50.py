"""50 — Trader profiles, three real screens (profile, leaderboard, phone) presented by the robot."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250)
MUTED = (203, 212, 228); GOLD = (217, 164, 65)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
# a soft cobalt glow in the upper-middle, where the cards will sit
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((300, 150, 1250, 950), fill=COB + (60,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(160)))

# robot: right column, presenting toward the cards; drawn first so nothing ever ends up under it
robot = Image.open('assets/50-robot.png').convert('RGBA')
# the render ships on a solid navy plate; key it out so the figure sits on OUR navy without a visible rectangle
import numpy as np
arr = np.array(robot).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
dist = np.abs(arr[:, :, :3] - bgc).sum(axis=2)
alpha = np.clip((dist - 18) * 6, 0, 255).astype('uint8')       # soft edge, no halo
arr[:, :, 3] = alpha
robot = Image.fromarray(arr.astype('uint8'), 'RGBA')
robot = robot.crop(robot.getbbox())
rh = H - 120
robot = robot.resize((int(robot.width * rh / robot.height), rh), Image.LANCZOS)
rx = W - robot.width + 200
bg.alpha_composite(robot, (rx, H - robot.height))
print('robot', robot.size, 'x', rx, '->', rx + robot.width)


def card(img: Image.Image, x: int, y: int, w: int, radius=14, glow_a=110, tag: str | None = None):
    global bg
    im = img.convert('RGB')
    im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle((x - 14, y - 14, x + im.width + 14, y + im.height + 14), radius=radius + 8, fill=(0, 0, 0, glow_a))
    bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height), radius=radius, fill=255)
    bg.paste(im, (x, y), mask)
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((x - 1, y - 1, x + im.width + 1, y + im.height + 1), radius=radius, outline=(255, 255, 255, 60), width=2)
    if tag:
        tw = d.textlength(tag, font=f(14)) + 20
        d.rounded_rectangle((x + 12, y - 26, x + 12 + tw, y - 4), radius=7, fill=GOLD)
        d.text((x + 22, y - 24), tag, font=f(14), fill=(26, 18, 4))
    print('card', tag, (x, y), im.size)
    return im.size


d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))
d.text((56, 108), 'Trader profiles', font=f(74), fill=INK)
d.text((56, 190), 'your on-chain record, with a name on it', font=f(24), fill=GRN)

# the three screens
prof = Image.open('assets/49-panel.png')
lb = Image.open('assets/50-lb-panel.png')
mob = Image.open('assets/50-mob.png')

pw, ph = card(prof, 56, 270, 720, tag='PROFILE · arctools.fun/u/insider1')
lw, lh = card(lb, 56, 270 + ph + 36, 560, tag='LEADERBOARD · /leaderboard')
# the phone leans into the robot's open palm: right of the cards, overlapping the leaderboard's right edge
mw, mh = card(mob, 56 + 560 + 34, 270 + ph + 36 - 130, 190, radius=20, glow_a=150, tag='PHONE')

# footer
d = ImageDraw.Draw(bg)
fx, fy = 56 + 560 + 34 + 190 + 30, 270 + ph + 36 + lh - 50
d.rounded_rectangle((fx, fy, fx + 244, fy + 50), radius=10, fill=GRN)
d.text((fx + 22, fy + 12), 'arctools.fun', font=f(26), fill=(4, 20, 10))

bg.convert('RGB').save('50-profiles-screens.png', quality=95)
print('50-profiles-screens.png', bg.size)
