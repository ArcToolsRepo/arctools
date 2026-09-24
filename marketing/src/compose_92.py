"""92 — Archy Agent: robot answering + what you can ask (KB-backed)."""
from kit import *
from PIL import ImageDraw
bg = robot_bg('assets/92-robot-archy.png', dark_left=0.60, strength=205); d = ImageDraw.Draw(bg)
d.text((70, 52), 'ArcTools', font=f(30), fill=INK); d.rounded_rectangle((210, 54, 400, 86), radius=8, fill=GRN); d.text((222, 59), 'ARCHY AGENT', font=f(19), fill=(4, 20, 10))
d.text((70, 104), 'Ask Archy. It knows every fee.', font=f(54), fill=INK)
for i, s in enumerate(['Archy is the assistant in the corner of every ArcTools page. It answers from a knowledge base we maintain', 'by hand, so it says exactly what the contracts do, in your language, and links you to the right screen.']):
    d.text((70, 172 + i * 26), s, font=f(19, False), fill=MUTED)
y = 250; d.text((70, y), 'THINGS PEOPLE ASK', font=f(13), fill=GRN); y += 28
for q, a in [('How do I buy with ETH from Base?', 'Chain-link button next to Quick Buy, one signature, token on Arc in seconds.'), ('What does the bridge cost?', '2 %, taken by the contract on Arc in the same call that mints your USDC.'), ('Where are my referral earnings?', '/referrals, claim any time; 25 % of every fee your invitees pay.'), ('Is ArcLocker safe?', 'Contract with no admin key over your assets, public proof page per lock.'), ('Why did my Predict bet refund?', 'One-sided round, tie, or late operator: full refund by design.')]:
    bg = card(bg, (70, y, 880, y + 58)); d = ImageDraw.Draw(bg)
    d.text((86, y + 9), q, font=f(15), fill=INK); d.text((86, y + 32), a, font=f(13, False), fill=MUTED); y += 66
bg = footer(bg, 'arctools.fun', 'Five languages · answers cite the page they come from · never holds keys, never sends transactions')
bg.convert('RGB').save('92-archy.png', quality=95); print('92 ok')
