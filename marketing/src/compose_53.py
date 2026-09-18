"""53 — USDC pay links: friendly robot offering a coin, the claim page before and after collecting."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); GOLD = (217, 164, 65)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((1000, 300, 1750, 1100), fill=GRN + (40,))
gd.ellipse((100, 100, 900, 800), fill=COB + (50,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

robot = Image.open('assets/53-robot.png').convert('RGBA')
arr = np.array(robot).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
dist = np.abs(arr[:, :, :3] - bgc).sum(axis=2)
arr[:, :, 3] = np.clip((dist - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
rh = 900
rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 60
bg.alpha_composite(rob, (rx, H - rob.height))
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
        d.rounded_rectangle((x + 12, y - 26, x + 12 + tw, y - 4), radius=7, fill=GOLD)
        d.text((x + 22, y - 24), tag, font=f(14), fill=(26, 18, 4))
    print('card', tag, (x, y), im.size, 'right', x + im.width, 'bottom', y + im.height)
    return im.size


d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 336, 78), radius=8, fill=COB); d.text((222, 50), 'PAY LINK', font=f(20), fill=(255, 255, 255))

d.text((56, 104), 'Send USDC', font=f(84), fill=INK)
d.text((56, 194), 'with a link.', font=f(84), fill=GRN)
d.text((56, 302), 'No wallet needed to receive it. No gas needed to collect it.', font=f(24, R), fill=(228, 235, 246))
d.text((56, 334), 'Uncollected links come back to you.', font=f(24, R), fill=(228, 235, 246))

# three steps
steps = [('1', 'type /send 5 in @ArcSniper_bot'), ('2', 'share the link anywhere'), ('3', 'they pick a wallet, USDC lands')]
sx = 56
for n, t in steps:
    d.ellipse((sx, 392, sx + 34, 426), fill=GRN); d.text((sx + 11, 396), n, font=f(20), fill=(3, 23, 12))
    d.text((sx + 44, 398), t, font=f(17, R), fill=MUTED)
    sx += 44 + int(d.textlength(t, font=f(17, R))) + 34

open_ = Image.open('assets/53-claim-open-card.png')
done = Image.open('assets/53-claim-done-card.png')
w1, h1 = card(open_, 56, 470, 330, tag='arctools.fun/bot/claim')
w2, h2 = card(done, 56 + 330 + 36, 470 + 60, 380, tag='collected · 2% fee included')

# robot overlap probe within the cards' band
band = a[max(0, 480 - (H - rob.height)):, :]
cols = np.where(band.any(axis=0))[0]
print('robot solid px in card band start x =', rx + int(cols.min()), '| second card right =', 56 + 366 + w2)

d = ImageDraw.Draw(bg)
d.rounded_rectangle((422, H - 90, 666, H - 40), radius=10, fill=GRN)
d.text((444, H - 78), 'arctools.fun', font=f(26), fill=(4, 20, 10))
bg.convert('RGB').save('53-paylinks.png', quality=95)
print('53-paylinks.png', bg.size)
