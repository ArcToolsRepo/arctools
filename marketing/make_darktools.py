"""DarkTools teaser: hooded robot keyart + code-drawn headline."""
import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
ART = "https://d8j0ntlcm91z4.cloudfront.net/user_38W5PuX5Cas7eV2tlkz5eT3j1b7/hf_20260911_204253_a4eb60bc-d69a-47b2-9cbd-492e74aab073.png"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
INK, MUTED, RED, STEEL = (236, 236, 240), (128, 132, 142), (214, 40, 48), (176, 184, 198)
F = {
    "display": "/home/.hermes/skills/animated-explainer/scripts/fonts/Montserrat-ExtraBold.ttf",
    "reg": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "monob": "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "mono": "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
}


def font(k, s):
    return ImageFont.truetype(F[k], s)


art = Image.open(io.BytesIO(urllib.request.urlopen(ART, timeout=60).read())).convert("RGB")
W, H = 1600, 900
img = art.resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(img, "RGBA")

# brand: mark recolored to steel, wordmark DarkTools
logo = Image.open(LOGO).convert("RGBA")
lh = 56
logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
px = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, a = px[x, y]
        if r < 22 and g < 22 and b < 22:
            px[x, y] = (0, 0, 0, 0)
        elif a > 0:
            lum = int(0.3 * r + 0.59 * g + 0.11 * b)
            px[x, y] = (min(255, lum + 60), min(255, lum + 60), min(255, lum + 70), a)
img.paste(logo, (64, 54), logo)
d.text((64 + logo.width + 14, 58), "DarkTools", font=font("display", 32), fill=INK)
d.text((64 + logo.width + 14, 96), "BY ARCTOOLS  ·  CLASSIFIED", font=font("monob", 13), fill=RED)

# headline
y = 300
for line, col in [("MIXER COINS", INK), ("ON ARC.", INK)]:
    d.text((64, y), line, font=font("display", 84), fill=col)
    y += 96
# red rule + COMING
d.line([(64, y + 14), (400, y + 14)], fill=RED, width=3)
d.text((64, y + 34), "COMING", font=font("display", 44), fill=RED)
d.text((64, y + 100), "One entry. Many exits. The trail ends here.", font=font("reg", 20), fill=MUTED)

# footer
d.line([(64, H - 66), (W - 64, H - 66)], fill=(70, 70, 78, 200), width=1)
d.text((64, H - 50), "ARCTOOLS.FUN", font=font("monob", 16), fill=STEEL)
d.text((W - 64, H - 50), "no date  ·  no details  ·  you will know", font=font("mono", 13), fill=MUTED, anchor="ra")
# subtle vignette on left edge
for i in range(120):
    a = int(90 * (1 - i / 120))
    d.line([(i, 0), (i, H)], fill=(0, 0, 0, a))

img.save(os.path.join(OUT, "14-darktools-mixer.png"), "PNG", optimize=True)
print("14-darktools-mixer.png", img.size)
