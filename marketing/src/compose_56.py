"""56 — Hopium joins the Terminal: welcoming robot + the Terminal with the Hopium chip and its 15 launches."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); GOLD = (217, 164, 65); VIO = (168, 85, 247)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((1050, 300, 1750, 1100), fill=VIO + (40,)); gd.ellipse((100, 100, 900, 800), fill=COB + (50,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))
robot = Image.open('assets/56-robot.png').convert('RGBA'); arr = np.array(robot).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
arr[:, :, 3] = np.clip((np.abs(arr[:, :, :3] - bgc).sum(axis=2) - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
# the presenting arm reaches far left in the render; keep the figure but let it enter from the right edge
rh = 820; rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 200; bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128
def card(img, x, y, w, radius=16, tag=None):
    global bg
    im = img.convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(g).rounded_rectangle((x - 14, y - 14, x + im.width + 14, y + im.height + 14), radius=radius + 8, fill=(0, 0, 0, 130))
    bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height), radius=radius, fill=255)
    bg.paste(im, (x, y), mask); d = ImageDraw.Draw(bg)
    d.rounded_rectangle((x - 1, y - 1, x + im.width + 1, y + im.height + 1), radius=radius, outline=(255, 255, 255, 60), width=2)
    if tag:
        tw = d.textlength(tag, font=f(14)) + 20; d.rounded_rectangle((x + 12, y - 26, x + 12 + tw, y - 4), radius=7, fill=GOLD); d.text((x + 22, y - 24), tag, font=f(14), fill=(26, 18, 4))
    print('card', tag, (x, y), im.size, 'right', x + im.width, 'bottom', y + im.height); return im.size
d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 400, 78), radius=8, fill=COB); d.text((222, 50), 'NEW LAUNCHPAD', font=f(20), fill=(255, 255, 255))
d.text((56, 104), 'Hopium', font=f(96), fill=INK)
d.text((56, 206), 'is in the Terminal.', font=f(64), fill=VIO)
d.text((56, 300), 'Stock-paired launches on Uniswap v4, liquidity locked at creation.', font=f(23, R), fill=(228, 235, 246))
d.text((56, 332), 'Every Hopium coin: one click to buy, live price, score, logo - like the other 26 pads.', font=f(23, R), fill=(228, 235, 246))
chips = [('27', 'launchpads in one table'), ('15', 'Hopium launches indexed'), ('v4', 'pools, locked LP')]
cx = 56
for big, lab in chips:
    wbig = d.textlength(big, font=f(28)); wlab = d.textlength(lab, font=f(14, R)); cw = int(max(wbig, wlab) + 36)
    d.rounded_rectangle((cx, 380, cx + cw, 440), radius=12, fill=(18, 24, 36, 235), outline=(255, 255, 255, 40))
    d.text((cx + 18, 386), big, font=f(28), fill=VIO); d.text((cx + 18, 418), lab, font=f(14, R), fill=MUTED); cx += cw + 12
term = Image.open('assets/56-terminal-hopium.png').crop((232, 150, 1420, 780))
tw_, th_ = card(term, 56, 490, 760, tag='TERMINAL · Hopium · 15 tokens')
band = a[max(0, 490 - (H - rob.height)):, :]; cols = np.where(band.any(axis=0))[0]
print('robot solid start x =', rx + int(cols.min()), '| card right =', 56 + tw_)
d = ImageDraw.Draw(bg)
bg.convert('RGB').save('56-hopium.png', quality=95); print('56-hopium.png')
