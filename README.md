# RunbookOS

> **Stop writing runbooks. Let your incidents write them.**

RunbookOS is a DevOps incident memory system powered by Cognee's knowledge graph. Feed it past incidents — Slack threads, post-mortems, alert payloads — and it builds a causal graph of your infrastructure. When the next outage hits, it traverses that graph to generate a ranked, step-by-step runbook grounded in what actually worked before.

Built for the **WeMakeDevs x Cognee Hackathon 2026** — *"The Hangover Part AI: Where's My Context?"*

---

## Table of contents

- [The core idea](#the-core-idea)
- [Why GraphRAG beats plain RAG for incidents](#why-graphrag-beats-plain-rag-for-incidents)
- [Data](#data)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Hackathon submission](#hackathon-submission)
- [License](#license)

---

## The core idea

Every SRE team rediscovers the same root causes over and over. Redis OOM → FLUSHALL. Postgres connection pool exhausted → max_connections bump. Nginx 502 → upstream service crashed. The knowledge exists in Slack threads and post-mortems — but it's never connected, never searchable, and never learns from resolutions.

RunbookOS builds that connection using **GraphRAG**:

```
Incident text → Cognee entity extraction → Knowledge graph
                                                  ↓
Symptom query → Graph traversal → Causal chain → Runbook
                                                  ↑
Resolution outcome → Edge reweighting → Better next time
```

The memory lifecycle is real, not cosmetic:

| Operation | What actually happens |
|---|---|
| **Remember** | `add_text` + `cognify` ingest an incident and extract entities/relationships into a single shared Cognee graph |
| **Recall** | `GRAPH_COMPLETION` traverses the graph and feeds the result into runbook synthesis |
| **Improve** | Resolution outcomes (worked / didn't work) are cognified back in, so the memory evolves |
| **Forget** | A real per-document `DELETE` against Cognee Cloud — the document and its graph contribution are genuinely removed, not just hidden |

---

## Why GraphRAG beats plain RAG for incidents

The COMPARE mode runs 3 pipelines in parallel — **same 153 incidents, same Groq Llama 3.3-70B, same synthesis prompt. Only retrieval differs.** All three produce a structured runbook, so the comparison is apples-to-apples:

| | Plain RAG | Enhanced VectorDB | GraphRAG (Cognee) |
|---|---|---|---|
| Retrieval | Cosine similarity | BM25 + vector + reranker | Knowledge graph traversal |
| Cross-incident reasoning | No | No | Yes |
| Learns from resolutions | No | No | Yes |
| Response time (typical) | ~3s | ~5s | ~15–25s |

Response times are measured live, not hardcoded — GraphRAG is slower because it makes a real network round-trip to Cognee Cloud and traverses the graph, rather than a local nearest-neighbour lookup.

**Key insight:** Vector search retrieves the chunks most textually *similar* to the query. Cognee's graph connects incidents through shared entities and relationships, so it can reason *across* separate incidents and reflect what actually resolved them — and, uniquely, it updates as you mark resolutions.

---

## Data

153 real incidents pulled from 16 open-source repositories — Redis, Kubernetes, Prometheus, etcd, Vault, Grafana, Loki, containerd, Cilium, CockroachDB, Jaeger, Vitess, Longhorn, Argo CD, OpenTelemetry Collector, and NATS. Every incident carries a working link back to its original GitHub issue. See [DATA_SOURCES.md](DATA_SOURCES.md) for the full breakdown, counts per repo, and licensing.

---

## Quick start

### Option A — Docker Compose (recommended for judges)

```bash
git clone https://github.com/samyaktempwork-cell/runbook-os.git
cd runbook-os

# Copy and fill in your API keys (see .env.example)
cp .env.example .env

docker-compose up
```

Open [http://localhost:3000](http://localhost:3000)

### Option B — One-command local launcher

```bash
cp .env.example .env   # fill in your keys
./start.sh              # starts backend (:8000) + frontend (:3000)
./stop.sh                # stops both
```

See [RUN.md](RUN.md) for the full local run guide, troubleshooting, and manual two-terminal setup.

---

## Environment variables

Copy `.env.example` to `.env` and fill in:

```env
# Cognee Cloud — get from https://app.cognee.ai
COGNEE_CLOUD_BASE=https://tenant-<your-id>.aws.cognee.ai
COGNEE_API_KEY=your_cognee_api_key

# Groq — free at https://console.groq.com
GROQ_API_KEY=your_groq_api_key

# Model config (defaults shown)
SYNTHESIS_LLM_MODEL=llama-3.3-70b-versatile
PORT=8000
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 14)                 │
│         Single dashboard — FEED / ASK / COMPARE          │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP + WebSocket
┌──────────────────────▼──────────────────────────────────┐
│                   Backend (FastAPI)                      │
│                                                          │
│  rag_service.py        — ChromaDB + sentence-transformers│
│  hybrid_rag_service.py — BM25 + CrossEncoder reranker   │
│  cognee_service.py     — Cognee Cloud REST API           │
│  runbook_synth.py      — Groq Llama 3.3-70B synthesis   │
│  comparison.py         — 3-tier parallel runner          │
└──────┬──────────────────────────┬───────────────────────┘
       │                          │
┌──────▼──────┐          ┌────────▼────────┐
│  ChromaDB   │          │  Cognee Cloud   │
│  (in-memory)│          │  Knowledge Graph│
│  Plain RAG  │          │  150+ entities  │
│  Hybrid RAG │          │  from 153 real  │
│             │          │  incidents      │
└─────────────┘          └─────────────────┘
```

**3-tier comparison pipeline** (all run in parallel via `asyncio.gather` — same synthesizer, only retrieval differs):
- **Tier 1** — Plain RAG: vector cosine similarity → top-5 chunks → structured runbook
- **Tier 2** — Enhanced VectorDB: hybrid BM25 + vector → top-20 → CrossEncoder rerank → top-5 → structured runbook
- **Tier 3** — GraphRAG: Cognee GRAPH_COMPLETION → graph traversal → structured runbook (same Groq synthesizer as Tiers 1 & 2)

---

## Project structure

```
runbook-os/
├── backend/
│   ├── main.py                 # FastAPI app, all routes, WebSocket
│   ├── cognee_service.py       # Cognee Cloud REST client
│   ├── rag_service.py          # ChromaDB + sentence-transformers
│   ├── hybrid_rag_service.py   # BM25 + CrossEncoder (Tier 2)
│   ├── runbook_synth.py        # Groq LLM synthesis
│   ├── comparison.py           # 3-tier parallel runner
│   ├── schemas.py              # Pydantic models
│   ├── incident_store.py       # JSON persistence
│   └── graph_events.py         # WebSocket event emitter
├── data/
│   └── seed_incidents.json     # 153 real incidents from 16 OSS repos
├── frontend/
│   ├── app/
│   │   ├── page.tsx            # Single dashboard — FEED / ASK / COMPARE modes
│   │   └── layout.tsx
│   ├── components/
│   │   ├── KnowledgeGraph.tsx  # react-force-graph-2d canvas
│   │   ├── ComparisonView.tsx  # 3-column compare layout
│   │   ├── RunbookViewer.tsx   # Step-by-step runbook + resolve
│   │   ├── IncidentTimeline.tsx
│   │   ├── PatternPanel.tsx
│   │   ├── MemoryLifecycle.tsx # 4 Cognee lifecycle pills
│   │   ├── AlertConfigModal.tsx
│   │   └── GraphLegend.tsx
│   └── hooks/
│       └── useGraphSocket.ts   # WebSocket + graph state
├── scripts/
│   └── fetch_real_incidents.py # Reproducible corpus fetcher (GitHub API)
├── start.sh / stop.sh          # One-command local launcher
├── requirements.txt
├── docker-compose.yml
└── .env.example
```

---

## API reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/incidents` | Feed incident text into memory |
| POST | `/runbook` | Generate runbook for a symptom |
| POST | `/compare` | Run all 3 tiers in parallel |
| POST | `/incidents/{id}/resolve` | Mark resolved, improve graph |
| DELETE | `/incidents/{id}` | Forget an incident (real Cognee deletion) |
| GET | `/incidents` | List all incidents |
| GET | `/patterns` | Systemic patterns across incidents |
| GET | `/graph` | Cognee knowledge graph (nodes + edges) |
| GET | `/health` | Liveness check |
| WS | `/ws/events` | Real-time graph animation events |

---

## Hackathon submission

| | |
|---|---|
| **Event** | WeMakeDevs x Cognee Hackathon 2026 — *"The Hangover Part AI: Where's My Context?"* |
| **Window** | June 29 – July 5, 2026 |
| **Track** | Best Use of Cognee Cloud |
| **Builder** | Samyakkumar Jain ([@samyaktempwork-cell](https://github.com/samyaktempwork-cell)) |
| **Repository** | [github.com/samyaktempwork-cell/runbook-os](https://github.com/samyaktempwork-cell/runbook-os) |
| **Stack** | FastAPI · Next.js 14 · Cognee Cloud · Groq Llama 3.3-70B · ChromaDB · sentence-transformers · rank_bm25 |

**Why Cognee, not just RAG?** RunbookOS's own COMPARE mode is the answer — see [Why GraphRAG beats plain RAG for incidents](#why-graphrag-beats-plain-rag-for-incidents) above. All three retrieval tiers run the identical synthesis prompt on the identical corpus; Cognee's graph is the only one that reasons across incidents and evolves as resolutions come in.

---

## License

MIT — see [LICENSE](LICENSE).
