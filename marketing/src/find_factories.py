import json, requests, concurrent.futures as cf, collections, sys
U="http://89.68.166.52:8545"; H={"content-type":"application/json"}
S=requests.Session()
def rpc(m,p):
    r=S.post(U,json={"jsonrpc":"2.0","id":1,"method":m,"params":p},headers=H,timeout=30).json(); return r.get("result")
def batch(calls):
    r=S.post(U,json=[{"jsonrpc":"2.0","id":i,"method":m,"params":p} for i,(m,p) in enumerate(calls)],headers=H,timeout=60).json()
    return [x.get("result") for x in sorted(r,key=lambda x:x["id"])]
head=int(rpc("eth_blockNumber",[]),16)
def creation_block(token, hi):
    lo=1; hi=min(hi,head)
    if rpc("eth_getCode",[token,hex(hi)]) in (None,"0x"): return None
    while lo<hi:
        mid=(lo+hi)//2
        c=rpc("eth_getCode",[token,hex(mid)])
        if c and c!="0x": hi=mid
        else: lo=mid+1
    return lo
T="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
def creator(token, hint_block):
    b=creation_block(token, hint_block)
    if not b: return None
    logs=rpc("eth_getLogs",[{"fromBlock":hex(b),"toBlock":hex(b),"address":token}])
    txh=None
    if logs: txh=logs[0]["transactionHash"]
    else:
        blk=rpc("eth_getBlockByNumber",[hex(b),True])
        for tx in blk["transactions"]:
            rc=rpc("eth_getTransactionReceipt",[tx["hash"]])
            if rc and (rc.get("contractAddress") or "").lower()==token or any(l["address"].lower()==token for l in rc.get("logs",[])): txh=tx["hash"]; break
    if not txh: return {"block":b,"to":None}
    tx=rpc("eth_getTransactionByHash",[txh]); rc=rpc("eth_getTransactionReceipt",[txh])
    return {"block":b,"tx":txh,"from":tx["from"],"to":tx["to"],"direct":(rc.get("contractAddress") or "").lower()==token,"sel":tx["input"][:10]}
j=json.load(open('/tmp/unk_tokens.json'))
items=[(x["token"],x["block"],x["k"]) for x in j["v4"]+j["v3"]]
out={}
with cf.ThreadPoolExecutor(12) as ex:
    for (t,b,k),res in zip(items, ex.map(lambda it: creator(it[0],it[1]), items)):
        out[t]={"k":k,**(res or {})}
json.dump(out,open('/tmp/creators.json','w'))
groups=collections.Counter(); ex_={}
for t,r in out.items():
    key=(r.get("to") or "EOA-direct" if r.get("direct") else r.get("to") or "?")
    groups[key]+=1; ex_.setdefault(key,[]).append((t,r.get("sel")))
for key,n in groups.most_common(25):
    print(n, key, ex_[key][0])
