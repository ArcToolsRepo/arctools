import { useEffect, useState } from "react";
import { getWatch, loadRisk, loadTrending, useStore } from "../lib/store";
import * as HW from "../lib/arc-hotwallet";
import { go } from "../lib/router";
import { Header, TokenRow } from "../components/ui";
import { BuySheet } from "../components/BuySheet";

export default function Watch() {
  const set = useStore(getWatch); const list = [...set];
  const [buyFor, setBuyFor] = useState<string | null>(null);
  useEffect(() => { void loadTrending(); void loadRisk(list); }, [list.length]);
  return (
    <>
      <Header title="Watchlist" />
      {list.length === 0 ? <div className="empty">Tap ★ on any token to keep it here. Alerts for watched tokens live in More → Alerts.</div>
        : list.map((ca) => <TokenRow key={ca} ca={ca} onBuy={(c) => HW.hasWallet() ? setBuyFor(c) : go("/wallet")} />)}
      <BuySheet ca={buyFor} onClose={() => setBuyFor(null)} />
    </>
  );
}
