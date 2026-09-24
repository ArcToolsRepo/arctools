"""86 — Your keys, your money: non-custodial stack (trading wallet, bridge keeper, cross-chain buy, ArcOne) with the app screen."""
from kit import *
from PIL import ImageDraw
bg = backdrop(1); bg = header(bg, 'NON-CUSTODIAL', 'We never hold your money.', ['Every ArcTools product is a contract you call yourself or a key that never leaves your device.', 'Here is exactly where your USDC is at every step.'])
bg, h = shot(bg, 'assets/83s-app.png', (960, 250, 570)); d = ImageDraw.Draw(bg); d.text((960, 250 + h + 8), 'arctools.fun/app — ArcOne 3.0 for Android, real screen', font=f(12, False), fill=DIM)
X = 70; y = 250
for t, s in [('Trading wallet', 'A key generated in your browser or phone, encrypted with your passcode. Export it any time. We cannot read it.'),
             ('Bridge', 'Circle CCTP: USDC is burned on the source chain and minted on Arc by a contract that takes 2 % and forwards the rest to you in the same call. A keeper finishes transfers if you close the tab.'),
             ('Buy from another chain', 'Relay bridges and calls our aggregator in one fill. If the swap fails, USDC is refunded on Arc to your address. Nobody in the middle.'),
             ('ArcLocker, Market, ArcPredict', 'Escrow and locks live in contracts with no admin withdrawal. Disputes are split by an arbiter; funds never move to us.'),
             ('Sniper and Buy bot', 'Telegram bots hold a key you can export at any time and show every fee on the card before you confirm.')]:
    d.text((X, y), t, font=f(18), fill=INK); y += 26
    for ln in wrap(s, 78): d.text((X, y), ln, font=f(14, False), fill=MUTED); y += 20
    y += 12
bg = footer(bg, 'arctools.fun', 'Contracts: ArcAggregator 0x43Cd…E74A · ArcLocker 0x0786…bb94 · ArcWork 0x74Df…5706 · all verified on arc-scan')
bg.convert('RGB').save('86-keys.png', quality=95); print('86 ok')
