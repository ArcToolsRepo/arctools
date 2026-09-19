import sys; sys.path.insert(0, '.')
from buybot.simulate import SPEND, classify
U = SPEND
cases = [
    # (stage, returned, quoted, expected, why)
    (0, 0, 0,            "trap",     "buy itself reverts"),
    (1, 0, 0,            "trap",     "buy delivers zero tokens"),
    (2, 0, U // 2,       "trap",     "sell reverts although the router priced it"),
    (3, 0, U // 2,       "trap",     "sell pays nothing although the router priced it"),
    (2, 0, 0,            "no_route", "sell fails and was never quoted: our gap, not a trap"),
    (4, U // 100, U // 100, "thin",  "illiquid but honest: pays exactly what it quoted"),
    (4, U // 100, U,     "trap",     "hidden tax: quoted 1 USDC back, paid 0.01"),
    (4, int(U * 0.97), int(U * 0.97), "ok", "normal round trip"),
    (4, int(U * 0.60), int(U * 0.61), "thin", "expensive but as quoted"),
    (4, int(U * 0.90), int(U * 0.95), "ok", "slightly under quote, still honest"),
]
bad = 0
for stage, ret, quoted, exp, why in cases:
    got = classify(stage, ret, quoted)["verdict"]
    ok = got == exp
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  stage={stage} back={ret/U:.4f} quoted={quoted/U:.4f} -> {got:<9} (want {exp})  {why}")
print(f"\n{len(cases) - bad}/{len(cases)} passed")
sys.exit(1 if bad else 0)
