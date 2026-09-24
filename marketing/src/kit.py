"""Shared drawing kit for the 83-87 series (same palette / fonts / card style as the earlier posters)."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 1600, 1000
NAVY = (10, 12, 16); GRN = (34, 197, 128); COB = (46, 124, 255); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (150, 160, 180)
FD = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets'
def f(s, bold=True): return ImageFont.truetype(f"{FD}/Roboto-Bold.ttf" if bold else f"{FD}/Roboto-Regular.ttf", s)

def backdrop(seed=0):
    bg = Image.new('RGBA', (W, H), NAVY + (255,)); glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    if seed % 2 == 0: gd.ellipse((-300, 200, 600, 1100), fill=GRN + (56,)); gd.ellipse((1100, -300, 1900, 500), fill=COB + (46,))
    else: gd.ellipse((1100, 500, 1900, 1400), fill=GRN + (50,)); gd.ellipse((-300, -400, 700, 500), fill=COB + (60,))
    bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(180)))
    d = ImageDraw.Draw(bg)
    for x in range(0, W, 96): d.line((x, 0, x, H), fill=(255, 255, 255, 6))
    for y in range(0, H, 96): d.line((0, y, W, y), fill=(255, 255, 255, 6))
    return bg

def robot_bg(path, dark_left=0.62, strength=215):
    """Robot render as full-bleed background, left part darkened for text."""
    bg = Image.open(path).convert('RGB'); bg = bg.resize((W, int(bg.height * W / bg.width)), Image.LANCZOS)
    bg = bg.crop((0, (bg.height - H) // 2, W, (bg.height - H) // 2 + H)).convert('RGBA')
    grad = Image.new('L', (W, 1), 0); gp = grad.load()
    for x in range(W): gp[x, 0] = int(strength * max(0.0, min(1.0, (dark_left + 0.08 - x / W) / 0.30)))
    dark = Image.new('RGBA', (W, H), (6, 9, 14, 255)); dark.putalpha(grad.resize((W, H)))
    return Image.alpha_composite(bg, dark)

def header(bg, badge, title, sub_lines, y_title=104):
    d = ImageDraw.Draw(bg)
    d.text((70, 52), 'ArcTools', font=f(30), fill=INK)
    bw = d.textlength(badge, font=f(19)) + 24
    d.rounded_rectangle((210, 54, 210 + bw, 86), radius=8, fill=GRN); d.text((222, 59), badge, font=f(19), fill=(4, 20, 10))
    d.text((70, y_title), title, font=f(54), fill=INK)
    for i, s in enumerate(sub_lines): d.text((70, y_title + 68 + i * 26), s, font=f(19, False), fill=MUTED)
    return bg

def card(bg, box, radius=8, fill=(14, 18, 26, 235)):
    ov = Image.new('RGBA', bg.size, (0, 0, 0, 0)); ImageDraw.Draw(ov).rounded_rectangle(box, radius=radius, fill=fill, outline=(255, 255, 255, 30), width=1)
    return Image.alpha_composite(bg, ov)

def shot(bg, path, box, radius=12):
    """Place a screenshot scaled to width, with drop shadow, rounded corners. box=(x, y, width)."""
    x, y, w = box; im = Image.open(path).convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=radius, fill=255)
    sh = Image.new('RGBA', bg.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((x - 10, y + 16, x + w + 10, y + im.height + 30), radius=radius + 6, fill=(0, 0, 0, 180))
    bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(36))); bg.paste(im, (x, y), mask); return bg, im.height

def footer(bg, cta, note):
    d = ImageDraw.Draw(bg); cw = d.textlength(cta, font=f(24)) + 44
    d.rounded_rectangle((70, H - 84, 70 + cw, H - 34), radius=10, fill=GRN); d.text((92, H - 72), cta, font=f(24), fill=(4, 20, 10))
    d.text((70 + cw + 22, H - 68), note, font=f(12, False), fill=MUTED); return bg

def stat_rows(bg, x, y, rows, w=470, h=50, gap=8, vcol=None):
    d = ImageDraw.Draw(bg)
    for k, v in rows:
        d.rounded_rectangle((x, y, x + w, y + h), radius=8, fill=(14, 18, 26), outline=(255, 255, 255, 30), width=1)
        d.text((x + 14, y + 15), k, font=f(14, False), fill=DIM); d.text((x + w - 14 - d.textlength(v, font=f(18)), y + 13), v, font=f(18), fill=vcol or INK); y += h + gap
    return y

def wrap(text, n):
    out, line = [], ''
    for w_ in text.split():
        if len(line) + len(w_) + 1 > n and line: out.append(line); line = w_
        else: line = (line + ' ' + w_).strip()
    if line: out.append(line)
    return out
