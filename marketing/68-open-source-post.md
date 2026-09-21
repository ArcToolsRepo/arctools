# 68 — the code is public

## Main post

The code is public.

Everything ArcTools runs on is now on GitHub, in one repo, with every commit: the sniper, the buy bot and the trending engine, the swap aggregator, the ArcPad launchpad contracts, the orders engine, the site, the ArcOne app. 305 commits, TypeScript, Python, Solidity.

Why: you hand us a key and route real money through our contracts. "Trust us" is not an answer. Read the fee math yourself. Read what the sniper does with your wallet. Fork it if you want.

What is not there: signing keys, API keys, our node addresses. What is there: everything else.

github.com/ArcToolsRepo/arctools

Bugs, ideas, pull requests — open an issue. We read every one.

## Short variant

ArcTools is open source. Sniper, buybot, aggregator, launchpad contracts, site, app — one repo, 305 commits. Read the fee math yourself. github.com/ArcToolsRepo/arctools

## Notes
- The repo card in the graphic is drawn from live GitHub API data (folders, 305 commits, language split) — a Firecrawl render of GitHub came with three menus open. Numbers are real as of 2026-09-21.
- Do not say "audited": say "public" / "readable". Internal review only.
- Expect questions about the sniper being copyable. Answer: yes, the edge is the index and the pads registry kept live, not the code.
