"""Aggregator announcement: robot gathering coins (AI keyart) + code-drawn headline, copy and a row of real launchpad logos."""
import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont, ImageOps

OUT = os.path.dirname(os.path.abspath(__file__))
ART = "https://d8j0ntlcm91z4.cloudfront.net/user_38W5PuX5Cas7eV2tlkz5eT3j1b7/hf_20260911_194931_1c3261ab-b249-42c0-af8b-35f77e84cc77.png"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
LOGOS = os.path.join(OUT, "logos")
INK, MUTED, COBALT, UP, AMBER = (240, 244, 252), (150, 162, 184), (46, 124, 255), (34, 197, 128), (232, 168, 56)
F = {
    "display": "/home/.hermes/skills/animated-explainer/scripts/fonts/Montserrat-ExtraBold.ttf",
    "bold": "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "reg": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "monob": "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "mono": "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
}


def font(k, s):
    return ImageFont.truetype(F[k] if os.path.exists(F[k]) else F["bold"], s)


art = Image.open(io.BytesIO(urllib.request.urlopen(ART, timeout=60).read())).convert("RGB")
W, H = 1600, 900
img = art.resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(img, "RGBA")
d.rectangle([0, 0, 680, H], fill=(6, 8, 14, 165))          # scrim under the type block
# soft gradient scrim under the logo strip (no hard edge across the robot)
for i in range(230):
    a = int(170 * (i / 230) ** 1.6)
    d.line([(0, H - 230 + i), (W, H - 230 + i)], fill=(6, 8, 14, a))

# brand
logo = Image.open(LOGO).convert("RGBA")
lh = 60
logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
px = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, a = px[x, y]
        if r < 22 and g < 22 and b < 22:
            px[x, y] = (r, g, b, 0)
img.paste(logo, (64, 50), logo)
d.text((64 + logo.width + 14, 56), "ArcTools", font=font("display", 32), fill=INK)
d.text((64 + logo.width + 14, 94), "AGGREGATOR  ·  EVERY LAUNCHPAD ON ARC", font=font("monob", 13), fill=COBALT)

# headline
y = 178
for line, col in [("14 LAUNCHPADS.", INK), ("ONE FEED.", INK), ("ONE SWAP.", COBALT)]:
    size = 60
    while d.textlength(line, font=font("display", size)) > 590:
        size -= 1
    d.text((64, y), line, font=font("display", size), fill=col)
    y += 72

d.multiline_text((64, y + 10),
                 "Arc has 14 launchpads fighting for the same traders before public\n"
                 "mainnet. Each one has its own list, its own chart, its own button.\n"
                 "None of them shows the others. We do.",
                 font=font("reg", 19), fill=MUTED, spacing=6)

# bullets
y += 116
for k, v in [
    ("FEED", "every launch from 9 pads + raw V3 / V4 pools, one stream"),
    ("STAGE", "curve %, graduated, locked LP — normalized across pads"),
    ("ROUTE", "V3 tiers, V4 pools, bonding curves quoted, best one wins"),
    ("SPLIT", "two venues in one tx when it beats a single pool"),
    ("ALERTS", "sniper, buy bot and insider alerts wired to all of them"),
]:
    d.rectangle([64, y + 6, 70, y + 20], fill=COBALT)
    d.text((84, y), k, font=font("monob", 14), fill=COBALT)
    d.text((84 + 86, y + 1), v, font=font("reg", 16), fill=INK)
    y += 30

# logo strip
names = ["ArcTools", "Tolly", "RadarDex", "ArcPad", "Warp", "Archemist", "Arguspad", "act.fun", "UBI.fun"]
labels = ["ArcToolsPad", "Tolly", "RadarDex", "ArcPad", "Warp", "Archemist", "Arguspad", "act.fun", "UBI.fun"]
d.text((64, H - 172), "LIVE IN THE FEED, THE SWAP ROUTER, THE SNIPER AND THE BUY BOT", font=font("monob", 12), fill=MUTED)
size = 64
gap = 28
x = 64
cy = H - 100
for n, lab in zip(names, labels):
    p = os.path.join(LOGOS, n + ".png")
    if os.path.exists(p):
        im = Image.open(p).convert("RGBA")
        if n == "ArcTools":
            # brand mark: transparent bg already handled above; drop near-black to alpha
            pxl = im.load()
            for yy in range(im.height):
                for xx in range(im.width):
                    r, g, b, a = pxl[xx, yy]
                    if r < 22 and g < 22 and b < 22:
                        pxl[xx, yy] = (r, g, b, 0)
            im = ImageOps.contain(im, (size, size))
            tile = Image.new("RGBA", (size, size), (14, 17, 24, 255))
            tile.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
            im = tile
        else:
            im = ImageOps.fit(im, (size, size), Image.LANCZOS)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=14, fill=255)
        img.paste(im, (x, cy - size // 2), mask)
        d.rounded_rectangle([x, cy - size // 2, x + size - 1, cy + size // 2 - 1], radius=14, outline=(60, 70, 95, 255), width=1)
    d.text((x + size // 2, cy + size // 2 + 8), lab, font=font("mono", 11), fill=MUTED, anchor="ma")
    x += size + gap
d.text((x + 6, cy - 10), "+ every Uniswap V3 / V4 pool on Arc", font=font("reg", 14), fill=MUTED)

# footer
d.line([(64, H - 40), (W - 64, H - 40)], fill=(60, 70, 95, 200), width=1)
d.text((64, H - 30), "ARCTOOLS.FUN/FEED", font=font("monob", 14), fill=COBALT)
d.text((W - 64, H - 30), "1% fee on every swap  ·  10% of it to $ARCT stakers  ·  not financial advice", font=font("mono", 12), fill=MUTED, anchor="ra")

img.save(os.path.join(OUT, "13-aggregator.png"), "PNG", optimize=True)
print("13-aggregator.png", img.size)
