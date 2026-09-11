"""ArcToolsPad v3 announcement: AI keyart (robot pairing two coins) + code-drawn headline, logo, bullets."""
import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
ART = "https://d8j0ntlcm91z4.cloudfront.net/user_38W5PuX5Cas7eV2tlkz5eT3j1b7/hf_20260911_131813_d368d8c2-da7e-40cd-9781-cdb55912e869.png"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
F = {
    "display": "/home/.hermes/skills/animated-explainer/scripts/fonts/Montserrat-ExtraBold.ttf",
    "bold": "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "reg": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "monob": "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "mono": "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
}
INK, MUTED, COBALT, UP = (240, 244, 252), (150, 162, 185), (46, 124, 255), (34, 197, 128)


def font(k, s):
    p = F[k] if os.path.exists(F[k]) else F["bold"]
    return ImageFont.truetype(p, s)


art = Image.open(io.BytesIO(urllib.request.urlopen(ART, timeout=60).read())).convert("RGB")
W, H = 1600, 900
img = art.resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(img, "RGBA")
# soft scrim over the left block so type stays crisp on the keyart
d.rectangle([0, 0, 760, H], fill=(6, 8, 14, 150))

# logo mark + wordmark
logo = Image.open(LOGO).convert("RGBA")
lh = 64
logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
# black bg of the mark -> alpha
px = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, a = px[x, y]
        if r < 22 and g < 22 and b < 22:
            px[x, y] = (r, g, b, 0)
img.paste(logo, (64, 54), logo)
d.text((64 + logo.width + 14, 60), "ArcTools Insiders", font=font("display", 34), fill=INK)
d.text((64 + logo.width + 14, 100), "TELEGRAM  ·  LIVE ALERTS", font=font("monob", 14), fill=COBALT)

# headline
y = 200
for line, col in [("THE TOP-20 WALLETS", INK), ("ON ARC JUST MOVED.", INK), ("YOU KNOW IN SECONDS.", UP)]:
    size = 56
    while d.textlength(line, font=font("display", size)) > 660 and size > 30:
        size -= 1
    d.text((64, y), line, font=font("display", size), fill=col)
    y += 68

d.multiline_text((64, y + 16), "Every buy and sell of the highest-PnL wallets on Arc,\nposted to Telegram right after the block.",
       font=font("reg", 21), fill=MUTED, spacing=6)

# bullets
y += 100
bul = [
    ("WHO", "top-20 wallets by realized 30d PnL, refreshed every 5 min"),
    ("WHAT", "buys and sells over $150: size, avg entry, adding or exiting"),
    ("CLUSTER", "a separate post when 3+ insiders enter the same token"),
    ("SPEED", "our own chain-wide index: V3, V4 and every launchpad"),
    ("ACT", "one tap to snipe the token or copy the wallet in the sniper"),
]
for k, v in bul:
    d.rectangle([64, y + 7, 70, y + 21], fill=COBALT)
    d.text((84, y), k, font=font("monob", 15), fill=COBALT)
    d.text((84 + 96, y + 1), v, font=font("reg", 17), fill=INK)
    y += 34

# footer
d.line([(64, H - 66), (W - 64, H - 66)], fill=(60, 70, 95, 200), width=1)
d.text((64, H - 50), "T.ME/ARCTOOLSINSIDERS   ·   ARCTOOLS.FUN/INSIDERS", font=font("monob", 17), fill=COBALT)
d.rectangle([W - 64 - 118, H - 56, W - 64, H - 26], fill=(16, 40, 30, 230), outline=UP, width=1)
d.text((W - 64 - 59, H - 49), "LIVE NOW", font=font("monob", 14), fill=UP, anchor="ma")

img.save(os.path.join(OUT, "12-insiders-robot.png"), "PNG", optimize=True)
print("12-insiders-robot.png", img.size)
