# RunbookOS — Deployment Guide

> Backend → Railway (free tier + $5 trial credit)
> Frontend → Vercel (free hobby tier)
> Estimated time: 45–60 minutes end-to-end
> Do this on Day 6–7 of the hackathon (July 4–5, 2026)

---

## Services & Shoutouts

| Service | Used for | Free tier | Sign-up |
|---|---|---|---|
| **Cognee Cloud** | Graph memory — add_text, cognify, GRAPH_COMPLETION | Yes (sponsor) | app.cognee.ai |
| **Groq** | Llama 3.3-70B inference (synthesis + RAG) | Yes (generous) | console.groq.com |
| **HuggingFace** | `all-MiniLM-L6-v2` embeddings + `cross-encoder/ms-marco-MiniLM-L-6-v2` reranker | Yes (model hub) | huggingface.co |
| **Railway** | Backend hosting — FastAPI + WebSockets | $5 trial credit | railway.app |
| **Vercel** | Frontend hosting — Next.js | Yes (hobby) | vercel.com |
| **ChromaDB** | In-memory vector store (Tier 1 RAG) | Open source | trychroma.com |

### HuggingFace models (auto-downloaded, no API key needed)

| Model | ~Size | Loaded when |
|---|---|---|
| `all-MiniLM-L6-v2` | 90 MB | Startup (always) |
| `cross-encoder/ms-marco-MiniLM-L-6-v2` | 90 MB | First `/compare` call (lazy) |

Both pull from HuggingFace Hub automatically — no HF account or token needed for these public models.

---

## Railway — Backend Deployment

### What Railway needs to know

Railway reads `nixpacks.toml` from the repo root. This file already exists:

```toml
[phases.install]
cmds = ["pip install -r requirements.txt"]

[start]
cmd = "cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT"
```

No Dockerfile needed. Railway handles Python env, port binding, and TLS automatically.

---

### Step 1 — Create Railway account

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub (easiest — it connects your repos automatically)
3. You get a **30-day free trial with $5 credits** — no credit card required
4. $5 credit at Railway's rate (~$0.000463/vCPU/min, ~$0.000231/GB-RAM/min) = ~100+ hours of runtime

---

### Step 2 — Push repo to GitHub first

Railway deploys from GitHub. Make sure the repo is pushed and public:

```bash
cd /home/samyak-jain/Projects/runbook-os
git init                          # if not already a git repo
git add .
git commit -m "Initial RunbookOS submission"
git remote add origin https://github.com/YOUR_USERNAME/runbook-os.git
git push -u origin main
```

---

### Step 3 — Create new Railway project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **"Deploy from GitHub repo"**
3. Authorize Railway to access your GitHub if prompted
4. Search for and select `runbook-os`
5. Click **Deploy Now**

Railway will immediately start building. It will fail at first because env vars are missing — that's expected.

---

### Step 4 — Set environment variables

In Railway dashboard:
1. Click your service → **Variables** tab
2. Click **"New Variable"** and add each one:

```
COGNEE_API_KEY        = <your Cognee Cloud API key>
GROQ_API_KEY          = <your Groq API key>
CORS_ORIGINS          = http://localhost:3000
DATA_DIR              = /app/data
HF_HOME               = /app/hf_cache
```

> `CORS_ORIGINS` starts with just localhost — update it after Vercel deploy to add your Vercel URL.
> `HF_HOME` tells HuggingFace where to cache models (used with the volume in Step 5).

