# Incydent bridge 16.09.2026

Przyczyna: ArcBridgeFeeProxy v1 (0xA42c4BEee84CEd9f2ea15b3981B8A321943b7Bec) miał zaszyty adres MessageTransmitterV2
0xE737e5cE… (kanoniczny Circle na innych chainach). Na Arc pod tym adresem nie ma kodu; Arc używa 0x81D40F21…
Skutek: bridgeReceive(v1) nigdy nie mogło zadziałać. Do 16.09 ~10:35Z burny miały destinationCaller=0, więc mint robił
relayer Circle prosto do proxy, a fee/wypłata szły ręcznie (rescue) lub sweeperem. Po 10:35Z destinationCaller=proxy →
nikt nie może zmintować.

Naprawa: ArcBridgeFeeProxyV2 0x292DDAeD9B959Cbe4df5ac35c52da1977E29916e (transmitter 0x81D40F21…, fee 2% → treasury),
symulacja pełnego przepływu OK (state override), strona przepięta (build 76732b2a). Sweeper pilnuje v1 i v2.

Odzyskane (destinationCaller=0, zmintowane ręcznie + rescue 98/2): 2 + 1 + 1 + 9 USDC → nadawcy 0xa0d4…, 0xe107…, 0xe107…, 0x7454….

NIE do odzyskania przez CCTP (destinationCaller = v1, v1 nie potrafi wywołać właściwego transmittera):
- 0xf70aa3b3… 500.00 USDC → 0xebb7841e4a02a2b240e75a948eb8451ee47fb145
- 0x169b94a3… 100.00 USDC → 0xafb28903e2…
- 0x29605b1a…   1.00 USDC → 0x6885f3fa33…
- 0xb641dd14…, 0xf907e2d4…, 0x6612a12b…, 0x80e65c2e…, 0x1e0ff28a…, 0xb8db631a… łącznie 1.05 USDC → 0xa0d41e2dc0…
Razem 602.05 USDC. Rekomendacja: zwrot z treasury 1:1 (błąd po naszej stronie).
