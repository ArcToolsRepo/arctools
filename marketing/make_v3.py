"""ArcToolsPad v3 announcement: AI keyart (robot pairing two coins) + code-drawn headline, logo, bullets."""
import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
ART = "https://d8j0ntlcm91z4.cloudfront.net/user_38W5PuX5Cas7eV2tlkz5eT3j1b7/hf_20260911_120245_f327b599-90ad-4215-bcc3-b644fa0d047f.png"
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
d.text((64 + logo.width + 14, 60), "ArcToolsPad", font=font("display", 34), fill=INK)
d.text((64 + logo.width + 14, 100), "LAUNCHPAD  ·  V3", font=font("monob", 14), fill=COBALT)

# headline
y = 200
for line, col in [("LAUNCH IN ANY PAIR.", INK), ("EARN IN ANY TOKEN.", INK), ("GRADUATE TO UNISWAP.", COBALT)]:
    d.text((64, y), line, font=font("display", 56), fill=col)
    y += 68

d.text((64, y + 16), "The first launchpad on Arc where the pair is not USDC by default.",
       font=font("reg", 21), fill=MUTED)

# bullets
y += 72
bul = [
    ("PAIR", "USDC, TOLLY or any token with a USDC pool"),
    ("REWARDS", "holders paid in the pair token, USDC, $ARCT or custom"),
    ("MODES", "curve → Uniswap at $5k / $10k, or instant Uniswap launch"),
    ("GRADUATION", "reserve + tokens into a V3 pool, LP burned — permanent"),
    ("STAKERS", "5% of every launch + 10% of fees to $ARCT stakers"),
]
for k, v in bul:
    d.rectangle([64, y + 7, 70, y + 21], fill=COBALT)
    d.text((84, y), k, font=font("monob", 15), fill=COBALT)
    d.text((84 + 118, y + 1), v, font=font("reg", 17), fill=INK)
    y += 34

# footer
d.line([(64, H - 66), (W - 64, H - 66)], fill=(60, 70, 95, 200), width=1)
d.text((64, H - 50), "ARCTOOLS.FUN/LAUNCHPAD", font=font("monob", 17), fill=COBALT)
d.rectangle([W - 64 - 118, H - 56, W - 64, H - 26], fill=(16, 40, 30, 230), outline=UP, width=1)
d.text((W - 64 - 59, H - 49), "LIVE NOW", font=font("monob", 14), fill=UP, anchor="ma")

img.save(os.path.join(OUT, "10-pad-v3-announce.png"), "PNG", optimize=True)
print("10-pad-v3-announce.png", img.size)
