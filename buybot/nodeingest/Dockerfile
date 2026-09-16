FROM python:3.12-slim

# No third-party packages: the agent uses only the standard library (urllib + gzip + json).
ENV PYTHONUNBUFFERED=1 \
    NODE_RPC=http://127.0.0.1:8545 \
    BOT_URL=https://bot-production-4200.up.railway.app \
    INGEST_MODE=shadow \
    BATCH_BLOCKS=8 \
    POLL_SECONDS=0.25

WORKDIR /app
COPY agent.py /app/agent.py

# runs unprivileged, keeps no state, exposes no port
RUN useradd -r -u 10001 arcingest
USER arcingest

HEALTHCHECK --interval=60s --timeout=10s --start-period=20s \
  CMD python -c "import json,urllib.request,os; urllib.request.urlopen(urllib.request.Request(os.environ['NODE_RPC'], data=json.dumps({'jsonrpc':'2.0','id':1,'method':'eth_blockNumber','params':[]}).encode(), headers={'Content-Type':'application/json'}), timeout=8)"

CMD ["python", "/app/agent.py"]
