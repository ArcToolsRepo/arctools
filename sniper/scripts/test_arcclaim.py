"""ArcClaim unit tests on an in-process EVM (eth-tester / py-evm). Run before deploy."""
import json, os, sys, time
from web3 import Web3, EthereumTesterProvider
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_abi import encode

HERE = os.path.dirname(os.path.abspath(__file__))
b = json.load(open(os.path.join(HERE, "..", "contracts", "ArcClaim.build.json")))
w3 = Web3(EthereumTesterProvider())
accts = w3.eth.accounts
sender, treasury, recipient, stranger = accts[0], accts[1], accts[2], accts[3]
C = w3.eth.contract(abi=b["abi"], bytecode=b["bytecode"])
tx = C.constructor(treasury).transact({"from": sender})
addr = w3.eth.get_transaction_receipt(tx).contractAddress
c = w3.eth.contract(address=addr, abi=b["abi"])
CHAIN = w3.eth.chain_id
E = 10**18
passed = failed = 0


def ok(name, cond):
    global passed, failed
    passed += cond; failed += (not cond)
    print(("PASS" if cond else "FAIL"), name)


def reverts(fn, **kw):
    try:
        fn.transact(kw); return False
    except Exception:
        return True


def digest(id_, rcpt):
    inner = Web3.keccak(encode(["string", "uint256", "address", "uint256", "address"], ["ArcClaim", CHAIN, addr, id_, rcpt]))
    return inner


def sign(key, id_, rcpt):
    # personal_sign over the 32-byte inner hash == the contract's "\x19Ethereum Signed Message:\n32" + hash
    return Account.sign_message(encode_defunct(primitive=digest(id_, rcpt)), key).signature


def mine(seconds):
    w3.provider.ethereum_tester.time_travel(w3.eth.get_block("latest")["timestamp"] + seconds)
    w3.provider.ethereum_tester.mine_block()


# 1. create
k1 = Account.create()
tx = c.functions.create(k1.address, 3600).transact({"from": sender, "value": 20 * E})
r = w3.eth.get_transaction_receipt(tx)
ev = c.events.Created().process_receipt(r)[0]["args"]
ok("create emits id=1 amount=20", ev["id"] == 1 and ev["amount"] == 20 * E and ev["claimKey"] == k1.address)
ok("digest matches contract", c.functions.claimDigest(1, recipient).call() == Web3.keccak(b"\x19Ethereum Signed Message:\n32" + digest(1, recipient)))

# 2. claim to recipient with the right key: 2 % fee to treasury
t0, r0 = w3.eth.get_balance(treasury), w3.eth.get_balance(recipient)
sig = sign(k1.key, 1, recipient)
tx = c.functions.claim(1, recipient, sig).transact({"from": stranger})   # anyone can submit, funds go to `recipient`
ok("recipient gets 19.6", w3.eth.get_balance(recipient) - r0 == int(19.6 * E))
ok("treasury gets 0.4 (2 %)", w3.eth.get_balance(treasury) - t0 == int(0.4 * E))
ok("status claimed", c.functions.links(1).call()[4] == 1)
ok("second claim reverts", reverts(c.functions.claim(1, recipient, sig), **{"from": stranger}))
ok("refund after claim reverts", reverts(c.functions.refund(1), **{"from": sender}))

# 3. signature bound to recipient: a watcher cannot redirect
k2 = Account.create()
c.functions.create(k2.address, 3600).transact({"from": sender, "value": 5 * E})
sig_r = sign(k2.key, 2, recipient)
ok("sig for recipient rejected when submitted for stranger", reverts(c.functions.claim(2, stranger, sig_r), **{"from": stranger}))
ok("wrong key rejected", reverts(c.functions.claim(2, recipient, sign(k1.key, 2, recipient)), **{"from": stranger}))
ok("sig for id 1 rejected on id 2", reverts(c.functions.claim(2, recipient, sign(k2.key, 1, recipient)), **{"from": stranger}))
ok("garbage sig rejected", reverts(c.functions.claim(2, recipient, b"\x01" * 65), **{"from": stranger}))
ok("short sig rejected", reverts(c.functions.claim(2, recipient, b"\x01" * 64), **{"from": stranger}))
ok("zero recipient rejected", reverts(c.functions.claim(2, "0x" + "00" * 20, sign(k2.key, 2, "0x" + "00" * 20)), **{"from": stranger}))

# 4. refund: not before expiry, yes after, only to sender, once
ok("refund before expiry reverts", reverts(c.functions.refund(2), **{"from": sender}))
mine(3601)
ok("claim after expiry reverts", reverts(c.functions.claim(2, recipient, sig_r), **{"from": stranger}))
s0 = w3.eth.get_balance(sender)
c.functions.refund(2).transact({"from": stranger})                       # a stranger triggers it, sender gets paid
ok("refund pays sender in full (no fee)", w3.eth.get_balance(sender) - s0 == 5 * E)
ok("status refunded", c.functions.links(2).call()[4] == 2)
ok("second refund reverts", reverts(c.functions.refund(2), **{"from": sender}))

# 5. guards
ok("reused claim key rejected", reverts(c.functions.create(k1.address, 3600), **{"from": sender, "value": E}))
ok("amount below 0.1 rejected", reverts(c.functions.create(Account.create().address, 3600), **{"from": sender, "value": E // 20}))
ok("ttl < 1h rejected", reverts(c.functions.create(Account.create().address, 600), **{"from": sender, "value": E}))
ok("ttl > 90d rejected", reverts(c.functions.create(Account.create().address, 91 * 86400), **{"from": sender, "value": E}))
ok("zero key rejected", reverts(c.functions.create("0x" + "00" * 20, 3600), **{"from": sender, "value": E}))
ok("unknown id claim reverts", reverts(c.functions.claim(99, recipient, sig), **{"from": stranger}))
ok("unknown id refund reverts", reverts(c.functions.refund(99), **{"from": stranger}))

# 6. rounding: 0.1 USDC -> fee 0.002
k3 = Account.create(); c.functions.create(k3.address, 3600).transact({"from": sender, "value": E // 10})
r0 = w3.eth.get_balance(recipient); t0 = w3.eth.get_balance(treasury)
c.functions.claim(3, recipient, sign(k3.key, 3, recipient)).transact({"from": stranger})
ok("0.1 USDC -> 0.098 paid / 0.002 fee", w3.eth.get_balance(recipient) - r0 == E // 10 - E // 500 and w3.eth.get_balance(treasury) - t0 == E // 500)

# 7. contract never holds more than open links
ok("contract balance zero after all settled", w3.eth.get_balance(addr) == 0)
ok("FEE_BPS is 200", c.functions.FEE_BPS().call() == 200)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
