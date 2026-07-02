# RunbookOS — How to Run (Local Demo Guide)

Everything you need to start RunbookOS locally for the demo.

---

## TL;DR — one command

```bash
cd /home/samyak-jain/Projects/runbook-os
./start.sh
```

Then open **http://localhost:3000**. To stop: `./stop.sh`

`start.sh` frees ports 8000/3000, launches the backend, waits for health, launches the frontend, and prints the URLs. Logs go to `backend.log` and `frontend.log` in the repo root.

---

## Prerequisites (one-time)

1. **`.env`** in the repo root with:
   ```
   COGNEE_CLOUD_BASE=https://tenant-<id>.aws.cognee.ai
   COGNEE_API_KEY=...
   GROQ_API_KEY=...
   ```
2. **Python venv** with deps:
   ```bash
   python3 -m venv venv
   venv/bin/pip install -r requirements.txt
   ```
3. **Frontend deps**:
   ```bash
   cd frontend && npm install && cd ..
   ```

`start.sh` checks all three and tells you exactly what's missing.

---

## What "ready" looks like

- Backend health: `curl http://localhost:8000/health` → `{"status":"ok","incidents":153,"rag_indexed":153}`
- Frontend: http://localhost:3000 loads the single-page dashboard (graph + command bar with FEED / ASK / COMPARE).

Backend startup takes ~20–40s (loads the embedding model + BM25 index). It seeds 153 incidents into RAG/Hybrid on first run; if `data/incidents.json` already has them, it skips seeding.

---

## Manual start (if you prefer two terminals)

**Terminal 1 — backend:**
```bash
cd runbook-os/backend
source ../venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

**Terminal 2 — frontend:**
```bash
cd runbook-os/frontend
npm run dev
```

---

## Demo flow (single page, no route changes)

Everything is on http://localhost:3000 — switch modes in the command bar:

1. **Graph** — the knowledge graph is shown on load (entities + relationships from Cognee).
2. **ASK** — type a symptom (e.g. `Redis OOM causing payment 504s`) → watch the orange traversal + elapsed timer → runbook drawer slides up with steps, the **Causal chain** (real Cognee edges), and pitfalls.
3. **COMPARE** — same symptom → 3 columns (Plain RAG / Enhanced VectorDB / GraphRAG), same LLM + prompt, only retrieval differs.
4. **FEED** — paste a new incident → graph animates as it's remembered.
5. **Mark Resolved** / **Delete** — resolution feedback + real per-document FORGET.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `start.sh` says `.env not found` | Create `.env` in repo root (see Prerequisites) |
| `no venv with uvicorn` | `python3 -m venv venv && venv/bin/pip install -r requirements.txt` |
| `frontend deps missing` | `cd frontend && npm install` |
| Port already in use | `./stop.sh` then `./start.sh` (start.sh also auto-frees ports) |
| Backend up but graph sparse / empty | Cognee graph needs a completed `cognify`; if the Cognee LLM budget is exhausted, the RAG/Hybrid tiers still work. See MUST_FIX_PLAN.md "INCIDENT" section for recovery. |
| Live graph not animating | Ensure backend is on :8000; frontend WS defaults to `ws://localhost:8000/ws/events` |

---

## Ports

| Service | Port | URL |
|---|---|---|
| Frontend (Next.js) | 3000 | http://localhost:3000 |
| Backend (FastAPI) | 8000 | http://localhost:8000 |
| WebSocket (graph events) | 8000 | ws://localhost:8000/ws/events |
