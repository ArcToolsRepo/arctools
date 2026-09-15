from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/32-status-report.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 900
COBALT = (46, 124, 255); GREEN = (34, 197, 128); INK = (245, 247, 250); MUTED = (175, 189, 208)

canvas = Image.new("RGBA", (W, H), (6, 9, 16, 255))
d = ImageDraw.Draw(canvas)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((900, 150, 1850, 1100), fill=(*COBALT, 62)); gd.ellipse((-260, -260, 720, 520), fill=(*GREEN, 26))
canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(155)))
for x in range(0, W, 40): d.line((x, 0, x, H), fill=(255, 255, 255, 5))
for y in range(0, H, 40): d.line((0, y, W, y), fill=(255, 255, 255, 5))

d.text((70, 48), "ARCTOOLS · SYSTEM REPORT · 15 SEP 2026", font=ImageFont.truetype(MONO, 17), fill=MUTED)
f_h = ImageFont.truetype(RB, 52)
d.text((70, 78), "ALL SYSTEMS", font=f_h, fill=INK)
d.text((70, 136), "OPERATIONAL", font=f_h, fill=GREEN)

# status line
d.rounded_rectangle((70, 206, 470, 248), radius=21, fill=(18, 40, 28, 230), outline=(*GREEN, 220), width=2)
d.ellipse((88, 220, 102, 234), fill=GREEN)
d.text((112, 216), "11 / 11 checks green", font=ImageFont.truetype(RB, 18), fill=INK)

# KPI tiles
tiles = [
    ("26.8M", "requests / 24h", "0 errors"),
    ("244K", "swaps indexed", "$35.3M volume"),
    ("12.9K", "wallets tracked", "4 126 tokens"),
    ("100%", "cells filled", "real-user beacons"),
    ("1.05ms", "worker CPU p50", "0.07s TTFB median"),
    ("8 839", "buy alerts sent", "3 708 in 24h"),
]
tx, ty, tw, thh, gap = 70, 282, 268, 104, 14
for i, (big, label, sub) in enumerate(tiles):
    x = tx + (i % 2) * (tw + gap); y = ty + (i // 2) * (thh + gap)
    d.rounded_rectangle((x, y, x + tw, y + thh), radius=12, fill=(13, 18, 30, 235), outline=(60, 80, 120, 200), width=1)
    d.text((x + 16, y + 12), big, font=ImageFont.truetype(RB, 30), fill=COBALT if i % 2 == 0 else GREEN)
    d.text((x + 16, y + 52), label, font=ImageFont.truetype(RB, 15), fill=INK)
    d.text((x + 16, y + 74), sub, font=ImageFont.truetype(RR, 13), fill=MUTED)

# checklist column
cx, cy = 640, 210
d.text((cx, cy - 34), "EVERY TAB VERIFIED", font=ImageFont.truetype(MONO, 15), fill=MUTED)
items = ["Terminal · 400 rows, Score + Dev/Bundle", "Token page · pro chart, score, socials",
         "Intel · whales, bridge, fresh, clusters", "Insiders · top-100 by 30d PnL",
         "Portfolio · live USDC valuation", "Launchpad · one-tx launches",
         "Rewards · 5.01M ARCT staked", "Scanner · rug check", "Bridge · CCTP v2", "Referrals · self-serve claim"]
for i, t in enumerate(items):
    y = cy + i * 30
    d.ellipse((cx, y + 4, cx + 14, y + 18), outline=GREEN, width=2)
    d.line((cx + 3, y + 11, cx + 6, y + 15), fill=GREEN, width=2); d.line((cx + 6, y + 15, cx + 11, y + 7), fill=GREEN, width=2)
    d.text((cx + 26, y), t, font=ImageFont.truetype(RR, 16), fill=INK if i < 6 else MUTED)

# robot (key out black)
im = Image.open(SRC + "robot_ok_raw.png").convert("RGBA")
a = np.array(im.getchannel("A"))
if a.max() == 0 or (a > 200).mean() > 0.9:
    rgb = np.array(im.convert("RGB")).astype(int); lum = rgb.max(axis=2)
    im.putalpha(Image.fromarray(np.clip((lum - 12) * 14, 0, 255).astype("uint8")))
rw = 430; im = im.resize((rw, int(im.height * rw / im.width)), Image.LANCZOS)
canvas.alpha_composite(im, (W - rw - 40, H - im.height + 30))

# footer
logo = Image.open(LOGO).convert("RGBA"); lh = 34; logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
canvas.alpha_composite(logo, (70, H - 76))
d.text((70 + logo.width + 12, H - 78), "arctools.fun", font=ImageFont.truetype(MONO, 23), fill=INK)
d.text((70 + logo.width + 12, H - 48), "@arctoolsfun · @ArcSniper_bot · @ArcToolsBuyBot", font=ImageFont.truetype(RR, 14), fill=MUTED)
canvas.convert("RGB").save(OUT, quality=95); print(OUT)
