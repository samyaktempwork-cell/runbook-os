'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '@/lib/api'
import type { CompareResponse, TierMetrics, Runbook } from '@/lib/types'

interface Props {
  symptom: string
  animate?: boolean
}

// Capability badge — green tick or grey dash
function Cap({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-4 text-center font-mono text-xs ${ok ? 'text-emerald-600' : 'text-slate-400'}`}>
      {ok ? '✓' : '–'}
    </span>
  )
}

// Per-tier header card
function TierHeader({ tier, index }: { tier: TierMetrics; index: number }) {
  const accent = index === 0 ? '#64748b' : index === 1 ? '#3b82f6' : '#f97316'
  const label = index === 0 ? 'TIER 1' : index === 1 ? 'TIER 2' : 'TIER 3'

  return (
    <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[9px] tracking-widest" style={{ color: accent }}>{label}</span>
        <span className="font-mono text-[10px] text-slate-500">{tier.response_ms}ms</span>
      </div>
      <p className="font-mono text-[11px] font-bold text-slate-900 leading-tight">{tier.name}</p>

      {/* Capability row — all measured/derived identically per tier */}
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
        {([
          [`Confident steps: ${tier.confident_steps}`, tier.confident_steps > 0],
          ['Step ranking', tier.step_ranking],
          ['Cross-incident', tier.cross_incident],
          ['Learns from use', tier.learns_from_use],
        ] as [string, boolean][]).map(([label, ok]) => (
          <div key={label} className="flex items-center gap-1">
            <Cap ok={ok} />
            <span className="font-mono text-[9px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Compact, read-only runbook renderer for a compare column
function TierRunbook({ runbook, accent }: { runbook: Runbook; accent: string }) {
  if (!runbook || runbook.steps.length === 0) {
    return <div className="p-3 font-mono text-[10px] text-slate-400 italic">No runbook generated</div>
  }
  return (
    <div className="p-3 space-y-2">
      <p className="font-mono text-[10px] font-bold text-slate-800 leading-tight">{runbook.incident_type}</p>
      {runbook.pattern && (
        <div className="rounded border border-violet-200 bg-violet-50 px-2 py-1">
          <span className="font-mono text-[9px] text-violet-700">pattern: {runbook.pattern}</span>
        </div>
      )}
      {runbook.causal_links && runbook.causal_links.length > 0 && (
        <div className="rounded border border-orange-200 bg-orange-50 px-2 py-1 space-y-0.5">
          <p className="font-mono text-[8px] tracking-widest text-orange-500 uppercase">Causal chain · Cognee graph</p>
          {runbook.causal_links.slice(0, 4).map((c, i) => (
            <p key={i} className="font-mono text-[9px] text-orange-700 leading-snug">{c}</p>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {runbook.steps.map((s) => (
          <div key={s.step} className="border border-slate-100 rounded p-2">
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-mono text-[9px] font-bold" style={{ color: accent }}>Step {s.step}</span>
              <span className="font-mono text-[9px] text-slate-400">{Math.round(s.confidence * 100)}%</span>
            </div>
            <p className="font-mono text-[10px] text-slate-700 leading-relaxed">{s.description}</p>
            {s.command && (
              <pre className="mt-1 bg-slate-900 text-slate-100 rounded px-2 py-1 font-mono text-[9px] overflow-x-auto">{s.command}</pre>
            )}
            {s.pitfall && (
              <p className="mt-1 font-mono text-[9px] text-amber-600 leading-relaxed">⚠ {s.pitfall}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Collapsible raw retrieval chunks (transparency for the vector tiers)
function RawChunks({ chunks, label }: { chunks: string[]; label: string }) {
  const [open, setOpen] = useState(false)
  if (!chunks.length) return null
  return (
    <div className="px-3 pb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[9px] tracking-widest text-slate-400 uppercase hover:text-slate-600 transition-colors"
      >
        {open ? '▾' : '▸'} {label} ({chunks.length} chunks)
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {chunks.map((chunk, i) => (
            <div key={i} className="border border-slate-100 rounded p-2">
              <div className="font-mono text-[9px] text-slate-400 mb-1">chunk {i + 1}</div>
              <p className="font-mono text-[10px] text-slate-500 leading-relaxed line-clamp-3">{chunk}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Response-time bar
function SpeedBar({ tiers }: { tiers: TierMetrics[] }) {
  const max = Math.max(...tiers.map((t) => t.response_ms), 1)
  const colors = ['#64748b', '#3b82f6', '#f97316']
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shrink-0">
      <p className="font-mono text-[9px] tracking-widest text-slate-500 uppercase mb-2">Response time</p>
      <div className="space-y-1.5">
        {tiers.map((t, i) => (
          <div key={t.name} className="flex items-center gap-2">
            <span className="font-mono text-[9px] text-slate-500 w-32 truncate">{t.name}</span>
            <div className="flex-1 bg-slate-200 rounded-full h-1.5 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: colors[i] }}
                initial={{ width: 0 }}
                animate={{ width: `${(t.response_ms / max) * 100}%` }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
              />
            </div>
            <span className="font-mono text-[9px] text-slate-500 w-12 text-right">{t.response_ms}ms</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ComparisonView({ symptom, animate = true }: Props) {
  const [result, setResult] = useState<CompareResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!symptom) return
    setLoading(true)
    setError(null)
    api.compare(symptom, animate)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Comparison failed'))
      .finally(() => setLoading(false))
  }, [symptom, animate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full font-mono text-xs text-slate-500">
        <div className="text-center">
          <div className="text-2xl mb-3 animate-pulse">◎</div>
          <div className="animate-pulse">Running all 3 pipelines in parallel…</div>
          <div className="text-[10px] mt-2 text-slate-400">Plain RAG · Enhanced VectorDB · GraphRAG (Cognee)</div>
          <div className="text-[10px] mt-1 text-slate-400">GraphRAG typically takes 10–15s — all tiers return together</div>
        </div>
      </div>
    )
  }

  if (error) {
    return <div className="flex items-center justify-center h-full font-mono text-xs text-rose-500">{error}</div>
  }
  if (!result) return null

  const { rag, hybrid, runbook, metrics } = result
  const tiers = metrics.tiers
  const cogneeTier = tiers[2]
  const vectorPatterns = Math.max(tiers[0]?.patterns_found ?? 0, tiers[1]?.patterns_found ?? 0)
  // Honest, measured advantage: a cross-incident pattern only the graph tier surfaced
  const graphSurfacedPattern = (cogneeTier?.patterns_found ?? 0) > 0 && vectorPatterns === 0

  return (
    <div className="flex flex-col h-full gap-2 p-4 overflow-hidden">

      {/* Top banner — the fair-test guarantee (now literally true) */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="shrink-0 flex items-center justify-between bg-slate-900 rounded-lg px-4 py-2"
      >
        <span className="font-mono text-[10px] text-slate-300">
          Same incidents · Same <span className="text-orange-400">Groq Llama 3.3-70B</span> · Same synthesis prompt · Only retrieval differs
        </span>
        <span className="font-mono text-[10px] text-slate-500 truncate ml-4">&quot;{symptom}&quot;</span>
      </motion.div>

      {/* Honest capability callout — no fabricated counts */}
      <motion.div
        initial={{ opacity: 0, scaleX: 0.98 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ delay: 0.2 }}
        className="shrink-0 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-2"
      >
        <span className="text-orange-500 font-mono text-xs">&#9650;</span>
        <span className="font-mono text-[10px] text-orange-700 font-bold">
          {graphSurfacedPattern
            ? 'GraphRAG surfaced a cross-incident pattern the vector tiers did not'
            : 'Only GraphRAG traverses relationships across incidents and learns from resolutions'}
        </span>
        <span className="ml-auto font-mono text-[9px] text-orange-500">graph traversal advantage</span>
      </motion.div>

      {/* Speed comparison bar */}
      <motion.div key="speed-bar" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="shrink-0">
        <SpeedBar tiers={tiers} />
      </motion.div>

      {/* 3-column grid — every tier now shows a structured runbook from the SAME synthesizer */}
      <div className="flex-1 grid grid-cols-3 gap-3 min-h-0">

        {/* Column 1 — Plain RAG */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="flex flex-col min-h-0 bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <TierHeader tier={tiers[0]} index={0} />
          <div className="flex-1 overflow-y-auto">
            <TierRunbook runbook={rag.runbook as Runbook} accent="#64748b" />
            <RawChunks chunks={rag.chunks} label="Vector similarity chunks" />
          </div>
          <div className="shrink-0 px-3 py-2 border-t border-slate-100 bg-slate-50">
            <p className="font-mono text-[9px] text-slate-400">Similarity only · No cross-incident links · Won&apos;t learn</p>
          </div>
        </motion.div>

        {/* Column 2 — Enhanced VectorDB */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="flex flex-col min-h-0 bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <TierHeader tier={tiers[1]} index={1} />
          <div className="flex-1 overflow-y-auto">
            <TierRunbook runbook={hybrid.runbook as Runbook} accent="#3b82f6" />
            <RawChunks chunks={hybrid.chunks} label="BM25 + reranked chunks" />
          </div>
          <div className="shrink-0 px-3 py-2 border-t border-slate-100 bg-slate-50">
            <p className="font-mono text-[9px] text-slate-400">Better ranking · Still no cross-incident links · Won&apos;t learn</p>
          </div>
        </motion.div>

        {/* Column 3 — GraphRAG / Cognee */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="flex flex-col min-h-0 bg-white border border-[#f97316]/30 rounded-lg overflow-hidden"
        >
          <TierHeader tier={tiers[2]} index={2} />
          <div className="flex-1 overflow-y-auto">
            <TierRunbook runbook={runbook} accent="#f97316" />
          </div>
          <div className="shrink-0 px-3 py-2 border-t border-orange-100 bg-orange-50/50">
            <p className="font-mono text-[9px] text-orange-600">
              Cross-incident graph traversal · Ranked by confidence · Learns from outcomes
            </p>
          </div>
        </motion.div>

      </div>
    </div>
  )
}
