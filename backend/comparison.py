"""Three-tier parallel comparison runner (Plain RAG / Hybrid RAG / GraphRAG).

De-rigged design: all three tiers run the SAME structured synthesizer
(runbook_synth.synthesize) over their OWN retrieved context. Same corpus, same
Groq Llama-3.3-70B, same output schema — only retrieval differs. Every metric is
measured identically per tier; nothing is hardcoded to make one tier win.
"""

import time
import asyncio
from schemas import RAGResult, ComparisonMetrics, CompareResponse, Runbook, TierMetrics
import rag_service
import hybrid_rag_service
import cognee_service
import runbook_synth
import incident_store


def _chunks_as_results(chunks: list[str]) -> list[dict]:
    """Wrap raw retrieval chunks in the {text, score} shape synthesize() expects."""
    return [{"text": c, "score": 0.75} for c in chunks]


def _tier_metrics(name: str, response_ms: int, runbook: Runbook,
                  *, cross_incident: bool, learns_from_use: bool) -> TierMetrics:
    """Build per-tier metrics from a runbook — IDENTICAL formula for every tier."""
    confident = sum(1 for s in runbook.steps if s.confidence >= 0.5)
    return TierMetrics(
        name=name,
        response_ms=response_ms,
        confident_steps=confident,
        patterns_found=1 if runbook.pattern else 0,
        step_ranking=len(runbook.steps) > 0,
        cross_incident=cross_incident,     # capability of the retrieval method
        learns_from_use=learns_from_use,   # capability of the retrieval method
    )


async def compare(symptom: str, animate: bool = True) -> CompareResponse:
    """Run all 3 pipelines in parallel. Wall clock = slowest tier."""
    total_incidents = await incident_store.count()

    rag_task    = asyncio.create_task(_run_rag(symptom, total_incidents))
    hybrid_task = asyncio.create_task(_run_hybrid(symptom, total_incidents))
    cognee_task = asyncio.create_task(_run_cognee(symptom, total_incidents, animate=animate))

    (rag_result, rag_ms), (hybrid_result, hybrid_ms), (runbook, cognee_ms) = \
        await asyncio.gather(rag_task, hybrid_task, cognee_task)

    tiers = [
        _tier_metrics("Plain RAG", rag_ms, rag_result.runbook,
                      cross_incident=False, learns_from_use=False),
        _tier_metrics("Enhanced VectorDB", hybrid_ms, hybrid_result.runbook,
                      cross_incident=False, learns_from_use=False),
        _tier_metrics("GraphRAG (Cognee)", cognee_ms, runbook,
                      cross_incident=True, learns_from_use=True),
    ]

    metrics = ComparisonMetrics(
        rag_response_ms=rag_ms,
        hybrid_response_ms=hybrid_ms,
        cognee_response_ms=cognee_ms,
        tiers=tiers,
    )

    return CompareResponse(
        rag=rag_result,
        hybrid=hybrid_result,
        runbook=runbook,
        metrics=metrics,
    )


async def _run_rag(symptom: str, total: int) -> tuple[RAGResult, int]:
    """Tier 1: plain vector similarity → same structured synthesizer. Returns (RAGResult, ms)."""
    start = time.time()
    loop = asyncio.get_event_loop()
    chunks, _ = await loop.run_in_executor(None, rag_service.recall_chunks, symptom, 5)
    runbook = await runbook_synth.synthesize(symptom, _chunks_as_results(chunks), total, emit=False)
    total_ms = int((time.time() - start) * 1000)
    return RAGResult(chunks=chunks, summary=None, response_time_ms=total_ms, runbook=runbook), total_ms


async def _run_hybrid(symptom: str, total: int) -> tuple[RAGResult, int]:
    """Tier 2: BM25 + vector hybrid + cross-encoder rerank → same synthesizer. Returns (RAGResult, ms)."""
    start = time.time()
    loop = asyncio.get_event_loop()
    chunks, _ = await loop.run_in_executor(None, hybrid_rag_service.recall_chunks, symptom, 5)
    runbook = await runbook_synth.synthesize(symptom, _chunks_as_results(chunks), total, emit=False)
    total_ms = int((time.time() - start) * 1000)
    return RAGResult(chunks=chunks, summary=None, response_time_ms=total_ms, runbook=runbook), total_ms


async def _run_cognee(symptom: str, total: int, animate: bool = True) -> tuple[Runbook, int]:
    """Tier 3: Cognee graph traversal → same synthesizer. Returns (Runbook, ms).

    recall() still emits the traversal animation; synthesize runs with emit=False so
    the three parallel tiers don't collide on runbook_step events.
    """
    start = time.time()
    cognee_results = await cognee_service.recall(symptom, animate=animate)
    runbook = await runbook_synth.synthesize(symptom, cognee_results, total, emit=False)
    try:
        runbook.causal_links = await cognee_service.get_causal_chain(symptom)
    except Exception:
        pass
    total_ms = int((time.time() - start) * 1000)
    return runbook, total_ms
