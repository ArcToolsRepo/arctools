"""Artwork read straight out of a token's deployed bytecode.

Why this exists: a contract that hardcodes its own image URL is the one source that cannot be wrong — the
address came from whoever deployed the token, not from a name match on a social network. It costs a single
`eth_getCode`, so it belongs near the front of the hunt rather than as a last resort.

What the token's own getters expose (name/symbol/tokenURI) is handled by contract_socials; this module only
digs through the raw code for a usable image, and it looks for the shapes that the getters miss:

  * ordinary links ending in png/jpg/jpeg/webp/gif/svg/avif
  * ipfs:// links, bare CIDs (Qm… / bafy…) and gateway paths with no file extension
  * arweave ar:// links and ar-gateway paths
  * inline `data:image/...;base64,` art, which several on-chain-art tokens embed instead of linking out

A candidate is only accepted once it has been fetched and confirmed to be a real image, because a URL
sitting in bytecode may well point at a domain that expired years ago.
"""
from __future__ import annotations

import asyncio
import re

import aiohttp

from .logos import _ipfs_to_http, _rpc, verify_any

ASCII = re.compile(rb"[ -~]{6,}")
# the node is shared with the live index, so bytecode reads get their own small budget
_NODE = asyncio.Semaphore(10)

EXT = r"(?:png|jpe?g|webp|gif|svg|avif)"
CAND = re.compile(
    rf"(https?://[^\s\"'\\)<>]+\.{EXT}(?:\?[^\s\"'\\)<>]{{0,80}})?"      # a plain image link
    rf"|ipfs://[A-Za-z0-9]{{10,}}[^\s\"'\\)<>]{{0,120}}"                  # ipfs://CID[/path]
    rf"|ar://[A-Za-z0-9_-]{{20,}}"                                       # arweave
    rf"|https?://[^\s\"'\\)<>]*/ipfs/[A-Za-z0-9]{{10,}}[^\s\"'\\)<>]{{0,120}}"  # gateway, extension-less
    rf"|data:image/[a-z+]{{3,10}};base64,[A-Za-z0-9+/=]{{200,}}"         # inline art
    rf"|\b(?:Qm[1-9A-HJ-NP-Za-km-z]{{44}}|bafy[a-z2-7]{{20,}})\b)",      # a bare CID with no scheme
    re.I,
)
# a link that merely happens to live in every contract compiled by a given tool is not this token's artwork
NOISE = re.compile(r"(openzeppelin|uniswap\.org|github\.com|solidity|schema\.org|w3\.org|npmjs|licenses?/)", re.I)


# An EIP-1167 minimal proxy is 45 bytes of jump table with the implementation address in the middle. On Arc
# every launchpad token is one of these, so there is no per-token string in the code at all — the artwork, when
# it exists, lives in the implementation's storage and comes back through the getters instead. Recognising the
# shape lets the hunt skip the scan instead of hashing 45 bytes for nothing, and tells us which factory minted it.
CLONE_LEN = (45, 44, 55)


def clone_impl(code_hex: str) -> str | None:
    """The implementation address when this is a minimal proxy, else None."""
    if not isinstance(code_hex, str):
        return None
    raw = code_hex[2:] if code_hex.startswith("0x") else code_hex
    if len(raw) // 2 not in CLONE_LEN or "363d3d37" not in raw:
        return None
    # the canonical runtime is 363d3d373d3d3d363d73 <20-byte impl> 5af43d82803e903d91602b57fd5bf3
    i = raw.find("363d3d373d3d3d363d73")
    if i < 0:
        i = raw.find("363d3d363d73")        # the vanity-prefixed variant some factories deploy
        i = i + len("363d3d363d73") if i >= 0 else -1
    else:
        i += len("363d3d373d3d3d363d73")
    if i < 0 or len(raw) < i + 40:
        return None
    impl = raw[i:i + 40]
    return "0x" + impl if impl.strip("0") else None


def candidates(code_hex: str) -> list[str]:
    """Every image-ish literal in the contract, most specific first, noise dropped."""
    if not isinstance(code_hex, str) or len(code_hex) < 6:
        return []
    try:
        raw = bytes.fromhex(code_hex[2:] if code_hex.startswith("0x") else code_hex)
    except ValueError:
        return []
    if clone_impl(code_hex):                # a proxy carries no strings of its own
        return []
    blob = b" ".join(ASCII.findall(raw)).decode("ascii", "ignore")
    out: list[str] = []
    for m in CAND.finditer(blob):
        u = m.group(0).strip().rstrip(".,'\")")
        if NOISE.search(u) or u in out:
            continue
        if u.startswith(("Qm", "bafy")):
            u = f"ipfs://{u}"
        out.append(u)
        if len(out) >= 8:                     # a contract with more than a handful is spamming strings
            break
    # inline art and ipfs beat a third-party http host that may be long gone
    out.sort(key=lambda u: 0 if u.startswith("data:") else 1 if u.startswith(("ipfs://", "ar://")) else 2)
    return out


async def from_bytecode(s: aiohttp.ClientSession, token: str) -> str | None:
    """One eth_getCode, then the first literal that turns out to be a real image."""
    try:
        async with _NODE:
            code = await _rpc(s, "eth_getCode", [token, "latest"], 10)
    except Exception:  # noqa
        return None
    for u in candidates(code):
        if u.startswith("data:"):             # already the image itself, nothing to verify over the network
            return u[:300] if len(u) <= 300 else None
        url = _ipfs_to_http(u) if u.startswith("ipfs://") else u
        if u.startswith("ar://"):
            url = "https://arweave.net/" + u[5:]
        got = await verify_any(s, url)
        if got:
            return got[:300]
    return None
