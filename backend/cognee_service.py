"""Cognee Cloud REST client — graph memory (remember / recall / improve / forget)."""

import asyncio
import os
import re
import httpx
from graph_events import emitter
from schemas import NodeType

COGNEE_CLOUD_BASE = os.environ.get(
    "COGNEE_CLOUD_BASE",
    "https://tenant-cbcb5876-2045-42a7-b192-1b408acfb8a1.aws.cognee.ai",
)
INCIDENTS_DATASET = "runbook_incidents"
_dataset_id_cache: str | None = None

_HEADERS: dict | None = None


def _get_headers() -> dict:
    global _HEADERS
    if _HEADERS is None:
        api_key = os.environ["COGNEE_API_KEY"]
        _HEADERS = {"X-Api-Key": api_key, "Content-Type": "application/json"}
    return _HEADERS

# Shared async client — reused across all requests
_client: httpx.AsyncClient | None = None

# In-memory graph cache — populated on first /graph call, invalidated on new incident
_graph_cache: dict | None = None
# label → node_id lookup for traversal matching
_label_to_id: dict[str, str] = {}


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=COGNEE_CLOUD_BASE,
            headers=_get_headers(),
            timeout=120.0,   # cognify can take ~30s on cloud
            follow_redirects=True,
        )
    return _client


# ---------------------------------------------------------------------------
# Setup — no local config needed, cloud handles everything
# ---------------------------------------------------------------------------

async def _get_dataset_id() -> str:
    global _dataset_id_cache
    if _dataset_id_cache:
        return _dataset_id_cache
    client = _get_client()
    for url in ["/api/v1/datasets/", "/api/v1/datasets"]:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            datasets = resp.json()
            # datasets may be a list or {"datasets": [...]}
            if isinstance(datasets, dict):
                datasets = datasets.get("datasets", [])
            for ds in datasets:
                name = ds.get("name") or ds.get("dataset_name") or ""
                if name == INCIDENTS_DATASET:
                    _dataset_id_cache = (
                        ds.get("id") or ds.get("dataset_id") or ds.get("uuid") or ""
                    )
                    if _dataset_id_cache:
                        print(f"[cognee-cloud] Dataset '{INCIDENTS_DATASET}' id={_dataset_id_cache}")
                        return _dataset_id_cache
            # Dataset not found yet — print what we got for debugging
            print(f"[cognee-cloud] Datasets list ({url}): {[d.get('name') for d in datasets]}")
            break
        except Exception as e:
            print(f"[cognee-cloud] _get_dataset_id() {url} failed: {e}")
    # fallback: env var override
    _dataset_id_cache = os.environ.get("COGNEE_DATASET_ID", "")
    if _dataset_id_cache:
        print(f"[cognee-cloud] Using COGNEE_DATASET_ID env var: {_dataset_id_cache}")
    return _dataset_id_cache


async def setup_cognee():
    client = _get_client()
    resp = await client.get("/health")
    resp.raise_for_status()
    print(f"[cognee-cloud] Connected to {COGNEE_CLOUD_BASE} — {resp.json()}")


# ---------------------------------------------------------------------------
# GRAPH: fetch real Cognee knowledge graph for the UI
# ---------------------------------------------------------------------------

