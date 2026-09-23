"""77 — New launchpad: wonk.fun in the Terminal. Real wonk logo (downloaded), real Terminal screenshot filtered to wonk.fun."""
import json, urllib.request
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); WONK = (44, 150, 235); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (140, 150, 170)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

# live counts
try:
    rows = json.loads(urllib.request.urlopen(urllib.request.Request('https://arctools.fun/api/padcounts', headers={'User-Agent': 'arctools'}), timeout=30).read())['rows']
    n_wonk = next((r['n'] for r in rows if r['pad'] == 'wonk.fun'), 45); n_pads = len(rows) + 1   # +1: ArcToolsPad's own list counts separately in the rail
except Exception:
    n_wonk, n_pads = 45, 25

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-250, -250, 650, 650), fill=WONK + (70,)); gd.ellipse((1050, 500, 1900, 1300), fill=COB + (40,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(180))); d = ImageDraw.Draw(bg)

# wonk logo: strip its dark square background → keep the blue W
logo = Image.open('assets/wonk-logo.png').convert('RGBA'); px = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r_, g_, b_, a_ = px[x, y]
        if r_ < 60 and g_ < 60 and b_ < 70: px[x, y] = (0, 0, 0, 0)
logo = logo.resize((150, 150), Image.LANCZOS)
bg.alpha_composite(logo, (70, 52)); d = ImageDraw.Draw(bg)

d.text((240, 56), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((380, 58, 580, 90), radius=8, fill=GRN); d.text((392, 63), 'NEW LAUNCHPAD', font=f(19), fill=(4, 20, 10))
d.text((240, 104), 'wonk.fun is in the Terminal.', font=f(54), fill=INK)
d.text((240, 172), f'Launchpad #{n_pads} indexed. {n_wonk} tokens, every logo, one-click buys, sniper support — from the first block.', font=f(21, R), fill=MUTED)

# screenshot: content column, cropped to chips + table
shot = Image.open('assets/77-wonk-terminal.png').convert('RGB').crop((240, 330, 1920, 830))
sw = 1460; shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS)
frame = Image.new('RGBA', (sw + 2, shot.height + 2), (255, 255, 255, 40)); frame.paste(shot, (1, 1))
mask = Image.new('L', frame.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw + 1, shot.height + 1), radius=12, fill=255)
sy = 236; bg.paste(frame, (70, sy), mask); d = ImageDraw.Draw(bg)
d.text((70, sy + shot.height + 10), 'arctools.fun/trade2?pad=wonk.fun — real screen', font=f(12, R), fill=DIM)

y = sy + shot.height + 44
cards = [('Uniswap v4 hook', 'Bonding curve on the "cook" hook, graduates to a live V4 pool. Our router already trades both stages.'),
         ('Every token, every logo', f'{n_wonk} launches indexed with logos, age, dev audit and sell simulation the moment they appear.'),
         ('Sniper ready', 'Auto-snipe rules in @ArcSniper_bot fire on wonk.fun launches like on the other 24 launchpads.'),
         ('Same fees, same burn', 'Buys through ArcTools pay the usual fee; the fee buys and burns ARCT.')]
cw = (W - 140 - 3 * 14) // 4
for i, (t, s) in enumerate(cards):
    x = 70 + i * (cw + 14)
    d.rounded_rectangle((x, y, x + cw, y + 118), radius=12, fill=(18, 22, 30), outline=(255, 255, 255, 28), width=1)
    d.text((x + 16, y + 12), t, font=f(17), fill=INK)
    words = s.split(); line = ''; lines = []
    for w_ in words:
        if len(line) + len(w_) > 40: lines.append(line); line = w_
        else: line = (line + ' ' + w_).strip()
    lines.append(line)
    for j, ln in enumerate(lines[:4]): d.text((x + 16, y + 40 + j * 18), ln, font=f(13, R), fill=MUTED)

d.rounded_rectangle((70, H - 84, 470, H - 34), radius=10, fill=WONK); d.text((92, H - 72), 'arctools.fun/trade?pad=wonk.fun', font=f(22), fill=INK)
d.text((492, H - 68), 'wonk.fun · X @wonk_fun · TG wonkdotfun · factory 0x34f3…7952 · hook 0x21bd…3044', font=f(14, R), fill=MUTED)
bg.convert('RGB').save('77-wonk.png', quality=95); print('77 ok', n_wonk, n_pads, 'cards y', y)
