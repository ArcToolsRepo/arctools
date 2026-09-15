# 36 — Archy Agent launch

Attach: `archy-avatar.png` (X: square avatar works as a single image; LinkedIn: same image, or the drawer screenshot if we take one later).
Rules kept: no emoji on X, no unverified claims, link in first reply, everything below is live today.

---

## X — main post (fits the free limit)

Meet Archy, the ArcTools agent.

Ask it how to do anything on ArcTools or where to find it: trading wallet, limit orders, Token Score, Bubble map, the buy bot, staking. It answers from our own docs plus live data (token stats, chain status), in English, Polish, Spanish, Russian or Chinese.

Only ArcTools and Arc. No price calls, no financial advice.

---

## X — reply 1 (link)

Open any page on arctools.fun, bottom of the left menu: Archy Agent. On mobile it is the round button bottom-left.

---

## X — reply 2 (how it works)

Under the hood: Claude Haiku 4.5, a hand-written knowledge base we update with every release, and four read-only tools it can call (token stats, token search, chain status, system status). It can be wrong, so verify on-chain. Humans are still in @arctoolsportal.

---

## X — reply 3 (example)

Ask it "is Arc down right now?" and it checks the chain before answering. Ask "where is the bubble map?" and you get the exact path: /token/<address>, tab Bubble map. Twenty questions per hour per person.

---

## X — long version (Premium, single post)

Meet Archy, the ArcTools agent.

There is a lot on arctools.fun now: the Terminal across every Arc launchpad, a pro chart, Token Score, the Alpha screener, Bubble maps, non-custodial limit and TP/SL orders, the sniper and buy bots, staking, referrals. New users kept asking the same two questions in the portal: how do I do X, and where is it. Archy answers both.

It lives at the bottom of the left menu on every page (round button bottom-left on mobile). Ask in English, Polish, Spanish, Russian or Chinese and you get a short answer with the exact place on the site, for example "/token/<address>, tab Bubble map" or "/trade, Alpha tab".

What it knows: our own documentation, written by us and updated with every release. What it can look up live: token stats and Token Score for any address, token search, whether the Arc chain or the public RPCs are down, and our own system status. What it refuses: anything that is not ArcTools or Arc, price predictions, and financial advice.

Model: Claude Haiku 4.5. Limit: 20 questions per hour per person. It can be wrong, so verify on-chain, and the humans are still in @arctoolsportal.

arctools.fun

---

## LinkedIn (longer, professional tone, emojis avoided)

Introducing Archy Agent, the AI assistant for ArcTools and the Arc chain.

ArcTools has grown into a full trading toolkit for Arc, Circle's USDC-native Layer 1: a screener across every launchpad, a professional chart, an on-chain Token Score, a smart-money screener, holder bubble maps, non-custodial limit and take-profit orders, Telegram trading and alert bots, staking and referrals. With that breadth came a predictable support pattern. Most questions in our community were not about markets. They were "how do I do this" and "where do I find it".

Archy answers those questions inside the product. It sits at the bottom of the navigation on every page and responds in English, Polish, Spanish, Russian or Chinese with a short answer and the exact location on the site.

How we built it, in brief:
- Retrieval over a hand-written knowledge base. Every article is maintained by the team and updated with each release, so the assistant reflects the product as it is today rather than a model's memory of it.
- Four read-only tools the agent can call: token statistics and Token Score for any contract, token search, Arc chain and RPC status, and our own system health. When a user asks whether Arc is down, Archy checks before it answers.
- A strict scope. Archy answers only about ArcTools and Arc, gives no price predictions and no financial advice, and says when something is not in its materials.
- Claude Haiku 4.5 as the language model, chosen for cost, latency and multilingual quality. Per-user rate limits keep usage predictable.

What it is not: a trading signal or an oracle. It can be wrong, and every answer carries a reminder to verify on-chain. Our community channel remains the place for anything Archy cannot resolve.

We are sharing this because the pattern is reusable for any product with a growing surface area: keep the knowledge base in the repository next to the code, give the model narrow tools instead of broad access, and scope it hard. The result is support that scales with the product without a support queue.

Try it at arctools.fun. Feedback welcome.

#Arc #USDC #DeFi #AIAgents #DeveloperTools #Fintech

---

## LinkedIn — short variant (if the long one is too much for a feed post)

Introducing Archy Agent, the AI assistant for ArcTools on the Arc chain.

Most questions from new users were "how do I do this" and "where is it". Archy answers both, inside the product, in five languages, with the exact path on the site.

Built on a team-maintained knowledge base, four read-only tools (token stats, search, chain status, system status) and Claude Haiku 4.5. Scoped strictly to ArcTools and Arc: no price predictions, no financial advice, and it says when it does not know.

Live now at arctools.fun, bottom of the left menu.

#Arc #USDC #DeFi #AIAgents
