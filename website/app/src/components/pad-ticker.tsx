import { useEffect, useState } from "react";

import { padTicker } from "@/lib/arcpad";

type TickerData = Awaited<ReturnType<typeof padTicker>>;

/** Site-wide marquee under the nav: live ArcPad buys + top trending tokens. */
export function PadTicker() {
  const [data, setData] = useState<TickerData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await padTicker();
        if (alive) setData(d);
      } catch { /* next tick */ }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!data || (data.buys.length === 0 && data.trending.length === 0)) return null;

  const items: { key: string; node: React.ReactNode }[] = [];
  data.trending.forEach((t) => {
    const medal = t.rank === 1 ? "🥇" : t.rank === 2 ? "🥈" : "🥉";
    items.push({
      key: `tr-${t.token}`,
      node: (
        <a className="arc-ticker__item" href={`/pad/${t.token}`}>
          {medal} <b>{t.symbol}</b>&nbsp;
          <span style={{ color: "var(--arc-muted)" }}>
            ${t.mcap >= 1000 ? `${(t.mcap / 1000).toFixed(1)}K` : t.mcap.toFixed(0)} MC
          </span>
        </a>
      ),
    });
  });
  data.buys.forEach((b, i) => {
    items.push({
      key: `b-${i}`,
      node: (
        <a className="arc-ticker__item" href={`/pad/${b.token}`}>
          <span style={{ color: "var(--arc-up)" }}>▲</span> ${b.usdc.toFixed(2)} <b>{b.symbol}</b>
        </a>
      ),
    });
  });

  return (
    <div aria-hidden className="arc-ticker">
      <div className="arc-ticker__track">
        {[0, 1].map((rep) => (
          <span className="arc-ticker__group" key={rep}>
            {items.map((it) => (
              <span key={`${rep}-${it.key}`}>{it.node}</span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