# EntityType label → our NodeType
# Derived from actual Cognee EntityType labels observed in runbook_incidents graph
_ENTITY_TYPE_MAP: dict[str, NodeType] = {
    # SERVICE — infrastructure, systems, software
    "service":           NodeType.SERVICE,
    "database":          NodeType.SERVICE,
    "software":          NodeType.SERVICE,
    "component":         NodeType.SERVICE,
    "system":            NodeType.SERVICE,
    "cache":             NodeType.SERVICE,
    "server":            NodeType.SERVICE,
    "pod":               NodeType.SERVICE,
    "deployment":        NodeType.SERVICE,
    "namespace":         NodeType.SERVICE,
    "kubernetesobject":  NodeType.SERVICE,
    "kubernetes deployment": NodeType.SERVICE,
    "hardware":          NodeType.SERVICE,
    "broker":            NodeType.SERVICE,
    "topic":             NodeType.SERVICE,
    "partition":         NodeType.SERVICE,
    "consumergroup":     NodeType.SERVICE,
    "job":               NodeType.SERVICE,
    "domain":            NodeType.SERVICE,
    "group":             NodeType.SERVICE,
    "dataset":           NodeType.SERVICE,
    # ERROR — failures, root causes, codes
    "error":             NodeType.ERROR,
    "errorcode":         NodeType.ERROR,
    "exitcode":          NodeType.ERROR,
    "terminationreason": NodeType.ERROR,
    "rootcause":         NodeType.ERROR,
    "incident":          NodeType.ERROR,
    # STEP — actions, commands, config, process
    "action":            NodeType.STEP,
    "command":           NodeType.STEP,
    "processstep":       NodeType.STEP,
    "technique":         NodeType.STEP,
    "tool":              NodeType.STEP,
    "process":           NodeType.STEP,
    "configuration":     NodeType.STEP,
    "setting":           NodeType.STEP,
    "policyvalue":       NodeType.STEP,
    "parametergroup":    NodeType.STEP,
    "connectionpool":    NodeType.STEP,
    "memorylimit":       NodeType.STEP,
    "resourcelimit":     NodeType.STEP,
    "memorysize":        NodeType.STEP,
    "chunksize":         NodeType.STEP,
    # OUTCOME — results, metrics, states
    "event":             NodeType.OUTCOME,
    "condition":         NodeType.OUTCOME,
    "status":            NodeType.OUTCOME,
    "metric":            NodeType.OUTCOME,
    "duration":          NodeType.OUTCOME,
    "artifact":          NodeType.OUTCOME,
    # PATTERN — concepts, cross-cutting
    "concept":           NodeType.PATTERN,
    "person":            NodeType.PATTERN,
}

def _map_entity_type(entity_type_label: str) -> NodeType:
    return _ENTITY_TYPE_MAP.get(entity_type_label.lower().strip(), NodeType.SERVICE)


_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}', re.IGNORECASE)

def _readable_label(raw_label: str, props: dict) -> str:
    """If label is a UUID, derive a short readable name from description."""
    if not _UUID_RE.match(raw_label):
        return raw_label
    desc = props.get("description", "").strip()
    if not desc:
        return raw_label[:8]
    # "Incident where X..." → extract X
    m = re.match(r'[Ii]ncident (?:where |that |when |reporting )(.{4,})', desc)
    if m:
        phrase = m.group(1).split(".")[0].split(",")[0].strip()
        return phrase[:28].rsplit(" ", 1)[0] if len(phrase) > 28 else phrase
    # Otherwise take first sentence, truncate
    first = desc.split(".")[0].strip()
    if len(first) <= 30:
        return first
    return first[:28].rsplit(" ", 1)[0]


