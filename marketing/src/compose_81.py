"""81 — ARCT on CoinMarketCap (DEXScan, tracked; verified listing under review). Real CMC screenshot, real CMC logo, real numbers read off the page."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 1600, 1000
NAVY = (10, 12, 16); GRN = (34, 197, 128); COB = (46, 124, 255); CMCBLUE = (56, 97, 251); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (140, 150, 170)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'; R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)
bg = Image.new('RGBA', (W, H), NAVY + (255,)); glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-300, -200, 700, 700), fill=CMCBLUE + (70,)); gd.ellipse((1100, 500, 1900, 1300), fill=GRN + (50,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(180))); d = ImageDraw.Draw(bg)
# logos row: ArcTools mark + "x" + CMC wordmark (real asset)
arct = Image.open('../arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/public/assets/brand/arct-200.png').convert('RGBA').resize((72, 72), Image.LANCZOS); bg.paste(arct, (70, 48), arct)
d = ImageDraw.Draw(bg); d.text((156, 62), 'ArcTools', font=f(36), fill=INK); d.text((330, 62), '×', font=f(36), fill=DIM)
cmc = Image.open('assets/cmc_logo.png').convert('RGBA'); ch = 40; cmc = cmc.resize((int(cmc.width * ch / cmc.height), ch), Image.LANCZOS)
d.rounded_rectangle((376, 52, 376 + cmc.width + 32, 52 + ch + 24), radius=14, fill=(255, 255, 255)); bg.paste(cmc, (392, 64), cmc); d = ImageDraw.Draw(bg)
d.text((70, 150), 'ARCT is on CoinMarketCap.', font=f(56), fill=INK)
d.text((70, 222), 'Tracked live on CoinMarketCap DEXScan: price, chart, liquidity, holders and every trade on Arc. Verified listing (name, logo, links, supply) submitted and under CMC review.', font=f(19, R), fill=MUTED)
# screenshot: crop the chart + header area
shot = Image.open('assets/81-cmc-dex.png').convert('RGB').crop((250, 130, 1500, 900)); sw = 940; shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS)
mask = Image.new('L', shot.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), radius=12, fill=255)
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((60, 290, 60 + sw + 20, 290 + shot.height + 30), radius=18, fill=(0, 0, 0, 180)); bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(40)))
bg.paste(shot, (70, 274), mask); d = ImageDraw.Draw(bg); d.text((70, 274 + shot.height + 8), 'dex.coinmarketcap.com/token/arc/0x1ea1…de52 — real screen, 23 Sep 2026', font=f(12, R), fill=DIM)
X = 70 + sw + 40; y = 274
d.text((X, y), 'ON THE PAGE TODAY', font=f(13), fill=GRN); y += 30
stats = [('Price', '$0.0009037'), ('24h', '+73.8 %'), ('FDV', '$870.2K'), ('Liquidity', '$131.9K'), ('24h volume', '$158.7K'), ('Holders', '2,070'), ('Pool', 'ARCT / USDC · Uniswap V3 (Arc)')]
for k, v in stats:
    d.rounded_rectangle((X, y, W - 70, y + 50), radius=8, fill=(18, 22, 30), outline=(255, 255, 255, 28), width=1)
    d.text((X + 14, y + 15), k, font=f(14, R), fill=DIM); d.text((W - 70 - 14 - d.textlength(v, font=f(17)), y + 14), v, font=f(17), fill=INK if k != '24h' else GRN); y += 58
y += 6
d.text((X, y), 'WHAT ARCT IS', font=f(13), fill=GRN); y += 28
lines = ['Platform token of ArcTools, the trading and', 'launch stack on Arc. Every fee across the stack', 'buys back and burns ARCT: 59.1M burned so far,', 'counter public at arctools.fun/rewards.']
for ln in lines: d.text((X, y), ln, font=f(15, R), fill=MUTED); y += 21
d.rounded_rectangle((70, H - 84, 470, H - 34), radius=10, fill=GRN); d.text((92, H - 72), 'arctools.fun/token/ARCT', font=f(24), fill=(4, 20, 10))
d.text((492, H - 68), 'CA 0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52 · Arc (chain 5042) · logo and links on CMC come from third parties until verification completes', font=f(12, R), fill=MUTED)
bg.convert('RGB').save('81-cmc.png', quality=95); print('81 ok', y)
