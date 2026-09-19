"""59 — gARC: the morning greeting, with what shipped and the numbers behind it (robot render reused from 58)."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((950, 150, 1800, 1080), fill=COB + (48,))
gd.ellipse((40, 240, 900, 1000), fill=GRN + (30,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

rob = Image.open('assets/58-robot.png').convert('RGBA')
arr = np.array(rob).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
arr[:, :, 3] = np.clip((np.abs(arr[:, :, :3] - bgc).sum(axis=2) - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
rh = 940; rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 70
bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128
solid_x = rx + int(np.where(a.any(axis=0))[0].min())
print('robot', rob.size, 'solid from x', solid_x)

d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 330, 78), radius=8, fill=COB); d.text((222, 50), 'ON ARC', font=f(20), fill=(255, 255, 255))

d.text((56, 120), 'gARC', font=f(190), fill=INK)
d.text((62, 330), 'good arc, degens.', font=f(34, R), fill=GRN)

lines = [
    'Hopium is in the Terminal — 27 launchpads in one table now.',
    'USDC pay links: send with a link, collect with no wallet and no gas.',
    'Terminal list rebuilt: 40 MB and 18 s down to 4.8 MB and a quarter second.',
    'Logos and socials pulled from contracts, launchpads and DexScreener.',
]
yy = 412
for t in lines:
    d.ellipse((58, yy + 9, 66, yy + 17), fill=GRN)
    d.text((80, yy), t, font=f(21, R), fill=(226, 233, 245))
    yy += 40

chips = [('27', 'launchpads'), ('45.6K', 'tokens tracked'), ('4.1M', 'swaps decoded'), ('54.9M', 'ARCT burned')]
cx = 56
for big, lab in chips:
    wb = d.textlength(big, font=f(28)); wl = d.textlength(lab, font=f(13, R)); cw = int(max(wb, wl) + 36)
    d.rounded_rectangle((cx, 606, cx + cw, 668), radius=12, fill=(18, 24, 36, 235), outline=(255, 255, 255, 42))
    d.text((cx + 18, 612), big, font=f(28), fill=GRN)
    d.text((cx + 18, 646), lab, font=f(13, R), fill=MUTED)
    cx += cw + 12
print('chips end x', cx)

def card(img, x, y, w, radius=16):
    global bg
    im = img.convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle((x - 14, y - 14, x + im.width + 14, y + im.height + 14), radius=radius + 8, fill=(0, 0, 0, 130))
    bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height), radius=radius, fill=255)
    bg.paste(im, (x, y), mask)
    dd = ImageDraw.Draw(bg)
    dd.rounded_rectangle((x - 1, y - 1, x + im.width + 1, y + im.height + 1), radius=radius, outline=(255, 255, 255, 60), width=2)
    print('card', (x, y), im.size, 'right', x + im.width, 'bottom', y + im.height)
    return im.size

term = Image.open('assets/58-terminal.png').crop((232, 150, 1560, 620))
card(term, 56, 706, 700)

d = ImageDraw.Draw(bg)
d.rounded_rectangle((758, 916, 1002, 966), radius=10, fill=GRN)
d.text((780, 928), 'arctools.fun', font=f(26), fill=(4, 20, 10))
bg.convert('RGB').save('59-garc.png', quality=95); print('59-garc.png')