async def get_graph(force_refresh: bool = False) -> dict:
    """
    Fetch the real Cognee knowledge graph for runbook_incidents dataset.
    Returns {nodes, edges} in react-force-graph format.
    Caches the result — invalidated when a new incident is added.
    """
    global _graph_cache, _label_to_id

    if _graph_cache is not None and not force_refresh:
        return _graph_cache

    client = _get_client()
    try:
        dataset_id = await _get_dataset_id()
        if not dataset_id:
            print("[cognee-cloud] get_graph(): dataset ID unknown — returning empty graph")
            return {"nodes": [], "edges": []}
        resp = await client.get(f"/api/v1/datasets/{dataset_id}/graph")
        resp.raise_for_status()
        raw = resp.json()
    except Exception as e:
        print(f"[cognee-cloud] get_graph() failed: {e}")
        return {"nodes": [], "edges": []}

    raw_nodes = raw.get("nodes", [])
    raw_edges = raw.get("edges", [])

    # Build EntityType id → NodeType lookup
    entity_type_lookup: dict[str, NodeType] = {}
    for n in raw_nodes:
        if n.get("type") == "EntityType":
            label = n.get("label", "").lower()
            entity_type_lookup[n["id"]] = _map_entity_type(label)

    # Build id → entity_type for Entity nodes via edges (Entity -is_a-> EntityType)
    entity_to_type: dict[str, NodeType] = {}
    for e in raw_edges:
        if e.get("label") == "is_a":
            etype = entity_type_lookup.get(e.get("target", ""))
            if etype:
                entity_to_type[e.get("source", "")] = etype

    # Only keep Entity nodes (skip DocumentChunk, TextSummary, TextDocument, EntityType)
    nodes = []
    new_label_to_id: dict[str, str] = {}
    for n in raw_nodes:
        if n.get("type") != "Entity":
            continue
        nid = n["id"]
        raw_label = n.get("label", nid[:8])
        props = n.get("properties", {})
        label = _readable_label(raw_label, props)
        description = props.get("description", "")
        node_type = entity_to_type.get(nid, NodeType.SERVICE)

        nodes.append({
            "id": nid,
            "label": label,
            "type": node_type.value,
            "confidence": props.get("importance_weight", 0.8),
            "incident_count": max(1, int(props.get("topological_rank", 1))),
            "description": description,
        })
        new_label_to_id[label.lower()] = nid

    # Only keep edges between Entity nodes we kept
    kept_ids = {n["id"] for n in nodes}
    edges = []
    for e in raw_edges:
        src, tgt, lbl = e.get("source"), e.get("target"), e.get("label", "related_to")
        if src in kept_ids and tgt in kept_ids and lbl != "is_a":
            edges.append({
                "source": src,
                "target": tgt,
                "label": lbl,
                "weight": 0.7,
            })

    _graph_cache = {"nodes": nodes, "edges": edges}
    _label_to_id = new_label_to_id
    print(f"[cognee-cloud] Graph loaded: {len(nodes)} entity nodes, {len(edges)} edges")
    return _graph_cache


def invalidate_graph_cache():
    global _graph_cache
    _graph_cache = None


async def get_causal_chain(symptom: str, limit: int = 6) -> list[str]:
    """Real cause->effect edges from Cognee's graph for a symptom.

    Reads the ACTUAL Cognee knowledge graph (get_graph) and returns human-readable
    relationship triples ("source -> edge -> target") for edges incident to the
    entities matched from the symptom. These are genuine graph-derived causal links —
    vector similarity search has no equivalent, which is exactly the GraphRAG
    differentiator. Falls back to the most prominent edges if nothing matches.
    """
    graph = await get_graph()
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    if not edges:
        return []

    id_to_label = {n["id"]: n["label"] for n in nodes}

    matched: set[str] = {nid for nid, _ in _match_all_entities_in_text(symptom)}
    matched |= set(_match_symptom_seed_nodes(symptom))

    def _fmt(e: dict) -> str:
        s = id_to_label.get(e.get("source", ""), str(e.get("source", ""))[:8])
        t = id_to_label.get(e.get("target", ""), str(e.get("target", ""))[:8])
        lbl = str(e.get("label", "related_to")).replace("_", " ")
        return f"{s} → {lbl} → {t}"

    # Prefer edges touching a symptom-matched entity; else fall back to first edges
    ordered = [e for e in edges if e.get("source") in matched or e.get("target") in matched]
    if not ordered:
        ordered = edges

    chain: list[str] = []
    seen: set[str] = set()
    for e in ordered:
        line = _fmt(e)
        if line not in seen:
            seen.add(line)
            chain.append(line)
        if len(chain) >= limit:
            break
    return chain


# ---------------------------------------------------------------------------
# LEARN: add text + cognify (both complete synchronously on the cloud)
# ---------------------------------------------------------------------------

