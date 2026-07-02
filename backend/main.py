"""RunbookOS FastAPI backend — routes, WebSocket, and startup."""

import asyncio
import uuid
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Load .env from repo root (one level above backend/)
from dotenv import load_dotenv
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path, override=False)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import cognee_service
import rag_service
import hybrid_rag_service
import runbook_synth
import incident_store
import comparison as comparison_runner
import metrics as metrics_store
from graph_events import emitter
from schemas import (
    FeedIncidentRequest,
    FeedIncidentResponse,
    RunbookRequest,
    ResolveRequest,
    ResolveResponse,
    DeleteResponse,
    WebhookPayload,
    WebhookResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[startup] Configuring Cognee...")
    await cognee_service.setup_cognee()

    print("[startup] Loading RAG embedding model...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, rag_service.initialize)

    print("[startup] Initializing Hybrid RAG (BM25 index; CrossEncoder loads on first compare)...")
    await loop.run_in_executor(None, hybrid_rag_service.initialize, rag_service._model)

    print("[startup] Checking seed data...")
    await _seed_if_empty()

    print("[startup] Re-indexing existing incidents into RAG...")
    await _reindex_rag()

    print("[startup] Pre-loading Cognee graph cache...")
    await cognee_service.get_graph()

    print("[startup] Ready")
    yield


async def _reindex_rag():
    if rag_service.count() > 0:
        return
    incidents = await incident_store.get_all()
    if not incidents:
        return
    loop = asyncio.get_event_loop()
    for incident in incidents:
        await loop.run_in_executor(None, rag_service.remember, incident.text, incident.incident_id)
        await loop.run_in_executor(None, hybrid_rag_service.remember, incident.text, incident.incident_id)
    print(f"[startup] RAG + Hybrid re-indexed {len(incidents)} incidents")


async def _seed_if_empty():
    count = await incident_store.count()
    if count > 0:
        print(f"[startup] {count} incidents already in store — skipping seed")
        return

    seeds = await incident_store.load_seed_incidents()
    if not seeds:
        print("[startup] No seed file found — starting empty")
        return

    print(f"[startup] Seeding {len(seeds)} incidents into RAG + Hybrid + Cognee...")
    loop = asyncio.get_event_loop()
    cognee_batch: list[dict] = []
    for seed in seeds:
        incident_id = str(uuid.uuid4())
        text = seed["text"]
        await incident_store.save(
            incident_id, text,
            source_url=seed.get("source_url"),
            source_repo=seed.get("source_repo"),
        )
        await loop.run_in_executor(None, rag_service.remember, text, incident_id)
        await loop.run_in_executor(None, hybrid_rag_service.remember, text, incident_id)
        cognee_batch.append({
            "incident_id": incident_id,
            "text": text,
            "source_url": seed.get("source_url"),
        })

    print(f"[startup] {len(seeds)} incidents in RAG + Hybrid. Seeding Cognee graph (idempotent)...")
    try:
        mapping = await cognee_service.seed_bulk(cognee_batch)
        if mapping:
            await incident_store.set_cognee_data_ids(mapping)
        print(f"[startup] Seed complete — Cognee ingested {len(mapping)} incidents.")
    except Exception as e:
        print(f"[startup] Cognee seed failed (RAG/Hybrid still seeded): {e}")


app = FastAPI(
    title="RunbookOS API",
    description="DevOps incident memory — powered by Cognee graph memory + Groq",
    version="1.0.0",
    lifespan=lifespan,
)

_cors_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws/events")
async def websocket_endpoint(ws: WebSocket):
    await emitter.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        emitter.disconnect(ws)
    except Exception:
        emitter.disconnect(ws)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "incidents": await incident_store.count(),
        "rag_indexed": rag_service.count(),
    }


@app.post("/incidents", response_model=FeedIncidentResponse)
async def feed_incident(body: FeedIncidentRequest):
    incident_id = str(uuid.uuid4())
    text = body.text.strip()

    await incident_store.save(incident_id, text)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, rag_service.remember, text, incident_id)
    await loop.run_in_executor(None, hybrid_rag_service.remember, text, incident_id)

    asyncio.create_task(cognee_service.remember(incident_id, text))

    return FeedIncidentResponse(incident_id=incident_id, status="processing")


