"""54 — Pay links on the website: robot (53 render), /pay create + your links, /pay collect view."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); GOLD = (217, 164, 65)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((1050, 300, 1750, 1100), fill=GRN + (40,)); gd.ellipse((100, 100, 900, 800), fill=COB + (50,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

robot = Image.open('assets/53-robot.png').convert('RGBA')
arr = np.array(robot).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
arr[:, :, 3] = np.clip((np.abs(arr[:, :, :3] - bgc).sum(axis=2) - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
rh = 820; rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 90; bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128


def card(img, x, y, w, radius=16, tag=None):
    global bg
    im = img.convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle((x - 14, y - 14, x + im.width + 14, y + im.height + 14), radius=radius + 8, fill=(0, 0, 0, 130))
    bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height), radius=radius, fill=255)
    bg.paste(im, (x, y), mask)
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((x - 1, y - 1, x + im.width + 1, y + im.height + 1), radius=radius, outline=(255, 255, 255, 60), width=2)
    if tag:
        tw = d.textlength(tag, font=f(14)) + 20
        d.rounded_rectangle((x + 12, y - 26, x + 12 + tw, y - 4), radius=7, fill=GOLD); d.text((x + 22, y - 24), tag, font=f(14), fill=(26, 18, 4))
    print('card', tag, (x, y), im.size, 'right', x + im.width, 'bottom', y + im.height)
    return im.size


d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 336, 78), radius=8, fill=COB); d.text((222, 50), 'PAY LINKS', font=f(20), fill=(255, 255, 255))
d.text((56, 104), 'Pay links,', font=f(84), fill=INK)
d.text((56, 194), 'now on the site.', font=f(84), fill=GRN)
d.text((56, 302), 'arctools.fun/pay - create from your trading or browser wallet,', font=f(24, R), fill=(228, 235, 246))
d.text((56, 334), 'track every link live, collect with one click. Same links as the bot.', font=f(24, R), fill=(228, 235, 246))

sender = Image.open('assets/54-pay-sender.png').crop((220, 236, 1415, 870))     # both cards incl. the green "ready" box
collect = Image.open('assets/54-pay-collect.png').crop((283, 236, 1065, 600))    # collect card

w1, h1 = card(sender, 56, 420, 760, tag='/pay · create + your links')
w2, h2 = card(collect, 56 + 760 - 250, 420 + h1 - 150, 420, tag='/pay#code · collect, no gas')
band = a[max(0, 420 - (H - rob.height)):, :]
cols = np.where(band.any(axis=0))[0]
print('robot solid px start x =', rx + int(cols.min()), '| collect card right =', 56 + 510 + w2)
d = ImageDraw.Draw(bg)
bg.convert('RGB').save('54-pay-site.png', quality=95); print('54-pay-site.png')