def _extract_data_id(add_text_response: dict) -> str | None:
    """Pull the Cognee data item UUID from an add_text response.

    Shape: {"data_ingestion_info": [{"data_id": "<uuid>", ...}], ...}
    The data_id is what enables real per-document FORGET later.
    """
    try:
        info = add_text_response.get("data_ingestion_info") or []
        if info and isinstance(info, list):
            return info[0].get("data_id")
    except (AttributeError, IndexError, KeyError):
        pass
    return None


async def _add_incident_text(incident_id: str, text: str, source_url: str | None = None) -> str | None:
    """POST add_text for one incident. Returns the Cognee data_id (no cognify here)."""
    text_for_cognee = text
    if source_url:
        text_for_cognee = f"{text}\nSource: {source_url}"
    resp = await _get_client().post("/api/v1/add_text", json={
        "textData": [f"[incident:{incident_id}]\n{text_for_cognee}"],
        "datasetName": INCIDENTS_DATASET,
    })
    resp.raise_for_status()
    return _extract_data_id(resp.json())


async def _cognify_dataset():
    """POST cognify for the shared dataset — builds/updates the cross-incident graph."""
    resp = await _get_client().post("/api/v1/cognify", json={
        "datasets": [INCIDENTS_DATASET],
    })
    resp.raise_for_status()


async def remember(incident_id: str, text: str, source_url: str | None = None) -> str | None:
    """
    Store incident text in Cognee Cloud.
    1. add_text   — ingests text into the dataset (fastembed + LanceDB on cloud)
    2. cognify    — extracts entities & builds knowledge graph
    Both return PipelineRunCompleted synchronously (cloud is fast).
    Returns the Cognee data_id (persisted so FORGET can delete the exact document).
    """
    await emitter.processing_start(incident_id)

    try:
        # Step 1: ingest into shared dataset — all incidents in one graph
        data_id = await _add_incident_text(incident_id, text, source_url)

        # Step 2: cognify — extracts entities and builds cross-incident graph
        await _cognify_dataset()

        # Persist the data_id so a later forget() can delete this exact document
        if data_id:
            try:
                import incident_store
                await incident_store.set_cognee_data_id(incident_id, data_id)
            except Exception as e:
                print(f"[cognee-cloud] could not persist data_id for {incident_id}: {e}")

        # Emit graph nodes from heuristic extraction for UI animation
        nodes = _extract_entities_from_text(text)
        node_ids = []
        for node in nodes[:6]:
            await emitter.entity_found(
                node_id=node["node_id"],
                label=node["label"],
                node_type=node["node_type"],
                confidence=node["confidence"],
            )
            node_ids.append(node["node_id"])

        for edge in _infer_edges(node_ids, text)[:8]:
            await emitter.relationship_found(**edge)

        await emitter.remember_complete(
            nodes_added=len(node_ids),
            edges_added=max(0, len(node_ids) - 1),
        )
        # Invalidate graph cache so next /graph call reflects the new incident
        invalidate_graph_cache()
        return data_id

    except Exception as e:
        await emitter.error(f"remember() failed: {str(e)}")
        raise


async def seed_bulk(incidents: list[dict]) -> dict[str, str]:
    """Idempotently seed many incidents into Cognee: per-incident add_text, then ONE cognify.

    incidents: list of {"incident_id", "text", "source_url"?}
    Returns {incident_id: data_id} for the items ingested (empty if skipped).
    Guard: if the Cognee graph already has entity nodes, skip (avoids duplicate seeding).
    """
    if not incidents:
        return {}

    # Idempotency guard — don't re-seed a dataset that already has a graph
    try:
        existing = await get_graph()
        if existing and len(existing.get("nodes", [])) > 0:
            print(f"[cognee-cloud] seed_bulk: graph already has "
                  f"{len(existing['nodes'])} nodes — skipping Cognee seed")
            return {}
    except Exception as e:
        print(f"[cognee-cloud] seed_bulk: graph check failed ({e}) — proceeding with seed")

    print(f"[cognee-cloud] seed_bulk: ingesting {len(incidents)} incidents (add_text)...")
    mapping: dict[str, str] = {}
    failed = 0
    for inc in incidents:
        try:
            data_id = await _add_incident_text(
                inc["incident_id"], inc["text"], inc.get("source_url")
            )
            if data_id:
                mapping[inc["incident_id"]] = data_id
        except Exception as e:
            failed += 1
            if failed <= 3:
                print(f"[cognee-cloud] seed_bulk: add_text failed for "
                      f"{inc['incident_id']}: {e}")

    print(f"[cognee-cloud] seed_bulk: {len(mapping)} ingested, {failed} failed — cognifying (single pass)...")
    try:
        await _cognify_dataset()
    except Exception as e:
        print(f"[cognee-cloud] seed_bulk: cognify failed: {e}")

    invalidate_graph_cache()
    print(f"[cognee-cloud] seed_bulk: complete — {len(mapping)} incidents in Cognee graph")
    return mapping