**Where to get keys:**
- `COGNEE_API_KEY` → [app.cognee.ai](https://app.cognee.ai) → Settings → API Keys → Create new key
- `GROQ_API_KEY` → [console.groq.com](https://console.groq.com) → API Keys → Create API Key

After adding all vars, Railway auto-redeploys.

---

### Step 5 — Add persistent volume (prevents model re-download on every deploy)

Without a volume, the 90MB HuggingFace model re-downloads every time you redeploy (~60s extra startup).

1. In Railway dashboard: **New** → **Volume**
2. Set mount path: `/app/hf_cache`
3. Size: **1 GB** (free tier allows this)
4. Attach to your backend service
5. Railway redeploys automatically

After first successful deploy, the model is cached. Subsequent deploys skip the download.

---

### Step 6 — Add persistent volume for data (incidents.json)

Without this, `incidents.json` resets to seed data on every redeploy.

1. **New** → **Volume** again
2. Mount path: `/app/data`
3. Size: **1 GB**
4. Attach to backend service

This keeps your 20+ incidents alive across redeploys.

---

### Step 7 — Verify the build

Watch the deploy logs in Railway dashboard (Build Logs tab):

Expected output in order:
```
==> Installing dependencies from requirements.txt
==> Build successful
==> Starting service
[startup] Configuring Cognee...
[startup] Loading RAG embedding model...
[rag] Loading embedding model: all-MiniLM-L6-v2
[rag] Embedding model ready
[startup] Initializing Hybrid RAG (BM25 index; CrossEncoder loads on first compare)...
[hybrid-rag] Initialized (CrossEncoder will load on first compare call)
[startup] Checking seed data...
[startup] Seeding 153 incidents into RAG + Hybrid + Cognee...   ← or "153 incidents already in store — skipping seed"
[startup] Re-indexing existing incidents into RAG...
[startup] Pre-loading Cognee graph cache...
[cognee-cloud] Graph loaded: 138 entity nodes, 156 edges
[startup] Ready
INFO: Uvicorn running on http://0.0.0.0:XXXX
```

If you see `COGNEE_API_KEY not set` or `GROQ_API_KEY not set` → check Step 4.

---

### Step 8 — Get your Railway URL

In Railway dashboard → your service → **Settings** tab → **Domains** section:

Railway auto-generates a URL like:
```
https://runbook-os-production.up.railway.app
```

Or generate a custom subdomain: Settings → Domains → Generate Domain.

**Note this URL** — you need it for the Vercel setup.

---

### Step 9 — Smoke test the backend

```bash
# Health check
curl https://YOUR-APP.up.railway.app/health
# Expected: {"status":"ok","incidents":20,"rag_indexed":20}

# Graph check
curl https://YOUR-APP.up.railway.app/graph | python3 -m json.tool | head -20
# Expected: {"nodes":[...], "edges":[...]} with 100+ nodes

# Webhook test
curl -X POST https://YOUR-APP.up.railway.app/ingest/webhook \
  -H "Content-Type: application/json" \
  -d '{"symptom":"Redis memory high, payment 504s","source":"test"}'
# Expected: {"incident_id":"...","symptom":"Redis memory high, payment 504s","status":"processing"}
```

---

## Vercel — Frontend Deployment

### Step 1 — Create Vercel account

1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub (same account as Railway)
3. Free hobby tier — no credit card, no expiry

---

### Step 2 — Import project

1. Vercel dashboard → **Add New Project**
2. Select your `runbook-os` repo
3. **Important:** Set **Root Directory** to `frontend`
   - Click "Edit" next to Root Directory → type `frontend` → Save
4. Framework preset: **Next.js** (auto-detected)
5. Do NOT click Deploy yet — set env vars first

---

### Step 3 — Set environment variables

In the "Environment Variables" section before deploying:

```
NEXT_PUBLIC_API_URL   = https://YOUR-APP.up.railway.app
NEXT_PUBLIC_WS_URL    = wss://YOUR-APP.up.railway.app/ws/events
```

**Critical:** WebSocket URL must be `wss://` (not `ws://`).
Railway terminates TLS — your frontend is served over HTTPS, so WebSocket must also be secure.

---

### Step 4 — Deploy

Click **Deploy**. Vercel runs `npm run build` inside the `frontend/` directory.

Build takes ~2 minutes. You get a URL like:
```
https://runbook-os.vercel.app
```

---

### Step 5 — Update CORS on Railway

Now that you have the Vercel URL, go back to Railway → Variables → update `CORS_ORIGINS`:

```
CORS_ORIGINS = https://runbook-os.vercel.app,http://localhost:3000
```

Railway auto-redeploys on variable change.

---

### Step 6 — Full smoke test

Open `https://runbook-os.vercel.app` and verify:

- [ ] Contest header visible (WeMakeDevs × Cognee Hackathon)
- [ ] Sidebar WS dot is **green** (`live`) within 3 seconds
- [ ] Graph loads with 100+ nodes
- [ ] **FEED**: paste "Redis OOM on payment-svc, 504s" → graph animates
- [ ] **ASK**: type "Redis high memory, 504s" → orange traversal runs → runbook appears
- [ ] **COMPARE**: same symptom → 3 columns load, win-delta bar visible
- [ ] **Simulate AlertManager**: Redis button → "Alert ingested" message appears
- [ ] **TRACE OFF**: ASK again → noticeably faster (no stagger)

---

## Common Issues & Fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| WS dot stuck `reconnecting` | `NEXT_PUBLIC_WS_URL` wrong or missing | Must be `wss://` not `ws://`; check Vercel env vars |
| Graph empty on load | `DATA_DIR` not set | Add `DATA_DIR=/app/data` to Railway vars |
| Build fails on `pip install` | Python version mismatch | Railway uses Python 3.11 by default — compatible |
| `COGNEE_API_KEY not set` in logs | Env var missing | Re-check Railway Variables tab spelling |
| 500 on `/runbook` | Groq key invalid or rate limited | Check `GROQ_API_KEY` in Railway vars; test at console.groq.com |
| CrossEncoder OOM | RAM exceeded 500MB | Already fixed — lazy loads on first compare only |
| CORS error in browser console | Vercel URL not in `CORS_ORIGINS` | Add exact Vercel URL including `https://` |
| incidents.json resets on redeploy | No data volume | Add volume at `/app/data` (Step 6 above) |
| Models re-download every deploy | No HF cache volume | Add volume at `/app/hf_cache` + `HF_HOME=/app/hf_cache` (Step 5) |
| Railway deploy times out | Cognee API unreachable | Check `COGNEE_API_KEY` is valid; test at app.cognee.ai |

---

## RAM usage on Railway free tier (500 MB limit)

| Component | RAM |
|---|---|
| FastAPI + uvicorn | ~50 MB |
| `all-MiniLM-L6-v2` (always loaded) | ~90 MB |
| ChromaDB in-memory | ~20 MB |
| Cognee client | ~30 MB |
| **Idle total** | **~190 MB** ✓ |
| CrossEncoder (loaded on first /compare) | +~300 MB |
| **Peak during COMPARE** | **~490 MB** ✓ (just under limit) |

If you hit OOM: Railway dashboard → Service → Settings → increase memory limit to 1 GB (uses more of the $5 credit but stays free for hackathon duration).

---

## Cost estimate (Railway $5 trial credit)

| Resource | Rate | 7-day cost |
|---|---|---|
| 0.5 vCPU | $0.000463/min | ~$2.33 |
| 190 MB RAM (idle) | $0.000231/GB-min | ~$0.47 |
| 2× 1 GB volumes | $0.000081/GB-min | ~$0.16 |
| **Total** | | **~$2.96 for full 7 days** |

$5 credit covers the entire hackathon with ~$2 to spare. No credit card needed.

---

## Quick reference — all URLs after deployment

```
Backend health:   https://YOUR-APP.up.railway.app/health
Backend graph:    https://YOUR-APP.up.railway.app/graph
Backend docs:     https://YOUR-APP.up.railway.app/docs   (FastAPI Swagger UI)
Frontend:         https://runbook-os.vercel.app
WebSocket:        wss://YOUR-APP.up.railway.app/ws/events
```

---

## Files already in repo for deployment

| File | Purpose |
|---|---|
| `nixpacks.toml` | Railway build + start command |
| `railway.json` | Railway service config |
| `frontend/vercel.json` | Vercel framework + build config |
| `.env.example` | All required env vars with descriptions |
| `requirements.txt` | All Python dependencies |
