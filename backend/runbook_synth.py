"""Runbook synthesis — Groq Llama 3.3-70B over Cognee graph traversal results."""

import os
import re
import json
import uuid
from openai import OpenAI
from graph_events import emitter
from schemas import Runbook, RunbookStep

_client: OpenAI | None = None

SYNTHESIS_MODEL = os.environ.get("SYNTHESIS_LLM_MODEL", "llama-3.3-70b-versatile")


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.environ["GROQ_API_KEY"],
            base_url="https://api.groq.com/openai/v1",
        )
    return _client

SYSTEM_PROMPT = """You are a senior SRE generating structured incident runbooks from a knowledge graph of real past incidents.

Rules:
- Generate 4-6 steps minimum — triage, diagnose, fix, verify, monitor
- Steps must be actionable, specific, ordered by confidence (highest first)
- Include exact CLI commands where applicable — use real command names, not placeholders like <service>
- branch_condition: when the next action depends on a check result, write "if X → Step N; else → Step M" (null if unconditional)
- pitfall: one common mistake at this step from past incidents (null if none)
- pitfalls array: 1-3 cross-incident patterns that wasted time across multiple past incidents
- matched_incidents: count of past incidents that informed this runbook
- Return ONLY valid JSON, no markdown wrapping"""

USER_PROMPT_TEMPLATE = """Current symptom: {symptom}

Knowledge graph results from {incident_count} real OSS incidents:
{graph_context}

Return this exact JSON:
{{
  "incident_type": "short label e.g. Redis OOM → Payment 504s",
  "steps": [
    {{
      "step": 1,
      "description": "Specific action with context",
      "command": "exact command or null",
      "confidence": 0.94,
      "branch_condition": "if redis_memory > 80% → Step 2; else check connection pool (Step 4)",
      "pitfall": "Engineers often restart the service first — this clears symptoms without fixing root cause"
    }}
  ],
  "pattern": "Recurring pattern if root cause appears in 3+ incidents, else null",
  "matched_incidents": 4,
  "pitfalls": [
    "Cross-incident pitfall 1 that wasted time across multiple incidents",
    "Cross-incident pitfall 2"
  ],
}}"""


def _format_graph_context(results: list) -> str:
    if not results:
        return "No prior incidents found matching this symptom."

    lines = []
    for i, result in enumerate(results[:8], 1):
        if isinstance(result, dict):
            text = result.get("text") or result.get("answer") or result.get("content", "")
            score = result.get("score") or result.get("confidence") or 0.75
        elif hasattr(result, "text"):
            text = result.text
            score = getattr(result, "score", None) or 0.75
        elif hasattr(result, "answer"):
            text = result.answer
            score = getattr(result, "score", None) or 0.75
        elif hasattr(result, "content"):
            text = result.content
            score = getattr(result, "score", None) or 0.75
        else:
            text = str(result)
            score = 0.75

        if text and text.strip():
            score_val = float(score) if score else 0.75
            lines.append(f"[{i}] (relevance: {score_val:.2f}) {text.strip()[:350]}")

    return "\n".join(lines) if lines else "No structured context found — using symptom-based inference."


_ISSUE_REF_RE = re.compile(r'\[([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)\s+#(\d+)\]')
_GH_URL_RE = re.compile(r'Source:\s*(https://github\.com/[^\s\]]+)')

def _extract_source_urls(results: list) -> list[str]:
    """Pull GitHub source URLs from Cognee result texts.

    Handles both explicit 'Source: https://...' annotations and
    the [owner/repo #issue] shorthand format used in seed incident texts.
    """
    urls: list[str] = []
    seen: set[str] = set()

    def _add(url: str):
        url = url.rstrip('.,)')
        if url not in seen:
            seen.add(url)
            urls.append(url)

    for result in results:
        text = ""
        if isinstance(result, dict):
            text = result.get("text") or result.get("answer") or ""
        elif hasattr(result, "text"):
            text = result.text or ""
        elif hasattr(result, "answer"):
            text = result.answer or ""
        else:
            text = str(result)

        for m in _GH_URL_RE.findall(text):
            _add(m)
        for repo, num in _ISSUE_REF_RE.findall(text):
            _add(f"https://github.com/{repo}/issues/{num}")

    return urls[:5]