# ---------------------------------------------------------------------------
# RECALL: graph-aware search across all stored incidents
# ---------------------------------------------------------------------------

async def recall(symptom: str, animate: bool = True) -> list:
    """
    Search Cognee Cloud knowledge graph for relevant incidents.
    Uses GRAPH_COMPLETION — returns LLM-enriched context from the graph.

    animate=True:  staggered traversal_step events (node-by-node glow, ~80ms each)
    animate=False: all events fire instantly — faster response, highlights still shown
    """
    await emitter.recall_start(symptom)

    # Pre-light seed nodes matched from symptom words (before Cognee API responds)
    seed_ids = _match_symptom_seed_nodes(symptom)
    for nid in seed_ids:
        await emitter.traversal_step(nid, 0.6)
        if animate:
            await asyncio.sleep(0.07)

    client = _get_client()
    try:
        resp = await client.post("/api/v1/recall", json={
            "searchType": "GRAPH_COMPLETION",
            "query": symptom,
            "topK": 10,
            "datasets": [INCIDENTS_DATASET],
        })
        resp.raise_for_status()
        results = resp.json()

        path_nodes: list[str] = []
        seen_ids: set[str] = set(seed_ids)

        for result in results:
            text = result.get("text", "") if isinstance(result, dict) else str(result)
            confidence = float(result.get("score") or 0.75)
            matched = _match_all_entities_in_text(text)
            for nid, _ in matched:
                if nid not in seen_ids:
                    await emitter.traversal_step(nid, confidence)
                    if animate:
                        await asyncio.sleep(0.08)
                    path_nodes.append(nid)
                    seen_ids.add(nid)

        all_path = seed_ids + path_nodes
        if all_path:
            await emitter.path_found(all_path)

        return results

    except Exception as e:
        await emitter.error(f"recall() failed: {str(e)}")
        raise


# ---------------------------------------------------------------------------
# IMPROVE: store resolution feedback
# ---------------------------------------------------------------------------

async def improve(incident_id: str, step_outcomes: list):
    """Store resolution outcomes so future recalls consider what worked."""
    lines = ["Resolution outcomes:"]
    for s in step_outcomes:
        weight = 0.92 if s.worked else 0.15
        outcome = "WORKED — high confidence, repeat" if s.worked else "DID NOT WORK — low confidence, deprioritise"
        lines.append(
            f"Step {s.step}: {s.description} — {outcome} "
            f"[weight:{_slugify(s.description[:30])}:{weight:.2f}]"
        )

    feedback_text = "\n".join(lines)
    dataset_name = f"{incident_id}_resolution"

    client = _get_client()
    try:
        # Store resolution feedback in the same shared dataset
        resp = await client.post("/api/v1/add_text", json={
            "textData": [f"[resolution:{incident_id}]\n{feedback_text}"],
            "datasetName": INCIDENTS_DATASET,
        })
        resp.raise_for_status()

        resp = await client.post("/api/v1/cognify", json={
            "datasets": [INCIDENTS_DATASET],
        })
        resp.raise_for_status()

        for s in step_outcomes:
            weight = 0.9 if s.worked else 0.2
            edge_id = f"step_{s.step}_{_slugify(s.description)}"
            await emitter.edge_updated(edge_id, weight, "up" if s.worked else "down")
            await emitter.node_pulse(edge_id, "green" if s.worked else "red")

        await emitter.improve_complete()

    except Exception as e:
        await emitter.error(f"improve() failed: {str(e)}")
        raise


