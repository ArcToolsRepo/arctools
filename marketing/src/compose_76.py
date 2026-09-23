"""76 — x402 pay-per-call API on Arc: real /api-docs screenshot + a terminal transcript of the real E2E call."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 1000
NAVY = (10, 12, 16); COB = (46, 124, 255); GRN = (34, 197, 128); INK = (240, 244, 250); MUTED = (203, 212, 228); DIM = (140, 150, 170); AMB = (255, 176, 32)
F = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Bold.ttf'
R = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/Roboto-Regular.ttf'
M = '/home/user/fcf97205-5c29-4875-892f-2f389526e585/gridbot-video/assets/RobotoMono-Regular.ttf'
f = lambda s, p=F: ImageFont.truetype(p, s)

bg = Image.new('RGBA', (W, H), NAVY + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse((-300, 300, 600, 1200), fill=COB + (50,)); gd.ellipse((1100, -300, 1900, 500), fill=GRN + (40,))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(180))); d = ImageDraw.Draw(bg)

d.text((70, 56), 'ArcTools', font=f(30), fill=INK)
d.rounded_rectangle((210, 58, 330, 90), radius=8, fill=GRN); d.text((222, 63), 'x402 · LIVE', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'An API that bots pay for. Per call. In USDC.', font=f(50), fill=INK)
d.text((70, 168), 'No API key, no account, no invoice. HTTP 402, sign, 200. Every payment burns ARCT.', font=f(21, R), fill=MUTED)

# ── left: real transcript of the E2E call (values from the mainnet test) ──
X, Y, TW, TH = 70, 226, 740, 470
d.rounded_rectangle((X, Y, X + TW, Y + TH), radius=14, fill=(12, 15, 22), outline=(255, 255, 255, 40), width=1)
for i, c in enumerate(((255, 96, 92), (255, 189, 46), (39, 201, 63))): d.ellipse((X + 16 + i * 20, Y + 14, X + 28 + i * 20, Y + 26), fill=c)
d.text((X + 90, Y + 12), 'agent — bun scripts/x402_e2e.ts dev-audit 0x7c74…a7a9', font=f(12, M), fill=DIM)
lines = [
    ('$ GET arctools.fun/api/x402/dev-audit?token=0x7c74…a7a9', INK),
    ('< 402 Payment Required', AMB),
    ('  PAYMENT-REQUIRED: scheme=exact network=eip155:5042', MUTED),
    ('    asset=USDC 0x3600…0000  payTo=0xb35c…5c0d', MUTED),
    ('    maxAmountRequired=20000  (0.02 USDC)  timeout=60s', MUTED),
    ('', INK),
    ('  signing EIP-712 TransferWithAuthorization… ok (no gas on my side)', DIM),
    ('', INK),
    ('$ GET … -H "X-PAYMENT: <base64 signed authorization>"', INK),
    ('< 200 OK  in 1795 ms', GRN),
    ('  X-PAYMENT-RESPONSE: {success:true, payer:0x731e…c620, settlement:"queued"}', MUTED),
    ('  { "by_source": {…}, "x402": {"endpoint":"dev-audit","price_usdc":0.02} }', MUTED),
    ('', INK),
    ('$ GET … -H "X-PAYMENT: <same payment again>"', INK),
    ('< 200 OK  {replay:true}   — same answer, not charged twice', GRN),
    ('', INK),
    ('on-chain 6 s later: USDC 0x731e…c620 to 0xb35c…5c0d  20000  (relayer 0x9950…)', DIM),
]
for i, (t, c) in enumerate(lines): d.text((X + 18, Y + 44 + i * 24), t, font=f(13, M), fill=c)

# ── right: real screenshot of /api-docs, cropped to the content column ──
shot = Image.open('assets/76-apidocs.png').convert('RGB').crop((240, 80, 1920, 1025))
sw = 700; shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS)
frame = Image.new('RGBA', (sw + 2, shot.height + 2), (255, 255, 255, 40)); frame.paste(shot, (1, 1))
mask = Image.new('L', frame.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw + 1, shot.height + 1), radius=12, fill=255)
bg.paste(frame, (830, Y), mask); d = ImageDraw.Draw(bg)
d.text((830, Y + shot.height + 10), 'arctools.fun/api-docs — real screen', font=f(12, R), fill=DIM)

# ── bottom: prices + facts ──
y = Y + TH + 30
cards = [('0.005 USDC', 'token-stats', 'price, changes, volume, traders, mcap'), ('0.02 USDC', 'dev-audit', 'deployer history, clusters, bundles, clone farms'),
         ('0.03 USDC', 'sell-sim', 'real buy→sell round trip, honeypot verdict'), ('0.04 USDC', 'token-report', 'all three in one call')]
cw = (W - 140 - 3 * 14) // 4
for i, (p, n, s) in enumerate(cards):
    x = 70 + i * (cw + 14)
    d.rounded_rectangle((x, y, x + cw, y + 96), radius=12, fill=(18, 22, 30), outline=(255, 255, 255, 28), width=1)
    d.text((x + 16, y + 12), p, font=f(22), fill=GRN); d.text((x + 16, y + 42), n, font=f(15, M), fill=INK); d.text((x + 16, y + 66), s.replace('→', '-'), font=f(12, R), fill=MUTED)
y += 96 + 16
d.text((70, y), 'Works because Arc\'s USDC is Circle\'s FiatTokenV2: EIP-3009 signatures settle on-chain with no custody and no allowance. Coinbase x402 clients work with network eip155:5042. Free endpoints stay free for humans.', font=f(13, R), fill=DIM)

d.rounded_rectangle((70, H - 84, 400, H - 34), radius=10, fill=COB); d.text((92, H - 72), 'arctools.fun/api-docs', font=f(24), fill=INK)
d.text((422, H - 68), 'Reference client: 40 lines, @noble only — ArcToolsRepo/arctools · scripts/x402_e2e.ts', font=f(14, R), fill=MUTED)
bg.convert('RGB').save('76-x402.png', quality=95); print('76 ok; cards end y', y)
