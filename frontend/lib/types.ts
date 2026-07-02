// TypeScript types — mirror backend schemas.py exactly
// If backend schema changes, update here too.

export type NodeType = 'service' | 'error' | 'step' | 'outcome' | 'pattern'

export type AnimationMode = 'idle' | 'learn' | 'recall' | 'improve'

// ---------------------------------------------------------------------------
// Graph primitives
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string
  label: string
  type: NodeType
  confidence: number      // 0-1 → opacity
  incident_count: number  // → node size
  // Added by react-force-graph at runtime (do not set manually)
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export interface GraphEdge {
  source: string
  target: string
  label: string
  weight: number          // 0-1 → edge thickness
}

// ---------------------------------------------------------------------------
// WebSocket events (from backend graph_events.py)
// ---------------------------------------------------------------------------

export type GraphEvent =
  | { event: 'entity_found';       node: { id: string; type: NodeType; label: string; confidence: number; incident_count: number } }
  | { event: 'relationship_found'; edge: { source: string; target: string; label: string; weight: number } }
  | { event: 'remember_complete';  stats: { nodes_added: number; edges_added: number } }
  | { event: 'recall_start';       query: string }
  | { event: 'traversal_step';     node: string; confidence: number }
  | { event: 'path_found';         path: string[] }
  | { event: 'runbook_step';       step: number; text: string; command: string | null; confidence: number }
  | { event: 'recall_complete';    total_steps: number }
  | { event: 'edge_updated';       edge: string; weight: number; direction: 'up' | 'down' }
  | { event: 'node_pulse';         node: string; color: 'green' | 'red' }
  | { event: 'improve_complete' }
  | { event: 'forget_complete';    incident_id: string }
  | { event: 'processing_start';   incident_id: string }
  | { event: 'error';              message: string }

// ---------------------------------------------------------------------------
// REST API types
// ---------------------------------------------------------------------------

export interface IncidentRecord {
  incident_id: string
  text: string
  timestamp: string
  resolved: boolean
  resolution_steps: StepOutcome[]
  source_url?: string
  source_repo?: string
}

export interface RunbookStep {
  step: number
  description: string
  command: string | null
  confidence: number
  branch_condition?: string | null
  pitfall?: string | null
}

export interface Runbook {
  runbook_id: string
  incident_type: string
  symptom: string
  steps: RunbookStep[]
  pattern: string | null
  matched_incidents: number
  pitfalls: string[]
  source_incident_urls: string[]
  causal_links?: string[]   // real cause->effect edges from the Cognee graph
}

export interface StepOutcome {
  step: number
  description: string
  worked: boolean
}

export interface RAGChunk {
  text: string
  score: number   // cosine similarity 0-1
}

export interface RAGResult {
  chunks: string[]
  summary?: string        // legacy prose synthesis — kept for back-compat
  response_time_ms: number
  runbook?: Runbook       // structured runbook — SAME synthesizer as Cognee tier
}

export interface TierMetrics {
  name: string               // "Plain RAG" | "Enhanced VectorDB" | "GraphRAG (Cognee)"
  response_ms: number
  confident_steps: number    // steps with confidence >= 0.5 (measured identically)
  patterns_found: number     // cross-incident pattern identified this run (0/1)
  step_ranking: boolean      // produced confidence-ordered steps
  learns_from_use: boolean   // capability: resolution feedback re-cognified
  cross_incident: boolean    // capability: graph traversal across incidents
}

export interface ComparisonMetrics {
  rag_response_ms: number
  hybrid_response_ms: number
  cognee_response_ms: number
  tiers: TierMetrics[]
}

export interface CompareResponse {
  rag: RAGResult
  hybrid: RAGResult
  runbook: Runbook
  metrics: ComparisonMetrics
}

export interface Pattern {
  insight: string
}

export interface SessionMetrics {
  incidents_fed: number
  runbooks_generated: number
  total_nodes: number
  total_edges: number
  avg_cognee_response_ms: number
  avg_rag_response_ms: number
}