def _adjust_confidence(base: float, matched: int, total: int, has_real_source: bool) -> float:
    """
    Concrete confidence formula:
      base_score × match_weight × source_boost

    match_weight: 0.7 + 0.3 × min(matched / max(total * 0.1, 1), 1.0)
      — saturates at 1.0 when matched incidents = 10% of corpus
    source_boost: 1.08 for real GitHub incidents, 1.0 for synthetic
    """
    match_weight = 0.7 + 0.3 * min(matched / max(total * 0.1, 1), 1.0)
    source_boost = 1.08 if has_real_source else 1.0
    return round(min(base * match_weight * source_boost, 0.99), 3)


async def synthesize(symptom: str, cognee_results: list, incident_count: int, emit: bool = True) -> Runbook:
    """Synthesize a structured runbook from retrieved context.

    emit=True fires runbook_step/recall_complete WebSocket events (live ASK flow).
    emit=False stays silent — used by the 3-tier COMPARE so the RAG/Hybrid tiers
    (which run the SAME synthesizer, only with different retrieval) don't collide on
    the graph animation. Same prompt, same model, same output schema for every tier.
    """
    graph_context = _format_graph_context(cognee_results)
    source_urls_from_context = _extract_source_urls(cognee_results)
    has_real_source = len(source_urls_from_context) > 0

    prompt = USER_PROMPT_TEMPLATE.format(
        symptom=symptom,
        graph_context=graph_context,
        incident_count=incident_count,
    )

    try:
        message = _get_client().chat.completions.create(
            model=SYNTHESIS_MODEL,
            max_tokens=2000,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        )

        raw = message.choices[0].message.content.strip()

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        data = json.loads(raw)
        matched = int(data.get("matched_incidents", 0))

        steps = [
            RunbookStep(
                step=s["step"],
                description=s["description"],
                command=s.get("command"),
                confidence=_adjust_confidence(
                    float(s.get("confidence", 0.7)),
                    matched,
                    incident_count,
                    has_real_source,
                ),
                branch_condition=s.get("branch_condition") or None,
                pitfall=s.get("pitfall") or None,
            )
            for s in data.get("steps", [])
        ]

        if emit:
            for step in steps:
                await emitter.runbook_step(
                    step=step.step,
                    text=step.description,
                    confidence=step.confidence,
                    command=step.command,
                )
            await emitter.recall_complete(total_steps=len(steps))

        # Only use URLs we physically extracted from incident texts — LLM URLs are unreliable
        all_urls = source_urls_from_context[:6]

        return Runbook(
            runbook_id=str(uuid.uuid4()),
            incident_type=data.get("incident_type", "Unknown Incident Type"),
            symptom=symptom,
            steps=steps,
            pattern=data.get("pattern"),
            matched_incidents=matched,
            pitfalls=data.get("pitfalls") or [],
            source_incident_urls=all_urls,
        )

    except json.JSONDecodeError:
        fallback_steps = _fallback_runbook_steps(symptom)
        if emit:
            for step in fallback_steps:
                await emitter.runbook_step(
                    step=step.step,
                    text=step.description,
                    confidence=step.confidence,
                    command=step.command,
                )
            await emitter.recall_complete(total_steps=len(fallback_steps))
        return Runbook(
            runbook_id=str(uuid.uuid4()),
            incident_type="General Investigation",
            symptom=symptom,
            steps=fallback_steps,
            pattern=None,
            matched_incidents=0,
            pitfalls=[],
            source_incident_urls=[],
        )


def _fallback_runbook_steps(symptom: str) -> list[RunbookStep]:
    return [
        RunbookStep(
            step=1,
            description="Check service logs for errors in the last 30 minutes",
            command="kubectl logs -l app=<service> --since=30m | tail -100",
            confidence=0.6,
        ),
        RunbookStep(
            step=2,
            description="Check resource utilisation — CPU, memory, disk",
            command="kubectl top pods -n <namespace>",
            confidence=0.6,
        ),
        RunbookStep(
            step=3,
            description="Check recent deployments for regressions",
            command="kubectl rollout history deployment/<name>",
            confidence=0.55,
        ),
        RunbookStep(
            step=4,
            description="Check upstream dependencies for health",
            command=None,
            confidence=0.5,
        ),
    ]
