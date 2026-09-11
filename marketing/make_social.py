"""Social Check announcement card: user's real screenshot framed in the brand layout."""
import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
SHOT = "https://d2ol7oe51mr4n9.cloudfront.net/user_38W5PuX5Cas7eV2tlkz5eT3j1b7/732db21a-b22c-4286-8c26-ea7fbb6d8f2e.png"
SS = 2
BG, PANEL, LINE = (9, 11, 16), (14, 17, 24), (38, 44, 58)
INK, MUTED, COBALT, UP, AMBER, RED = (240, 244, 252), (124, 136, 158), (46, 124, 255), (34, 197, 128), (232, 168, 56), (240, 83, 79)
F = {
    "display": "/home/.hermes/skills/animated-explainer/scripts/fonts/Montserrat-ExtraBold.ttf",
    "bold": "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "reg": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "monob": "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "mono": "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
}


def font(k, s):
    p = F[k] if os.path.exists(F[k]) else F["bold"]
    return ImageFont.truetype(p, s * SS)


def px(v):
    return int(v * SS)


shot = Image.open(io.BytesIO(urllib.request.urlopen(SHOT, timeout=30).read())).convert("RGB")

W, H = 1600, 900
img = Image.new("RGB", (W * SS, H * SS), BG)
d = ImageDraw.Draw(img)

d.text((px(64), px(44)), "WHO IS BEHIND THIS TOKEN?", font=font("display", 44), fill=INK)
d.text((px(64), px(102)), "Social Check is now on every token page on Arc", font=font("reg", 21), fill=MUTED)
d.rectangle([px(W - 64 - 118), px(50), px(W - 64), px(82)], fill=(16, 40, 30), outline=UP, width=SS)
d.text((px(W - 64 - 59), px(58)), "LIVE NOW", font=font("monob", 14), fill=UP, anchor="ma")

# screenshot, scaled to full content width, framed
tw = px(W - 128)
ratio = tw / shot.width
th = int(shot.height * ratio)
shot_r = shot.resize((tw, th), Image.LANCZOS)
sy = px(150)
d.rectangle([px(64) - px(3), sy - px(3), px(64) + tw + px(3), sy + th + px(3)], outline=COBALT, width=px(2))
img.paste(shot_r, (px(64), sy))
d.text((px(64), sy + th + px(10)), "real card, real token: $BUILDOG on arctools.fun/token — nothing mocked up",
       font=font("mono", 13), fill=MUTED)

# four explainer tiles
tiles = [
    ("X / TWITTER", "Account age, followers, posts.\nPrevious handles from our\nregistry + public archives.", UP),
    ("TELEGRAM", "Group or channel, member count,\nprevious names tracked by the\nimmutable chat id.", UP),
    ("WEBSITE", "Domain registration date via\nRDAP. Two-week-old domain\nunder a 'legacy' project = flag.", AMBER),
    ("DEPLOYER", "Every token this wallet launched\nand how many are dead. Two\ncorpses = red flag.", RED),
]
gy = sy + th + px(44)
gap = px(16)
cw = (px(W - 128) - gap * 3) // 4
ch = px(H) - gy - px(96)
for i, (t, s, c) in enumerate(tiles):
    x = px(64) + (cw + gap) * i
    d.rectangle([x, gy, x + cw, gy + ch], fill=PANEL, outline=LINE, width=SS)
    d.rectangle([x, gy, x + px(4), gy + ch], fill=c)
    d.text((x + px(18), gy + px(16)), t, font=font("monob", 15), fill=COBALT)
    d.multiline_text((x + px(18), gy + px(48)), s, font=font("reg", 15), fill=INK, spacing=px(5))

# the one line that matters
d.text((px(64), px(H - 82)), "The same X account, group or domain reused across several tokens is the oldest rug pattern on any chain. "
       "Now it is one glance.", font=font("reg", 15), fill=MUTED)
d.line([(px(64), px(H - 52)), (px(W - 64), px(H - 52))], fill=LINE, width=SS)
d.text((px(64), px(H - 40)), "ARCTOOLS.FUN", font=font("monob", 16), fill=COBALT)
d.text((px(W - 64), px(H - 40)), "free on every token page  ·  no login  ·  data from our own Arc-wide registry",
       font=font("mono", 13), fill=MUTED, anchor="ra")

img = img.resize((W, H), Image.LANCZOS)
img.save(os.path.join(OUT, "09-social-check.png"), "PNG", optimize=True)
print("09-social-check.png", img.size)
