"""ArcTools node-side ingest agent.

Runs in a container ON the machine that hosts the Arc node. It does one thing: read new block receipts over
localhost and POST the swap-relevant logs to the ArcTools buybot over HTTPS/443. Nothing else — decoding, pool
resolution, pricing, the database and the public API all stay on Railway.

Why: from Railway (US West) every call to the node in Warsaw costs ~353 ms round trip, and a block needs several.
Here the same calls cost ~0.3 ms, so "block → screen" drops from ~5 s to ~1.5 s.

Network, outbound only (no inbound port, works behind NAT/CGNAT):
  * TCP 443  HTTPS → BOT_URL (the buybot on Railway)
  * TCP 8545 HTTP  → the node, over 127.0.0.1

Modes:
  INGEST_MODE=shadow  read and report, the server ignores the payload   (safe first run, default)
  INGEST_MODE=live    the server serves these blocks to its ingest

Nothing is stored on disk, nothing is exposed, and if this container stops the buybot silently goes back to
reading the node directly.
"""
from __future__ import annotations

import gzip
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request

NODE = os.getenv("NODE_RPC", "http://127.0.0.1:8545")
BOT = os.getenv("BOT_URL", "https://bot-production-4200.up.railway.app").rstrip("/")
KEY = os.getenv("INGEST_KEY", "")
MODE = "live" if os.getenv("INGEST_MODE", "shadow").lower() == "live" else "shadow"
BATCH = int(os.getenv("BATCH_BLOCKS", "8"))          # max blocks per HTTPS post
POLL = float(os.getenv("POLL_SECONDS", "0.25"))
AGENT = os.getenv("AGENT_NAME", socket.gethostname())[:40]

# the five logs that matter: Uniswap V3 / V2 / V4 swaps, V4 Initialize, ArcPad trade
TOPICS = {
    "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",   # V3 Swap
    "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",   # V2 Swap
    "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",   # V4 Swap
    "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",   # V4 Initialize
    "0x9adcf0ad0cda63c4d50f26a48925cf6405df27d422a39c456b5f03f661c82982",   # ArcPad Trade
}


def rpc(payload: list | dict, timeout: float = 20.0):
    req = urllib.request.Request(NODE, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def post_blocks(body: dict, timeout: float = 25.0) -> dict | None:
    raw = gzip.compress(json.dumps(body).encode())
    req = urllib.request.Request(f"{BOT}/api/ingest-blocks", data=raw, headers={
        "Content-Encoding": "gzip", "Content-Type": "application/json", "X-Ingest-Key": KEY,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"[agent] server said {e.code}: {e.read()[:160].decode(errors='ignore')}", flush=True)
    except Exception as e:  # noqa
        print(f"[agent] post failed: {type(e).__name__}: {e}", flush=True)
    return None


def head() -> int:
    return int(rpc({"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []}, 8.0)["result"], 16)


def receipts(blocks: list[int]) -> dict[int, list]:
    res = rpc([{"jsonrpc": "2.0", "id": b, "method": "eth_getBlockReceipts", "params": [hex(b)]} for b in blocks], 25.0)
    out: dict[int, list] = {}
    for x in res if isinstance(res, list) else []:
        if x.get("result") is not None:
            out[int(x["id"])] = x["result"]
        elif x.get("error"):
            print(f"[agent] block {x.get('id')}: {str(x['error'])[:90]}", flush=True)
    return out


def pack(block: int, rcs: list) -> dict:
    """Keep only swap logs and the sender of each successful transaction — a few kB per block."""
    logs, senders = [], {}
    for rc in rcs:
        if rc.get("status") not in ("0x1", 1, True):
            continue
        txh = (rc.get("transactionHash") or "").lower()
        frm = (rc.get("from") or "").lower()
        if txh and frm:
            senders[txh] = frm
        for lg in rc.get("logs") or []:
            tps = [t.lower() for t in (lg.get("topics") or [])]
            if not tps or tps[0] not in TOPICS:
                continue
            logs.append({"address": lg["address"].lower(), "topics": tps, "data": lg.get("data") or "0x",
                         "transactionHash": lg["transactionHash"].lower(), "blockNumber": lg["blockNumber"],
                         "logIndex": lg["logIndex"], "blockHash": lg.get("blockHash")})
    return {"n": block, "logs": logs, "senders": {k: v for k, v in senders.items()}}


def main() -> None:
    if not KEY:
        sys.exit("[agent] INGEST_KEY is required")
    print(f"[agent] {AGENT} → {BOT} mode={MODE} node={NODE} batch={BATCH}", flush=True)
    cursor = 0
    sent_blocks = sent_logs = posts = 0
    t_report = time.time()
    lat_node: list[float] = []
    while True:
        try:
            t0 = time.time()
            h = head()
            lat_node.append((time.time() - t0) * 1000)
            if cursor == 0:
                cursor = h - 1                       # start at the head, never backfill (Railway still owns history)
            if h <= cursor:
                time.sleep(POLL)
                continue
            frm, to = cursor + 1, min(h, cursor + BATCH)
            got = receipts(list(range(frm, to + 1)))
            if not got:
                time.sleep(POLL)
                continue
            blocks = [pack(n, got[n]) for n in sorted(got)]
            ack = post_blocks({"mode": MODE, "head": h, "sent": time.time(), "agent": AGENT, "blocks": blocks})
            if ack is None:
                time.sleep(1.0)                      # server hiccup: retry the same blocks
                continue
            cursor = max(sorted(got))
            posts += 1
            sent_blocks += len(blocks)
            sent_logs += sum(len(b["logs"]) for b in blocks)
            if time.time() - t_report > 60:
                lat = sorted(lat_node)[len(lat_node) // 2] if lat_node else 0
                print(f"[agent] 60s: {posts} posts, {sent_blocks} blocks, {sent_logs} swap logs, "
                      f"node {lat:.1f} ms, uplink {ack.get('lat_ms')} ms, server lag {ack.get('lag_blocks')} blocks",
                      flush=True)
                posts = sent_blocks = sent_logs = 0
                lat_node = lat_node[-50:]
                t_report = time.time()
            if to >= h:
                time.sleep(POLL)
        except KeyboardInterrupt:
            return
        except Exception as e:  # noqa
            print(f"[agent] loop error: {type(e).__name__}: {str(e)[:140]}", flush=True)
            time.sleep(1.5)


if __name__ == "__main__":
    main()
