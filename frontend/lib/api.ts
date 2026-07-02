// REST API client — all backend calls go through here

import type {
  IncidentRecord,
  Runbook,
  StepOutcome,
  CompareResponse,
  Pattern,
  SessionMetrics,
} from './types'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`POST ${path} failed: ${res.status} ${err}`)
  }
  return res.json()
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`)
  return res.json()
}

export const api = {
  /** Feed incident text to Cognee memory */
  feedIncident: (text: string) =>
    post<{ incident_id: string; status: string }>('/incidents', { text }),

  /** Generate runbook for a symptom */
  generateRunbook: (symptom: string, animate = true) =>
    post<Runbook>('/runbook', { symptom, animate }),

  /** Submit resolution outcomes — triggers improve() */
  resolveIncident: (incident_id: string, steps: StepOutcome[]) =>
    post<{ status: string; edges_updated: number }>(
      `/incidents/${incident_id}/resolve`,
      { steps }
    ),

  /** Remove incident from graph and RAG */
  deleteIncident: (incident_id: string) =>
    del<{ status: string; incident_id: string }>(`/incidents/${incident_id}`),

  /** All incidents (for timeline panel) */
  listIncidents: () =>
    get<{ incidents: IncidentRecord[] }>('/incidents').then((r) => r.incidents),

  /** Systemic patterns */
  getPatterns: () =>
    get<{ patterns: Pattern[]; total_incidents: number }>('/patterns'),

  /** Session metrics */
  getMetrics: () => get<SessionMetrics>('/metrics'),

  /** Side-by-side RAG vs Cognee comparison */
  compare: (symptom: string, animate = true) =>
    post<CompareResponse>('/compare', { symptom, animate }),

  /** Real Cognee knowledge graph (Entity nodes + edges) */
  getGraph: () => get<{ nodes: unknown[]; edges: unknown[] }>('/graph'),

  /** Health check */
  health: () => get<{ status: string; incidents: number; rag_indexed: number }>('/health'),

  /** Simulate an AlertManager webhook — posts canned Prometheus payload */
  simulateAlert: (scenario: 'redis' | 'postgres' | 'kafka') =>
    post<{ incident_id: string; symptom: string; status: string }>(
      '/ingest/webhook',
      DEMO_ALERTS[scenario]
    ),

  /** Fire a customised alert — merges user edits over the base preset */
  simulateAlertCustom: (
    scenario: 'redis' | 'postgres' | 'kafka',
    f: { alertname: string; severity: string; service: string; environment: string; summary: string; description: string }
  ) =>
    post<{ incident_id: string; symptom: string; status: string }>(
      '/ingest/webhook',
      {
        source: 'AlertManager',
        alerts: [{
          status: 'firing',
          labels: { alertname: f.alertname, severity: f.severity, service: f.service, environment: f.environment },
          annotations: { summary: f.summary, description: f.description },
          startsAt: new Date().toISOString(),
        }],
      }
    ),
}

const DEMO_ALERTS = {
  redis: {
    source: "AlertManager",
    alerts: [{
      status: "firing",
      labels: { alertname: "RedisHighMemory", severity: "critical", service: "payment-svc", environment: "production" },
      annotations: {
        summary: "Redis memory critical on payment-svc — OOM risk",
        description: "redis-payment-01 at 94% memory (3.76GB/4GB). payment-svc returning 504s. Worker pods OOMKilled. Connection pool exhausted at 512/512.",
      },
      startsAt: new Date().toISOString(),
    }],
  },
  postgres: {
    source: "AlertManager",
    alerts: [{
      status: "firing",
      labels: { alertname: "PostgresConnectionPoolExhausted", severity: "critical", service: "catalog-api", environment: "production" },
      annotations: {
        summary: "Postgres connection pool exhausted on catalog-api",
        description: "catalog-db connection pool at 500/500. New queries queuing with 30s+ wait. catalog-api latency p99 at 8200ms. Idle connections not being released.",
      },
      startsAt: new Date().toISOString(),
    }],
  },
  kafka: {
    source: "AlertManager",
    alerts: [{
      status: "firing",
      labels: { alertname: "KafkaConsumerLag", severity: "warning", service: "order-processor", environment: "production" },
      annotations: {
        summary: "Kafka consumer lag growing on order-processor",
        description: "orders-topic consumer group order-processor-cg lag at 45000 messages and growing. order-processor pod count: 2. Throughput dropped from 1200 msg/s to 80 msg/s after last deploy.",
      },
      startsAt: new Date().toISOString(),
    }],
  },
}
