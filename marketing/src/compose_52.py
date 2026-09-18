"""52 — Tokenized stocks trade on ArcTools: bullish robot, the Terminal with the Stocks chip, ticker coins."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); GOLD = (217, 164, 65)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((1000, 250, 1750, 1100), fill=GRN + (42,))
gd.ellipse((100, 150, 950, 850), fill=COB + (55,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

# robot: key the navy plate, crop, right column (the chart glow in the render is part of the subject and survives the key)
robot = Image.open('assets/52-robot.png').convert('RGBA')
arr = np.array(robot).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
dist = np.abs(arr[:, :, :3] - bgc).sum(axis=2)
arr[:, :, 3] = np.clip((dist - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA')
# drop the floating chart on the render's left so only the figure stays (it starts left of x=760 in the 1440 render)
rob = rob.crop(rob.getbbox())
rh = 780
rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 10
bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128
cols = np.where(a.any(axis=0))[0]
print('robot', rob.size, 'leftmost solid x', rx + int(cols.min()))


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
    print('card', tag, (x, y), im.size, 'right', x + im.width, 'bottom', y + im.height)
    return im.size


d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=COB); d.text((222, 50), 'TERMINAL', font=f(20), fill=(255, 255, 255))

d.text((56, 104), 'Real stocks.', font=f(84), fill=INK)
d.text((56, 194), 'On Arc. One click.', font=f(84), fill=GRN)
d.text((56, 300), 'NVDA, AAPL, TSLA, SPY, GME, CRCL bridged 1:1 - trade them', font=f(24, R), fill=(228, 235, 246))
d.text((56, 332), 'with USDC 24/7, even when Wall Street is closed', font=f(24, R), fill=(228, 235, 246))

# ticker coins: brand hue ring, ticker inside
coins = [('NVDA', (118, 185, 0)), ('AAPL', (200, 200, 205)), ('TSLA', (232, 33, 39)), ('SPY', (0, 96, 169)), ('GME', (200, 30, 30)), ('CRCL', (39, 117, 202))]
cx, cy, r = 56 + 46, 424, 46
for tk, col in coins:
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(18, 24, 36), outline=col, width=4)
    d.ellipse((cx - r + 8, cy - r + 8, cx + r - 8, cy + r - 8), fill=tuple(int(c * 0.35) for c in col))
    tw = d.textlength(tk, font=f(22 if len(tk) > 3 else 26))
    d.text((cx - tw / 2, cy - (13 if len(tk) > 3 else 15)), tk, font=f(22 if len(tk) > 3 else 26), fill=INK)
    cx += 2 * r + 26

# the terminal with the Stocks chip selected: rows of the stock table
term = Image.open('assets/52-terminal-stocks.png')
term = term.crop((300, 395, 1685, 940))    # column header + stock rows from NVDA down
tw_, th_ = card(term, 56, 520, 740, tag='TERMINAL · Stocks · long.supply bridge')

sub = a[max(0, 520 - (H - rob.height)):max(0, 520 + th_ - (H - rob.height)), :]
left_in_card = np.where(sub.any(axis=0))[0]
print('robot solid px inside card band start x =', rx + int(left_in_card.min()) if left_in_card.size else None, '| card right =', 56 + tw_)
d = ImageDraw.Draw(bg)
d.rounded_rectangle((56, H - 90, 300, H - 40), radius=10, fill=GRN)
d.text((78, H - 78), 'arctools.fun', font=f(26), fill=(4, 20, 10))

bg.convert('RGB').save('52-stocks.png', quality=95)
print('52-stocks.png', bg.size)
