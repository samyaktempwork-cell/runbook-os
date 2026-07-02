from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class NodeType(str, Enum):
    SERVICE = "service"
    ERROR = "error"
    STEP = "step"
    OUTCOME = "outcome"
    PATTERN = "pattern"


class EventType(str, Enum):
    # LEARN — emitted after cognify() completes
    ENTITY_FOUND = "entity_found"
    RELATIONSHIP_FOUND = "relationship_found"
    REMEMBER_COMPLETE = "remember_complete"
    # RECALL — emitted during/after search
    RECALL_START = "recall_start"
    TRAVERSAL_STEP = "traversal_step"
    PATH_FOUND = "path_found"
    RUNBOOK_STEP = "runbook_step"
    RECALL_COMPLETE = "recall_complete"
    # IMPROVE — emitted after resolution feedback is cognified
    EDGE_UPDATED = "edge_updated"
    NODE_PULSE = "node_pulse"
    IMPROVE_COMPLETE = "improve_complete"
    # FORGET — emitted after incident is removed from local indexes
    FORGET_COMPLETE = "forget_complete"
    # General
    PROCESSING_START = "processing_start"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Graph primitives (emitted over WebSocket to drive D3 animation)
# ---------------------------------------------------------------------------

class GraphNode(BaseModel):
    id: str
    label: str
    type: NodeType
    confidence: float = 1.0       # 0-1 → drives node opacity
    incident_count: int = 1        # → drives node size


class GraphEdge(BaseModel):
    source: str
    target: str
    label: str                     # "caused", "resolved_by", "success_rate", "took"
    weight: float = 1.0            # 0-1 → drives edge thickness


# ---------------------------------------------------------------------------
# REST request / response models
# ---------------------------------------------------------------------------

class FeedIncidentRequest(BaseModel):
    text: str = Field(..., min_length=10, description="Raw incident description, Slack thread, post-mortem")


class FeedIncidentResponse(BaseModel):
    incident_id: str
    status: str = "processing"     # cognify() runs async after response is returned


class RunbookRequest(BaseModel):
    symptom: str = Field(..., min_length=5, description="Describe current symptom in plain English")
    animate: bool = True   # when False, skip traversal stagger delays for faster response


class StepOutcome(BaseModel):
    step: int
    description: str
    worked: bool


class ResolveRequest(BaseModel):
    steps: list[StepOutcome]


class ResolveResponse(BaseModel):
    status: str = "ok"
    edges_updated: int


class DeleteResponse(BaseModel):
    status: str = "ok"
    incident_id: str


# ---------------------------------------------------------------------------
# Incident store models (local JSON persistence for UI timeline)
# ---------------------------------------------------------------------------

class IncidentRecord(BaseModel):
    incident_id: str
    text: str
    timestamp: str
    resolved: bool = False
    resolution_steps: list[StepOutcome] = []
    source_url: Optional[str] = None    # original GitHub issue URL (real incidents)
    source_repo: Optional[str] = None   # e.g. "redis/redis"
    cognee_data_id: Optional[str] = None  # Cognee Cloud data item UUID — enables real per-doc FORGET


class RunbookStep(BaseModel):
    step: int
    description: str
    command: Optional[str] = None
    confidence: float
    branch_condition: Optional[str] = None  # "if X > threshold → Step N; else → Step M"
    pitfall: Optional[str] = None           # common mistake at this specific step


class Runbook(BaseModel):
    runbook_id: str
    incident_type: str
    symptom: str
    steps: list[RunbookStep]
    pattern: Optional[str] = None
    matched_incidents: int = 0
    pitfalls: list[str] = []               # cross-incident pitfalls from graph patterns
    source_incident_urls: list[str] = []   # source GitHub URLs of matched real incidents
    causal_links: list[str] = []           # real cause->effect edges from the Cognee graph


# ---------------------------------------------------------------------------
# Comparison models
# ---------------------------------------------------------------------------

class RAGResult(BaseModel):
    chunks: list[str]                    # raw text chunks returned by the retriever
    summary: Optional[str] = None        # (legacy) prose synthesis — kept for back-compat
    response_time_ms: int
    runbook: Optional["Runbook"] = None  # structured runbook — SAME synthesizer as Cognee tier


class TierMetrics(BaseModel):
    name: str                      # "Plain RAG" | "Enhanced VectorDB" | "GraphRAG (Cognee)"
    response_ms: int
    # Measured identically for every tier (all run the same structured synthesizer)
    confident_steps: int = 0       # steps with confidence >= 0.5
    patterns_found: int = 0        # cross-incident pattern identified this run (0/1)
    step_ranking: bool = False     # produced confidence-ordered steps
    # Inherent capability of the retrieval method (not a per-run score)
    learns_from_use: bool = False  # resolution feedback is re-cognified into memory
    cross_incident: bool = False   # retrieves via graph traversal across incidents


class ComparisonMetrics(BaseModel):
    rag_response_ms: int
    hybrid_response_ms: int = 0
    cognee_response_ms: int
    # Per-tier structured metrics for the 3-column UI (all measured identically)
    tiers: list[TierMetrics] = []


class CompareResponse(BaseModel):
    rag: RAGResult                 # Tier 1 — vector similarity + structured runbook
    hybrid: RAGResult              # Tier 2 — BM25 + reranker + structured runbook
    runbook: Runbook               # Tier 3 — Cognee GraphRAG structured runbook
    metrics: ComparisonMetrics


# ---------------------------------------------------------------------------
# Webhook ingest model
# ---------------------------------------------------------------------------

class WebhookPayload(BaseModel):
    """
    Flexible webhook payload — accepts AlertManager, generic, or plain-text formats.
    The endpoint extracts a human-readable symptom string from whichever fields are present.
    """
    # AlertManager / Prometheus format
    alerts: Optional[list[dict]] = None
    # Generic format
    symptom: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    text: Optional[str] = None
    # Source label shown in the timeline
    source: Optional[str] = "webhook"


class WebhookResponse(BaseModel):
    incident_id: str
    symptom: str          # extracted symptom text shown back to caller
    status: str = "processing"


# ---------------------------------------------------------------------------
# Pattern model
# ---------------------------------------------------------------------------

class Pattern(BaseModel):
    root_cause: str                # e.g. "Redis memory exhaustion"
    incident_count: int            # how many incidents share this root cause
    total_incidents: int           # total incidents in memory
    avg_resolution_min: float
    most_recent: str               # ISO 8601 of most recent incident with this pattern
    related_services: list[str]    # services affected by this root cause
