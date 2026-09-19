"""61 — first swap-fee buyback: the total burn number is the hero, the first transaction is the proof."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (12, 15, 22); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
EMBER = (255, 138, 61)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

# measured 18.09.2026 from /api/arct-burn and /api/buyback-stats
BURNED, PCT, SUPPLY, USD = 56_017_944, 5.602, 965_748_078, 17_242
FIRST_ARCT, FIRST_USDC = 35_354.85, 10.70

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-160, 180, 820, 1080), fill=EMBER + (34,))
gd.ellipse((900, 140, 1780, 1020), fill=COB + (46,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(160)))

rob = Image.open('assets/58-robot.png').convert('RGBA')
arr = np.array(rob).astype(int)
bgc = np.median(arr[:20, :20, :3].reshape(-1, 3), axis=0)
arr[:, :, 3] = np.clip((np.abs(arr[:, :, :3] - bgc).sum(axis=2) - 18) * 6, 0, 255).astype('uint8')
rob = Image.fromarray(arr.astype('uint8'), 'RGBA'); rob = rob.crop(rob.getbbox())
rh = 900; rob = rob.resize((int(rob.width * rh / rob.height), rh), Image.LANCZOS)
rx = W - rob.width + 110
bg.alpha_composite(rob, (rx, H - rob.height))
a = np.array(rob.getchannel('A')) > 128
ROB_L = rx + int(np.where(a.any(axis=0))[0].min())
print('robot', rob.size, 'solid from x', ROB_L)

d = ImageDraw.Draw(bg)
d.text((56, 44), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((208, 46, 348, 78), radius=8, fill=EMBER); d.text((222, 50), 'BUYBACK', font=f(20), fill=(30, 12, 2))

d.text((56, 112), 'The fee comes back', font=f(52), fill=MUTED)
d.text((56, 172), 'to the token.', font=f(52), fill=INK)

# hero number
d.text((52, 250), '56.0M', font=f(168), fill=INK)
d.text((58, 428), 'ARCT burned', font=f(40), fill=EMBER)
d.text((58, 484), f'{PCT}% of supply · {SUPPLY / 1e6:.1f}M left · ≈ ${USD:,} at today\'s price', font=f(19, R), fill=MUTED)

# first buyback receipt
bx, by, bw = 56, 552, 620
g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(g).rounded_rectangle((bx - 10, by - 10, bx + bw + 10, by + 214), radius=24, fill=(0, 0, 0, 130))
bg = Image.alpha_composite(bg, g.filter(ImageFilter.GaussianBlur(16)))
d = ImageDraw.Draw(bg)
d.rounded_rectangle((bx, by, bx + bw, by + 204), radius=16, fill=(17, 23, 35, 242), outline=(255, 255, 255, 52), width=2)
d.text((bx + 20, by + 16), 'FIRST SWAP-FEE BUYBACK', font=f(16), fill=GRN)
d.text((bx + 20, by + 46), f'{FIRST_USDC:.2f} USDC', font=f(34), fill=INK)
ax, ay = bx + 220, by + 64
d.line((ax, ay, ax + 30, ay), fill=MUTED, width=4)
d.polygon([(ax + 28, ay - 8), (ax + 42, ay), (ax + 28, ay + 8)], fill=MUTED)
d.text((bx + 278, by + 46), f'{FIRST_ARCT:,.0f} ARCT', font=f(34), fill=EMBER)
d.text((bx + 20, by + 96), 'bought on the open market and sent to the burn address', font=f(17, R), fill=MUTED)
d.text((bx + 20, by + 124), 'in the same transaction — the keeper never holds the tokens', font=f(17, R), fill=MUTED)
d.rounded_rectangle((bx + 20, by + 156, bx + 428, by + 188), radius=8, fill=(10, 14, 22, 255), outline=(255, 255, 255, 40))
d.text((bx + 32, by + 163), '0x0bc6be56…60c33850', font=f(18, R), fill=(157, 192, 255))
print('receipt box right', bx + bw, 'bottom', by + 204)

# how it works, right column
tx = bx + bw + 46
print('right column x', tx, 'gap to robot', ROB_L - tx)
steps = [('1', 'you swap on arctools.fun/swap'), ('2', 'the router takes 0.5% in USDC'), ('3', 'the keeper buys ARCT with it'), ('4', 'the ARCT goes to 0x…dead')]
yy = 300
for n, txt in steps:
    d.ellipse((tx, yy, tx + 26, yy + 26), fill=COB)
    d.text((tx + 9, yy + 4), n, font=f(16), fill=(255, 255, 255))
    d.text((tx + 40, yy + 2), txt, font=f(18, R), fill=(226, 233, 245))
    yy += 52
d.text((tx, yy + 14), 'No emissions. No promises.', font=f(21), fill=INK)
d.text((tx, yy + 44), 'The counter only moves when a', font=f(17, R), fill=MUTED)
d.text((tx, yy + 68), 'transaction lands on chain.', font=f(17, R), fill=MUTED)

d.rounded_rectangle((tx, 916, tx + 284, 966), radius=10, fill=GRN)
d.text((tx + 22, 928), 'arctools.fun/swap', font=f(26), fill=(4, 20, 10))
print('cta right', tx + 284)
bg.convert('RGB').save('61-burn.png', quality=95); print('61-burn.png')
