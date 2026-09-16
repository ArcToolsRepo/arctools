from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/src/"
LOGO = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/logo-mark.png"
OUT = "/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/marketing/28-languages-themes.png"
RB = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf"
RR = "/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
W, H = 1600, 900
GREEN = (34, 197, 94); CYAN = (78, 205, 255); INK = (245, 247, 250); MUTED = (150, 165, 185)

canvas = Image.new("RGBA", (W, H), (6, 9, 16, 255))
d = ImageDraw.Draw(canvas)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-250, 200, 700, 1150), fill=(40, 90, 200, 60)); gd.ellipse((900, -250, 1800, 450), fill=(*GREEN, 34))
canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(160)))
for x in range(0, W, 40): d.line((x, 0, x, H), fill=(255, 255, 255, 5))
for y in range(0, H, 40): d.line((0, y, W, y), fill=(255, 255, 255, 5))

# header
d.text((70, 52), "ARCTOOLS · UPDATE", font=ImageFont.truetype(MONO, 18), fill=MUTED)
f_h = ImageFont.truetype(RB, 50)
d.text((70, 82), "5 LANGUAGES.", font=f_h, fill=INK)
d.text((70, 140), "LIGHT OR DARK.", font=f_h, fill=CYAN)
f_b = ImageFont.truetype(RB, 20); f_bs = ImageFont.truetype(RR, 16)
for i, (t, sub) in enumerate([
    ("English · Chinese · Español · Русский · Polski", "the whole Terminal and every token page, not just menus"),
    ("Light and dark theme", "one click, remembered per browser, no flash on load"),
    ("Project names and tickers stay as they are", "everything else follows your language"),
]):
    y = 214 + i * 58
    d.rectangle((70, y + 6, 80, y + 16), fill=GREEN if i != 1 else CYAN)
    d.text((92, y - 2), t, font=f_b, fill=INK); d.text((92, y + 24), sub, font=f_bs, fill=MUTED)

def card(img, x, y, w, border):
    im = img.convert("RGBA"); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    sh = Image.new("RGBA", (im.width + 90, im.height + 90), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((45, 55, im.width + 45, im.height + 55), radius=20, fill=(0, 0, 0, 190))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)), (x - 45, y - 45))
    fr = Image.new("RGBA", (im.width + 4, im.height + 4), (0, 0, 0, 0))
    ImageDraw.Draw(fr).rounded_rectangle((0, 0, fr.width - 1, fr.height - 1), radius=16, fill=(*border, 255))
    canvas.alpha_composite(fr, (x - 2, y - 2))
    mask = Image.new("L", im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=14, fill=255)
    canvas.paste(im, (x, y), mask); return im.size

def badge(x, y, text, fill, fg=(6, 20, 10)):
    f = ImageFont.truetype(MONO, 14); tw = d.textlength(text, font=f)
    d.rounded_rectangle((x, y, x + tw + 18, y + 26), radius=13, fill=fill); d.text((x + 9, y + 6), text, font=f, fill=fg)

# panel 1: Terminal, Russian, dark (chips → rows)
ru = Image.open(SRC + "term_ru_dark.png").convert("RGB").crop((230, 225, 1130, 690))
p1 = card(ru, 560, 56, 760, (70, 85, 110))
badge(560 + 12, 56 + 12, "🌐 RU · тёмная тема", (20, 24, 32), INK)
# panel 2: token page, Spanish, light (header + chart + swap)
es = Image.open(SRC + "token_es_light.png").convert("RGB").crop((610, 70, 1510, 640))
p2 = card(es, 640, 56 + p1[1] + 40, 760, (150, 165, 190))
badge(640 + 12, 56 + p1[1] + 40 + 12, "🌐 ES · tema claro", (255, 255, 255), (15, 21, 34))
# fade bottom of panel 2
fh = 100
fade = Image.new("RGBA", (p2[0], fh), (0, 0, 0, 0))
for i in range(fh): ImageDraw.Draw(fade).line((0, i, p2[0], i), fill=(6, 9, 16, int(255 * (i / fh) ** 1.5)))
canvas.alpha_composite(fade, (640, H - fh))

# robot (left-bottom): globe + light switch
robot = Image.open(SRC + "robot_i18n.png").convert("RGBA"); rw = 430
robot = robot.resize((rw, int(robot.height * rw / robot.width)), Image.LANCZOS)
canvas.alpha_composite(robot, (150, H - robot.height + 40))

# footer top-right
f_url = ImageFont.truetype(MONO, 20); foot = "arctools.fun  ·  @arctoolsfun"
d.text((W - 70 - d.textlength(foot, font=f_url), 22), foot, font=f_url, fill=INK)
logo = Image.open(LOGO).convert("RGBA"); lh = 30; logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
canvas.alpha_composite(logo, (int(W - 70 - d.textlength(foot, font=f_url) - logo.width - 12), 18))
canvas.convert("RGB").save(OUT, quality=95); print(OUT, p1, p2)
