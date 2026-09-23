import { mock } from "bun:test";
mock.module("cloudflare:workers", () => ({ env: {} }));
const m = await import("/home/user/bc0f5d35-e22d-4718-8575-2f3bdae5bc64/arctools-ef3a81ae-051b-4d54-aab9-d6c0fabc7779/app/src/lib/x402.server.ts");
console.log("domain", m.DOMAIN_SEPARATOR_HEX, "match on-chain:", m.DOMAIN_SEPARATOR_HEX === "0x940506929bba468048a19b567f4f0d534714bc06604b5c3017e5d16785ccdf84");
// sign with E2E key using noble directly (same as a client would with viem)
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const key = "2429ccbb8cfbda46786e588e891841ebf95fadbbe689fa9beb63290843e2adfb";
const a = { from: "0x731eA5B6a768f8e0c47a977D3aBF484e54ADc620", to: m.TREASURY, value: "5000", validAfter: "0", validBefore: String(Math.floor(Date.now()/1000)+60), nonce: "0x" + "ab".repeat(32) };
const d = m.digest(a);
const rs = await secp.signAsync(d, key, { lowS: true }); const compact = rs.toBytes(); const v = 27 + rs.recovery;
const sigHex = "0x" + Array.from(compact, (x: number) => x.toString(16).padStart(2, "0")).join("") + v.toString(16);
console.log("recovered", m.recover(a, sigHex), "expect", a.from.toLowerCase());