# ---------------------------------------------------------------------------
# FORGET: remove incident from cloud graph
# ---------------------------------------------------------------------------

async def _find_data_id_by_marker(incident_id: str, dataset_id: str) -> str | None:
    """Fallback: locate a data item by its [incident:{id}] marker in the raw content.

    Used when an incident has no stored cognee_data_id (e.g. pre-existing seeds).
    Reads raw content per item, so only invoked when the direct id is unavailable.
    """
    if not dataset_id:
        return None
    client = _get_client()
    try:
        resp = await client.get(f"/api/v1/datasets/{dataset_id}/data")
        resp.raise_for_status()
        items = resp.json()
    except Exception as e:
        print(f"[cognee-cloud] _find_data_id_by_marker: list failed: {e}")
        return None
    marker = f"[incident:{incident_id}]"
    for it in items:
        did = it.get("id")
        if not did:
            continue
        try:
            raw = await client.get(f"/api/v1/datasets/{dataset_id}/data/{did}/raw")
            if marker in raw.text:
                return did
        except Exception:
            continue
    return None


async def forget(incident_id: str, data_id: str | None = None) -> bool:
    """
    Remove an incident from the Cognee graph via REAL per-document deletion.

    DELETE /api/v1/datasets/{dataset_id}/data/{data_id} removes the document and its
    graph contribution. Uses the stored Cognee data_id when available; otherwise falls
    back to locating the document by its [incident:{id}] marker.

    (Requires the document to have been cognified — true for all remember()/seed_bulk()
    incidents. dataset_id must be the UUID, not the name.)

    Returns True if the document was deleted from Cognee.
    """
    client = _get_client()
    dataset_id = await _get_dataset_id()

    if not data_id:
        data_id = await _find_data_id_by_marker(incident_id, dataset_id)

    deleted = False
    if data_id and dataset_id:
        try:
            resp = await client.delete(f"/api/v1/datasets/{dataset_id}/data/{data_id}")
            if resp.status_code == 200:
                deleted = True
                print(f"[cognee-cloud] forget({incident_id}): deleted data {data_id}")
            else:
                print(f"[cognee-cloud] forget({incident_id}): delete "
                      f"HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"[cognee-cloud] forget({incident_id}): delete failed: {e}")
    else:
        print(f"[cognee-cloud] forget({incident_id}): no Cognee data_id found — nothing to delete")

    # Pulse matched graph nodes red so the user sees them fade
    seed_nodes = _match_symptom_seed_nodes(incident_id[:20])
    for nid in seed_nodes[:3]:
        await emitter.node_pulse(nid, "red")

    invalidate_graph_cache()
    await emitter.forget_complete(incident_id)
    return deleted


# ---------------------------------------------------------------------------
# PATTERNS: surface recurring issues from the graph
# ---------------------------------------------------------------------------

async def get_patterns() -> list:
    client = _get_client()
    try:
        resp = await client.post("/api/v1/recall", json={
            "searchType": "GRAPH_COMPLETION",
            "query": "What are the most common root causes and failure patterns across Redis, Postgres, Nginx, and Kafka incidents in this dataset?",
            "topK": 5,
            "datasets": [INCIDENTS_DATASET],
        })
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Private helpers — heuristic graph extraction for UI animation
# ---------------------------------------------------------------------------

def _extract_entities_from_text(text: str) -> list[dict]:
    nodes = []
    t = text.lower()

    service_patterns = [
        r'\b(\w+-svc)\b', r'\b(\w+-api)\b', r'\b(\w+-service)\b', r'\b(\w+-gateway)\b',
        r'\b(redis)\b', r'\b(postgres)\b', r'\b(mysql)\b', r'\b(nginx)\b',
        r'\b(kafka)\b', r'\b(elasticsearch)\b', r'\b(mongodb)\b',
    ]
    for pattern in service_patterns:
        for match in re.findall(pattern, t):
            nodes.append({"node_id": _slugify(match), "label": match, "node_type": NodeType.SERVICE, "confidence": 0.9})

    error_patterns = [r'\b(oom)\b', r'\b(timeout)\b', r'\b(crash(?:ed)?)\b',
                      r'\b(exhausted)\b', r'\b(down)\b', r'\b(502)\b', r'\b(503)\b', r'\b(504)\b']
    for pattern in error_patterns:
        for match in re.findall(pattern, t):
            nodes.append({"node_id": _slugify(match), "label": match, "node_type": NodeType.ERROR, "confidence": 0.85})

    step_patterns = [r'\b(flush(?:ed)?)\b', r'\b(restart(?:ed)?)\b', r'\b(scale(?:d)?)\b',
                     r'\b(killed)\b', r'\b(rollback(?:ed)?)\b']
    for pattern in step_patterns:
        for match in re.findall(pattern, t):
            nodes.append({"node_id": _slugify(match), "label": match, "node_type": NodeType.STEP, "confidence": 0.8})

    seen: set[str] = set()
    unique = []
    for n in nodes:
        if n["node_id"] not in seen:
            seen.add(n["node_id"])
            unique.append(n)
    return unique[:8]


def _infer_edges(node_ids: list[str], text: str) -> list[dict]:
    edges = []
    t = text.lower()
    for i in range(len(node_ids) - 1):
        if any(w in t for w in ["caused", "due to", "led to"]):
            label = "caused"
        elif any(w in t for w in ["fix", "resolv", "restart", "flush", "kill", "rollback"]):
            label = "resolved_by"
        else:
            label = "related_to"
        edges.append({"source": node_ids[i], "target": node_ids[i + 1], "label": label, "weight": 0.8})
    return edges


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", text.lower().strip())[:40]


def _match_entity_in_text(text: str) -> str | None:
    """Single best match — kept for compat. Prefer _match_all_entities_in_text."""
    hits = _match_all_entities_in_text(text)
    return hits[0][0] if hits else None


def _match_all_entities_in_text(text: str) -> list[tuple[str, str]]:
    """
    Find ALL entity labels from _label_to_id that appear in text.
    Returns list of (node_id, label) sorted by label length desc (longest/most-specific first).
    A shorter label is suppressed if a longer label that contains it is already matched
    (e.g. 'redis-payment-01' suppresses 'redis').
    """
    if not _label_to_id:
        return []
    t = text.lower()
    matches: list[tuple[str, str]] = []  # (nid, label)
    for label, nid in _label_to_id.items():
        if label in t:
            matches.append((nid, label))
    # Sort by label length descending, then dedup node IDs
    matches.sort(key=lambda x: len(x[1]), reverse=True)
    seen_ids: set[str] = set()
    result: list[tuple[str, str]] = []
    for nid, label in matches:
        if nid in seen_ids:
            continue
        # Suppress if a longer label already matched this substring
        dominated = any(label in longer for _, longer in result)
        if not dominated:
            seen_ids.add(nid)
            result.append((nid, label))
    return result


def _match_symptom_seed_nodes(symptom: str) -> list[str]:
    """
    Quick fuzzy seed: split symptom into words, match against _label_to_id keys.
    Returns up to 5 node IDs to pre-light before the Cognee API response arrives.
    """
    if not _label_to_id:
        return []
    words = [w.lower() for w in symptom.split() if len(w) > 3]
    seed_ids: list[str] = []
    seen: set[str] = set()
    # First pass: full label matches
    for label, nid in _label_to_id.items():
        if nid in seen:
            continue
        if any(w in label for w in words):
            seed_ids.append(nid)
            seen.add(nid)
            if len(seed_ids) >= 5:
                break
    return seed_ids
