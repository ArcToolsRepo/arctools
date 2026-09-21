"""67 — ArcTools tracked on 8 platforms: robot + REAL brand marks (downloaded, never generated) in tiles."""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
L = 'assets/logos67/'
BRANDS = [('Coinbase', L + 'coinbase.com.png', 'coinbase.com/price/arctools'),
          ('Binance Web3', L + 'binance.com.png', 'web3.binance.com'),
          ('Bybit', L + 'bybit_cg.png', 'bybit.com/price/arctools'),
          ('MEXC', L + 'mexc.com.png', 'mexc.com/price/arctools'),
          ('LBank', L + 'lbank.com.png', 'lbank.com/price/arctools'),
          ('BingX', L + 'bingx_cmc.png', 'bingx.com/price/arctools'),
          ('CryptoRank', L + 'cryptorank.io.png', 'cryptorank.io/price/arctools'),
          ('Tangem', L + 'tangem.com.png', 'tangem.com/cryptocurrencies/arctools')]

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-250, 250, 650, 1150), fill=GRN + (44,)); gd.ellipse((950, -250, 1850, 550), fill=COB + (48,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(170)))

# robot (left)
robot = Image.open(sys.argv[1]).convert('RGBA')
rh = 720; rw = int(robot.width * rh / robot.height); robot = robot.resize((rw, rh), Image.LANCZOS)
# the render is 16:9 with the robot in the left third — crop that third
robot = robot.crop((0, 0, int(rw * 0.42), rh))
import numpy as np
fade = np.full((rh, robot.width), 255, dtype=np.float32)
fade[:, -80:] *= np.linspace(1, 0, 80)[None, :]
fade[-60:, :] *= np.linspace(1, 0, 60)[:, None]
alpha = np.minimum(np.array(robot.split()[3], dtype=np.float32), fade)
robot.putalpha(Image.fromarray(alpha.astype('uint8')))
bg.alpha_composite(robot, (0, H - rh - 20))

d = ImageDraw.Draw(bg)
d.text((560, 60), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((700, 62, 852, 94), radius=8, fill=GRN); d.text((712, 67), 'ARCT · ARC', font=f(19), fill=(4, 20, 10))
d.text((560, 116), 'Tracked where the market looks.', font=f(50), fill=INK)
d.text((560, 178), 'ARCT now has a price page on eight platforms', font=f(24, R), fill=MUTED)
d.text((560, 210), 'Coinbase, Binance Web3, Bybit, MEXC, LBank, BingX, CryptoRank, Tangem.', font=f(24, R), fill=MUTED)

# tiles 4 x 2
tw, th, gap = 232, 250, 22; x0, y0 = 560, 290
for i, (name, path, url) in enumerate(BRANDS):
    x = x0 + (i % 4) * (tw + gap); y = y0 + (i // 4) * (th + gap)
    d.rounded_rectangle((x, y, x + tw, y + th), radius=22, fill=(20, 24, 32), outline=(255, 255, 255, 28), width=2)
    logo = Image.open(path).convert('RGBA')
    # brand marks arrive on their own flat square backdrops (black, navy, grey, white): sample the corner colour and
    # key it out so the mark sits directly on the tile. Tolerance 28 keeps anti-aliased edges.
    import numpy as np
    arr = np.array(logo).astype(np.int16); corner = arr[2, 2, :3]
    if arr[2, 2, 3] > 0:
        dist = np.abs(arr[:, :, :3] - corner).sum(axis=2)
        keep = np.clip((dist - 28) * 12, 0, 255)
        arr[:, :, 3] = np.minimum(arr[:, :, 3], keep)
        logo = Image.fromarray(arr.astype('uint8'))
    sz = 112 if logo.width >= 100 else 104
    logo = logo.resize((sz, sz), Image.LANCZOS)
    bg.alpha_composite(logo, (x + (tw - sz) // 2, y + 34))
    d.text((x + tw // 2, y + 176), name, font=f(24), fill=INK, anchor='ma')
    d.text((x + tw // 2, y + 210), url if len(url) < 30 else url.split('/')[0], font=f(13, R), fill=MUTED, anchor='ma')

d.rounded_rectangle((560, H - 78, 800, H - 28), radius=10, fill=GRN)
d.text((582, H - 66), 'arctools.fun', font=f(26), fill=(4, 20, 10))
d.text((820, H - 62), 'ARCT 0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52 · logos belong to their owners', font=f(14, R), fill=MUTED)
bg.convert('RGB').save('67-tracked-on.png', quality=95); print('67-tracked-on.png')