def _extract_symptom(body: WebhookPayload) -> str:
    if body.alerts:
        parts = []
        for alert in body.alerts[:3]:
            labels = alert.get("labels", {})
            annotations = alert.get("annotations", {})
            name = labels.get("alertname", "")
            svc  = labels.get("service", labels.get("job", ""))
            sev  = labels.get("severity", "")
            summary = annotations.get("summary", "")
            desc    = annotations.get("description", "")

            line = " ".join(filter(None, [
                f"[{sev.upper()}]" if sev else "",
                name,
                f"on {svc}" if svc else "",
                f"— {summary}" if summary else "",
                f"({desc[:120]})" if desc and not summary else "",
            ]))
            if line.strip():
                parts.append(line.strip())
        if parts:
            return "\n".join(parts)

    if body.symptom:
        return body.symptom.strip()

    if body.summary or body.description:
        return " — ".join(filter(None, [body.summary, body.description])).strip()

    if body.text:
        return body.text.strip()

    return "Unstructured alert received via webhook"


@app.post("/ingest/webhook", response_model=WebhookResponse)
async def ingest_webhook(body: WebhookPayload):
    symptom = _extract_symptom(body)
    source = body.source or "webhook"
    text = f"[{source}] {symptom}"

    incident_id = str(uuid.uuid4())

    await incident_store.save(incident_id, text)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, rag_service.remember, text, incident_id)
    await loop.run_in_executor(None, hybrid_rag_service.remember, text, incident_id)

    asyncio.create_task(cognee_service.remember(incident_id, text))

    return WebhookResponse(incident_id=incident_id, symptom=symptom)


@app.post("/runbook")
async def generate_runbook(body: RunbookRequest):
    symptom = body.symptom.strip()
    total = await incident_store.count()

    cognee_results = await cognee_service.recall(symptom, animate=body.animate)
    runbook = await runbook_synth.synthesize(symptom, cognee_results, total)

    # Attach real cause->effect edges from the Cognee graph (GraphRAG differentiator)
    try:
        runbook.causal_links = await cognee_service.get_causal_chain(symptom)
    except Exception as e:
        print(f"[runbook] causal chain failed: {e}")

    metrics_store.metrics.record_recall(cognee_ms=0)

    return runbook


@app.post("/incidents/{incident_id}/resolve", response_model=ResolveResponse)
async def resolve_incident(incident_id: str, body: ResolveRequest):
    record = await incident_store.get(incident_id)
    if record:
        await incident_store.mark_resolved(incident_id, body.steps)

    asyncio.create_task(cognee_service.improve(incident_id, body.steps))

    return ResolveResponse(status="ok", edges_updated=len(body.steps))


@app.delete("/incidents/{incident_id}", response_model=DeleteResponse)
async def delete_incident(incident_id: str):
    # Fetch the record FIRST — we need its Cognee data_id before removing it from the store
    record = await incident_store.get(incident_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")
    data_id = record.cognee_data_id

    await incident_store.delete(incident_id)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, rag_service.delete, incident_id)
    await loop.run_in_executor(None, hybrid_rag_service.delete, incident_id)
    cognee_service.invalidate_graph_cache()
    asyncio.create_task(cognee_service.forget(incident_id, data_id))

    return DeleteResponse(status="ok", incident_id=incident_id)


@app.get("/incidents")
async def list_incidents():
    incidents = await incident_store.get_all()
    return {"incidents": [i.model_dump() for i in incidents]}


@app.get("/graph")
async def get_graph(refresh: bool = False):
    return await cognee_service.get_graph(force_refresh=refresh)


