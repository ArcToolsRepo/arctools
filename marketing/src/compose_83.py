"""83 — gARC Everyone. Robot at sunrise; we build, capital flows into Arc (live numbers from the Terminal / bridge index)."""
from kit import *
from PIL import ImageDraw
bg = robot_bg('assets/83-robot-gm.png', dark_left=0.55, strength=200); d = ImageDraw.Draw(bg)
d.text((70, 52), 'ArcTools', font=f(30), fill=INK)
d.text((70, 250), 'gARC', font=f(150), fill=INK); d.text((70, 400), 'Everyone.', font=f(96), fill=GRN)
for i, s in enumerate(['Eight days since Arc mainnet. We ship every day, and the chain fills up:', 'volume, wallets and USDC keep coming in. This is what today looks like.']):
    d.text((70, 530 + i * 27), s, font=f(19, False), fill=MUTED)
y = 610
bg = card(bg, (70, y, 800, y + 220)); d = ImageDraw.Draw(bg)
stats = [('24h volume on Arc', '$43.7M'), ('24h transactions', '241,801'), ('USDC bridged in, last 24h', '$5.10M · 1,532 wallets'), ('Tokens launched, 25 launchpads', '13,834')]
for i, (k, v) in enumerate(stats):
    cx = 90 + (i % 2) * 360; cy = y + 18 + (i // 2) * 100
    d.text((cx, cy), k.upper(), font=f(12), fill=GRN); d.text((cx, cy + 22), v, font=f(34), fill=INK)
d.text((70, y + 232), 'ArcTools Terminal and bridge index, 24 Sep 2026. Volume and txns are whole-chain DEX figures; bridge inflow counts CCTP mints to Arc.', font=f(12, False), fill=DIM)
bg = footer(bg, 'arctools.fun', 'Terminal · Sniper · Buy bot · ArcToolsPad · ArcLocker · ArcPredict · Market · Bridge · x402 API · ArcOne')
bg.convert('RGB').save('83-garc.png', quality=95); print('83 ok')
