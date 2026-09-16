"""37 — Archy Agent launch: avatar left, real chat screenshot right, Arc background."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 1600, 900
NAVY = (14, 17, 24); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (236, 240, 247); MUTED = (176, 186, 204); CARD = (20, 26, 38)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
art = Image.open('bg_arc.png').convert('RGB').transpose(Image.FLIP_LEFT_RIGHT)
sc = max(W / art.width, H / art.height); art = art.resize((int(art.width * sc) + 1, int(art.height * sc) + 1), Image.LANCZOS)
art = art.crop(((art.width - W) // 2, (art.height - H) // 2, (art.width - W) // 2 + W, (art.height - H) // 2 + H))
bg = Image.blend(Image.new('RGB', (W, H), NAVY), art, 0.75).convert('RGBA')
scrim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim); sd.rectangle((760, 0, W, H), fill=(8, 10, 16, 120)); sd.rectangle((0, 0, W, 250), fill=(8, 10, 16, 90))
bg = Image.alpha_composite(bg, scrim.filter(ImageFilter.GaussianBlur(40))); d = ImageDraw.Draw(bg)
# header
d.text((56, 44), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((208, 46, 288, 78), radius=8, fill=COB); d.text((222, 50), 'NEW', font=f(20), fill=INK)
d.text((56, 108), 'MEET YOUR ARC ASSISTANT', font=f(22), fill=GRN)
d.text((56, 138), 'Archy Agent', font=f(72), fill=INK)
d.text((56, 232), 'Ask how to do anything on ArcTools, or where it is', font=f(24), fill=INK)
d.text((56, 266), 'answers from our docs + live chain data · EN PL ES RU ZH · only ArcTools & Arc', font=f(19, R), fill=MUTED)
# avatar with glow
av = Image.open('../archy-avatar.png').convert('RGBA'); size = 420; av = av.resize((size, size), Image.LANCZOS)
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow); ax, ay = 150, 380; gd.ellipse((ax - 40, ay - 40, ax + size + 40, ay + size + 40), fill=(46, 124, 255, 110))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(60))); bg.alpha_composite(av, (ax, ay)); d = ImageDraw.Draw(bg)
# chat card
shot = Image.open('archy_drawer.png').convert('RGBA'); sh = 560; shot = shot.resize((int(shot.width * sh / shot.height), sh), Image.LANCZOS)
cx = W - 56 - shot.width - 16; cy = 300
d.rounded_rectangle((cx, cy, cx + shot.width + 16, cy + sh + 16), radius=16, fill=CARD + (255,), outline=COB + (210,), width=2)
bg.alpha_composite(shot, (cx + 8, cy + 8)); d = ImageDraw.Draw(bg)
d.text((cx, cy - 26), 'live conversation  -  arctools.fun  >  Archy Agent', font=f(15, R), fill=MUTED)
# bullets left of card
bx, by = 640, 330
for i, (h, s) in enumerate([('Knows the product', 'every page, bot, fee and setting - from docs we maintain'), ('Checks live data', 'token stats, Token Score, chain and system status'), ('Stays in scope', 'only ArcTools & Arc - no price calls, no financial advice')]):
    y = by + i * 96; d.ellipse((bx, y + 6, bx + 12, y + 18), fill=GRN); d.text((bx + 24, y), h, font=f(22), fill=INK); d.text((bx + 24, y + 32), s, font=f(16, R), fill=MUTED)
# footer
d.text((56, H - 44), 'Claude Haiku 4.5  ·  20 questions / hour  ·  answers can be wrong, verify on-chain', font=f(16, M), fill=MUTED)
tw = d.textlength('arctools.fun', font=f(22)); d.text((W - 56 - tw, H - 48), 'arctools.fun', font=f(22), fill=COB)
bg.convert('RGB').save('../37-archy-agent.png', quality=95); print('saved', cx, shot.width)