@app.get("/patterns")
async def get_patterns():
    raw = await cognee_service.get_patterns()

    import re as _re

    def _parse_text(text: str) -> list[str]:
        """Extract clean insight strings from Cognee response text.

        Handles plain prose, bullet lists, and markdown tables (| col | col |).
        Returns up to 5 insights, each ≤ 200 chars.
        """
        results: list[str] = []
        lines = text.strip().split("\n")

        # Detect markdown table: header row + separator row + data rows
        # Collect table rows first, then process as data
        table_rows: list[list[str]] = []
        in_table = False
        header_cols: list[str] = []

        prose_lines: list[str] = []

        for line in lines:
            stripped = line.strip()
            if not stripped:
                in_table = False
                continue

            is_table_row = stripped.startswith("|") and stripped.endswith("|")
            is_separator = _re.match(r"^\|[-| :]+\|$", stripped)

            if is_table_row and not is_separator:
                cols = [c.strip() for c in stripped.strip("|").split("|")]
                if not header_cols:
                    header_cols = cols  # first data row = header
                else:
                    table_rows.append(cols)
                in_table = True
            elif is_separator:
                in_table = True  # skip separator lines
            else:
                in_table = False
                prose_lines.append(stripped)

        # Convert table rows to insights: "Service: root-cause — failure pattern"
        svc_idx = next((i for i, h in enumerate(header_cols) if "service" in h.lower()), 0)
        cause_idx = next((i for i, h in enumerate(header_cols) if "cause" in h.lower() or "root" in h.lower()), 1)
        pattern_idx = next((i for i, h in enumerate(header_cols) if "pattern" in h.lower() or "failure" in h.lower()), 2)

        for row in table_rows:
            if len(row) < 2:
                continue
            svc = row[svc_idx] if svc_idx < len(row) else ""
            cause = row[cause_idx] if cause_idx < len(row) else ""
            pat = row[pattern_idx] if pattern_idx < len(row) else ""
            # Clean up markdown bold inside cells
            svc = _re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", svc).strip()
            cause = _re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", cause).strip()
            pat = _re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", pat).strip()
            parts = [p for p in [svc, cause, pat] if p]
            if parts:
                insight = " — ".join(parts)
                results.append(insight[:200])
            if len(results) >= 5:
                return results

        # Fall back to prose/bullet lines if table produced nothing
        current_service = None
        for line in prose_lines:
            stripped = line.strip()
            if stripped.startswith("[incident:") or stripped.startswith("[resolution:"):
                continue

            svc_match = _re.match(r"^[-*]\s+\*{1,2}([^*:]+)\*{0,2}:?\s*$", stripped)
            if svc_match:
                current_service = svc_match.group(1).strip()
                continue

            content = _re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", stripped)
            content = _re.sub(r"^[-*#]\s+", "", content)
            content = content.replace("`", "").strip()
            content = " ".join(content.split())

            if len(content) < 20:
                continue

            if current_service and not content.lower().startswith(current_service.lower()):
                insight = f"{current_service}: {content}"
            else:
                insight = content

            results.append(insight[:200])
            if len(results) >= 5:
                return results

        return results

    patterns = []
    for result in raw[:5]:
        text = ""
        if isinstance(result, dict):
            text = result.get("text") or result.get("answer") or str(result)
        elif hasattr(result, "text"):
            text = result.text
        elif hasattr(result, "answer"):
            text = result.answer
        else:
            text = str(result)

        if not text.strip():
            continue

        for insight in _parse_text(text):
            patterns.append({"insight": insight})
            if len(patterns) >= 5:
                break

        if len(patterns) >= 5:
            break

    return {"patterns": patterns, "total_incidents": await incident_store.count()}


@app.get("/metrics")
async def get_metrics():
    d = metrics_store.metrics.to_dict()
    graph = await cognee_service.get_graph()
    d["total_nodes"] = len(graph.get("nodes", []))
    d["total_edges"] = len(graph.get("edges", []))
    return d


@app.post("/compare")
async def compare(body: RunbookRequest):
    result = await comparison_runner.compare(body.symptom.strip(), animate=body.animate)
    metrics_store.metrics.record_comparison(
        cognee_ms=result.metrics.cognee_response_ms,
        rag_ms=result.metrics.rag_response_ms,
    )
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=False,
    )
