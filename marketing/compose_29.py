from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/29-five-languages.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 900
GREEN = (34, 197, 94); CYAN = (78, 205, 255); INK = (245, 247, 250); MUTED = (200, 215, 235)

# background: diagonal navy -> teal gradient with soft violet bloom, no grid (dark cards must pop)
import numpy as np
yy, xx = np.mgrid[0:H, 0:W].astype("float32"); tt = (xx / W * 0.65 + yy / H * 0.35)
c0 = np.array([24, 38, 110], "float32"); c1 = np.array([10, 110, 120], "float32")
arr = c0[None, None, :] * (1 - tt[..., None]) + c1[None, None, :] * tt[..., None]
canvas = Image.fromarray(np.clip(arr, 0, 255).astype("uint8"), "RGB").convert("RGBA")
d = ImageDraw.Draw(canvas)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((950, 250, 1750, 1050), fill=(120, 80, 220, 110)); gd.ellipse((-250, -250, 650, 450), fill=(60, 220, 160, 70))
canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(170)))

# header (left)
d.text((70, 52), "ARCTOOLS · UPDATE", font=ImageFont.truetype(MONO, 18), fill=MUTED)
f_h = ImageFont.truetype(RB, 50)
d.text((70, 82), "ONE TERMINAL.", font=f_h, fill=INK)
d.text((70, 140), "FIVE LANGUAGES.", font=f_h, fill=CYAN)
f_b = ImageFont.truetype(RB, 20); f_bs = ImageFont.truetype(RR, 16)
for i, (t, sub) in enumerate([
    ("English · Chinese · Español · Русский · Polski", "800+ strings, every page and every tab — not just menus"),
    ("Tickers, names and addresses stay as they are", "everything else follows your language"),
    ("No flash, remembered, shareable", "?lang=ru in any link opens the page in Russian"),
    ("Light or dark", "one click, applied before the first frame"),
]):
    y = 214 + i * 58
    d.rectangle((70, y + 6, 80, y + 16), fill=GREEN if i % 2 == 0 else CYAN)
    d.text((92, y - 2), t, font=f_b, fill=INK); d.text((92, y + 24), sub, font=f_bs, fill=MUTED)

def card(img, x, y, w, border, tilt=0):
    im = img.convert("RGBA"); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    mask = Image.new("L", im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=14, fill=255)
    fr = Image.new("RGBA", (im.width + 4, im.height + 4), (0, 0, 0, 0))
    ImageDraw.Draw(fr).rounded_rectangle((0, 0, fr.width - 1, fr.height - 1), radius=16, fill=(*border, 255))
    fr.paste(im, (2, 2), mask)
    sh = Image.new("RGBA", (fr.width + 90, fr.height + 90), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((45, 55, fr.width + 45, fr.height + 55), radius=20, fill=(0, 0, 30, 210))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)), (x - 45, y - 45))
    canvas.alpha_composite(fr, (x - 2, y - 2)); return fr.size

def badge(x, y, text, fill, fg):
    f = ImageFont.truetype(MONO, 13); tw = d.textlength(text, font=f)
    d.rounded_rectangle((x, y, x + tw + 16, y + 24), radius=12, fill=fill); d.text((x + 8, y + 5), text, font=f, fill=fg)

# three real screenshots, stacked with offsets (RU terminal dark, ES terminal dark, PL token page dark)
ru = Image.open(SRC + "term_ru_dark.png").convert("RGB").crop((230, 225, 1130, 560))
es = Image.open(SRC + "term_es_dark.png").convert("RGB").crop((300, 290, 1440, 700))
pl = Image.open(SRC + "token_pl_dark.png").convert("RGB").crop((610, 60, 1500, 520))
cw = 620
s1 = card(ru, 640, 60, cw, (150, 200, 230)); badge(652, 70, "🌐 RU", (255, 255, 255), (20, 30, 60))
s2 = card(es, 700, 60 + s1[1] + 26, cw, (150, 200, 230)); badge(712, 60 + s1[1] + 36, "🌐 ES", (255, 255, 255), (20, 30, 60))
y3 = 60 + s1[1] + 26 + s2[1] + 26
s3 = card(pl, 760, y3, cw, (150, 200, 230)); badge(772, y3 + 10, "🌐 PL", (255, 255, 255), (20, 30, 60))
fh = 110
fade = Image.new("RGBA", (W, fh), (0, 0, 0, 0))
for i in range(fh): ImageDraw.Draw(fade).line((0, i, W, i), fill=(12, 70, 100, int(220 * (i / fh) ** 1.5)))
canvas.alpha_composite(fade, (0, H - fh))

# robot with flags (right)
robot = Image.open(SRC + "robot_flags_clean.png").convert("RGBA"); rw = 400
robot = robot.resize((rw, int(robot.height * rw / robot.width)), Image.LANCZOS)
canvas.alpha_composite(robot, (W - rw - 40, H - robot.height + 30))

# footer (bottom-left)
logo = Image.open(LOGO).convert("RGBA"); lh = 32; logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
canvas.alpha_composite(logo, (70, H - 70))
f_url = ImageFont.truetype(MONO, 22); f_tag = ImageFont.truetype(RR, 15)
d.text((70 + logo.width + 12, H - 70), "arctools.fun/trade?lang=pl", font=f_url, fill=INK)
d.text((70 + logo.width + 12, H - 42), "@arctoolsfun · try ?lang=zh · es · ru · pl", font=f_tag, fill=MUTED)
canvas.convert("RGB").save(OUT, quality=95); print(OUT, s1, s2, s3)
