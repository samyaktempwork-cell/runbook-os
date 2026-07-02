'use client'

import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGraphSocket } from '@/hooks/useGraphSocket'
import dynamic from 'next/dynamic'
const KnowledgeGraph = dynamic(() => import('@/components/KnowledgeGraph'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="font-mono text-slate-400 text-sm animate-pulse">Loading graph engine…</div>
    </div>
  ),
})
import RunbookViewer from '@/components/RunbookViewer'
import ComparisonView from '@/components/ComparisonView'
import IncidentTimeline from '@/components/IncidentTimeline'
import PatternPanel from '@/components/PatternPanel'
import GraphLegend from '@/components/GraphLegend'
import MemoryLifecycle from '@/components/MemoryLifecycle'
import AlertConfigModal from '@/components/AlertConfigModal'
import { api } from '@/lib/api'
import type { Runbook } from '@/lib/types'

type Mode = 'FEED' | 'ASK' | 'COMPARE'

const MODE_CONFIG = {
  FEED: {
    placeholder: 'Paste incident description, Slack thread, post-mortem…',
    hint: 'Feeds incident into Cognee memory — graph will animate',
    label: 'Teach RunbookOS',
    btnClass: 'bg-indigo-600 hover:bg-indigo-700',
    tabActive: 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-500',
    rows: 5,
  },
  ASK: {
    placeholder: 'Describe current symptom — e.g. Redis slow, payment 504s…',
    hint: 'Traverses Cognee graph — returns ranked runbook from memory',
    label: 'Recall from Graph Memory',
    btnClass: 'bg-orange-500 hover:bg-orange-600',
    tabActive: 'bg-orange-50 text-orange-500 border-b-2 border-orange-400',
    rows: 3,
  },
  COMPARE: {
    placeholder: 'Describe symptom to compare all 3 retrieval tiers side-by-side…',
    hint: 'Plain RAG · Enhanced VectorDB · GraphRAG — all run in parallel',
    label: 'Compare Tiers',
    btnClass: 'bg-violet-600 hover:bg-violet-700',
    tabActive: 'bg-violet-50 text-violet-600 border-b-2 border-violet-500',
    rows: 3,
  },
} as const

export default function DashboardPage() {
  const socketState = useGraphSocket()
  const [mode, setMode] = useState<Mode>('FEED')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [incidentRefresh, setIncidentRefresh] = useState(0)
  const [activeIncidentId, setActiveIncidentId] = useState<string | undefined>()
  const [activeSymptom, setActiveSymptom] = useState<string | undefined>()
  const [runbookMeta, setRunbookMeta] = useState<Runbook | null>(null)
  const [showDrawer, setShowDrawer] = useState(false)
  const [compareSymptom, setCompareSymptom] = useState<string | null>(null)
  const [simulatingAlert, setSimulatingAlert] = useState(false)
  const [simulateMsg, setSimulateMsg] = useState<string | null>(null)
  const [alertModalScenario, setAlertModalScenario] = useState<'redis' | 'postgres' | 'kafka' | null>(null)
  const [activePattern, setActivePattern] = useState<string | null>(null)
  const [patternHighlight, setPatternHighlight] = useState<Set<string>>(new Set())
  const [traceEnabled, setTraceEnabled] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const cfg = MODE_CONFIG[mode]

  // Elapsed-time counter — runs while a graph traversal / synthesis is in flight so
  // the 15-25s GraphRAG wait reads as active progress, not a hang.
  const recallActive = socketState.animationMode === 'recall' && !socketState.graphPathReady
  useEffect(() => {
    if (!recallActive) return
    setElapsed(0)
    const t0 = Date.now()
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100)
    return () => clearInterval(id)
  }, [recallActive])

  const switchMode = useCallback((m: Mode) => {
    setMode(m)
    setError(null)
    setInput('')
    textareaRef.current?.focus()
  }, [])

  const closeDrawer = useCallback(() => {
    setShowDrawer(false)
    setCompareSymptom(null)
    setRunbookMeta(null)
    socketState.clearRunbook()
    setError(null)
  }, [socketState])

  const submit = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setError(null)
    setLoading(true)
    try {
      if (mode === 'FEED') {
        const res = await api.feedIncident(text)
        setInput('')
        setIncidentRefresh((n) => n + 1)
        setActiveIncidentId(res.incident_id)
      } else if (mode === 'ASK') {
        setActiveSymptom(text)
        setRunbookMeta(null)
        socketState.clearRunbook()
        setShowDrawer(false)   // keep graph visible during traversal — opens after path_found
        const runbook = await api.generateRunbook(text, traceEnabled)
        setRunbookMeta(runbook)
        setActiveIncidentId(runbook.runbook_id)
        setInput('')
        setShowDrawer(true)    // now open — graph traversal already visible
      } else {
        // COMPARE
        closeDrawer()
        setCompareSymptom(text)
        setShowDrawer(true)
        setInput('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setShowDrawer(false)
    } finally {
      setLoading(false)
    }
  }, [input, loading, mode, socketState, closeDrawer])

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    if (e.key === 'Escape') { setInput(''); setError(null) }
  }

  const handleResolved = useCallback(() => {
    setIncidentRefresh((n) => n + 1)
    setTimeout(closeDrawer, 2000)
  }, [closeDrawer])

  const handleSimulateAlert = useCallback(async (
    scenario: 'redis' | 'postgres' | 'kafka',
    overrides?: { alertname: string; severity: string; service: string; environment: string; summary: string; description: string }
  ) => {
    if (simulatingAlert) return
    setSimulatingAlert(true)
    setSimulateMsg(null)
    setAlertModalScenario(null)
    try {
      const res = overrides
        ? await api.simulateAlertCustom(scenario, overrides)
        : await api.simulateAlert(scenario)
      setSimulateMsg(`Alert ingested — "${res.symptom.slice(0, 60)}…"`)
      setIncidentRefresh((n) => n + 1)
      setTimeout(() => setSimulateMsg(null), 4000)
    } catch {
      setSimulateMsg('Webhook failed — is backend running?')
      setTimeout(() => setSimulateMsg(null), 3000)
    } finally {
      setSimulatingAlert(false)
    }
  }, [simulatingAlert])

  const handlePatternClick = useCallback((insight: string) => {
    if (!insight) {
      setActivePattern(null)
      setPatternHighlight(new Set())
      return
    }
    setActivePattern(insight)
    // Fuzzy match: find graph nodes whose labels appear in the pattern insight text
    const words = insight.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
    const nodes = socketState.graphData?.nodes ?? []
    const matched = new Set(
      nodes
        .filter((n) => words.some((w) => n.label.toLowerCase().includes(w)))
        .map((n) => n.id)
    )
    setPatternHighlight(matched)
  }, [socketState.graphData])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">

      {/* Contest header */}
      <header className="shrink-0 flex items-center justify-between px-6 h-12 bg-slate-700 border-b border-slate-600 relative">
        {/* Left — contest identity */}
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="text-white font-bold tracking-widest uppercase">
            WeMakeDevs × Cognee Hackathon
          </span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300">2026</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300">Jun 29 – Jul 5 2026</span>
        </div>

        {/* Center — project name + tagline */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 font-mono text-[11px]">
          <span className="text-white font-bold tracking-tight text-sm">RunbookOS</span>
          <span className="text-slate-400">—</span>
          <span className="text-slate-300">DevOps incident memory · powered by Cognee GraphRAG</span>
        </div>

        {/* Right — team / track badge */}
        <div className="flex items-center gap-2.5 font-mono text-[11px]">
          <span className="text-slate-300">Track:</span>
          <span className="px-2 py-0.5 rounded bg-indigo-600 border border-indigo-400 text-white text-[10px] font-bold tracking-wider">
            AI INFRA
          </span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300">
            Team: <span className="text-white font-bold">Solo · Samyakkumar Jain</span>
          </span>
        </div>
      </header>

      {/* ── App body ── */}
      <div className="flex flex-1 overflow-hidden">
      {/* ── Left Sidebar ── */}
      <aside className="w-72 shrink-0 flex flex-col border-r border-slate-200 bg-white overflow-hidden">

        {/* WS status bar */}
        <div className="px-4 py-2 border-b border-slate-200 shrink-0 flex items-center justify-between">
          <span className="font-mono text-[9px] text-slate-400 tracking-widest uppercase">Graph Memory</span>
          {socketState.isConnected ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-rose-500">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              reconnecting
            </span>
          )}
        </div>

        {/* Mode tabs */}
        <div className="flex shrink-0 border-b border-slate-200">
          {(['FEED', 'ASK', 'COMPARE'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-2 font-mono text-[10px] font-bold tracking-widest transition-colors ${
                mode === m ? cfg.tabActive : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Input panel */}
        <div className="p-4 border-b border-slate-200 shrink-0">
          <p className="font-mono text-[9px] text-slate-400 tracking-widest uppercase mb-2">
            {cfg.hint}
          </p>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={cfg.placeholder}
            rows={cfg.rows}
            disabled={loading}
            className="w-full resize-none bg-slate-50 border border-slate-200 rounded font-mono text-xs text-slate-900 placeholder-slate-300 p-2.5 outline-none focus:border-indigo-400 transition-colors leading-relaxed disabled:opacity-50"
          />

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 font-mono text-[10px] text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1.5"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={submit}
            disabled={!input.trim() || loading}
            className={`mt-2 w-full font-mono text-xs font-bold py-2 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-white ${cfg.btnClass}`}
          >
            {loading ? <span className="animate-pulse">…</span> : `${cfg.label} ⏎`}
          </button>

          <p className="font-mono text-[9px] text-slate-400 mt-1.5 text-center">
            Enter to submit · Shift+Enter for newline
          </p>
        </div>

        {/* Graph stats + TRACE toggle */}
        <div className="px-4 py-2.5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 font-mono text-[10px]">
            <span className="text-slate-500">
              nodes <span className="text-indigo-600 font-bold">{socketState.graphData?.nodes?.length ?? 0}</span>
            </span>
            <span className="text-slate-500">
              edges <span className="text-indigo-600 font-bold">{socketState.graphData?.links?.length ?? 0}</span>
            </span>
            <span className="text-slate-500">
              visited <span className="text-orange-500 font-bold">{socketState.traversedNodes.size}</span>
            </span>
            <button
              onClick={() => setTraceEnabled((v) => !v)}
              title={traceEnabled ? 'Trace ON — click to disable (faster)' : 'Trace OFF — click to enable animation'}
              className={`ml-auto px-2 py-0.5 rounded font-mono text-[9px] font-bold border transition-colors ${
                traceEnabled
                  ? 'bg-orange-50 border-orange-300 text-orange-600 hover:bg-orange-100'
                  : 'bg-slate-100 border-slate-200 text-slate-400 hover:bg-slate-200'
              }`}
            >
              TRACE {traceEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Simulate Alert — webhook demo */}
        <div className="px-4 py-3 border-b border-slate-200 shrink-0">
          <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-2">
            Simulate AlertManager
          </p>
          <div className="flex gap-1.5">
            {(['redis', 'postgres', 'kafka'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setAlertModalScenario(s)}
                disabled={simulatingAlert}
                className="flex-1 font-mono text-[9px] font-bold py-1.5 rounded border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
              >
                {s === 'redis' ? 'Redis' : s === 'postgres' ? 'Postgres' : 'Kafka'}
              </button>
            ))}
          </div>
          {simulateMsg && (
            <p className="font-mono text-[9px] text-emerald-600 mt-2 leading-relaxed">
              {simulateMsg}
            </p>
          )}
          {simulatingAlert && (
            <p className="font-mono text-[9px] text-slate-400 mt-2 animate-pulse">
              Firing alert webhook…
            </p>
          )}
        </div>

        {/* Incident Timeline — scrollable flex region */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <IncidentTimeline refreshTrigger={incidentRefresh} />
        </div>

        {/* Pattern Panel */}
        <PatternPanel
          refreshTrigger={incidentRefresh}
          onPatternClick={handlePatternClick}
          activePattern={activePattern}
        />

        {/* Memory Lifecycle — 4 Cognee API pills */}
        <MemoryLifecycle activeLifecycle={socketState.activeLifecycle} />
      </aside>

      {/* ── Main canvas ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* ── Graph scan status strip (ASK / COMPARE traversal) ── */}
        <AnimatePresence>
          {socketState.animationMode === 'recall' && (
            <motion.div
              key="scan-strip"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 flex items-center gap-3 px-4 py-1.5 bg-orange-50 border-b border-orange-200"
            >
              {socketState.graphPathReady ? (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping shrink-0" />
              )}
              <span className="font-mono text-[10px] text-orange-700 tracking-wide flex-1">
                {socketState.graphPathReady
                  ? `Traversal complete — ${socketState.traversedCount} nodes scanned · highlights locked`
                  : `Traversing Cognee Cloud graph… ${socketState.traversedCount} node${socketState.traversedCount !== 1 ? 's' : ''} visited · ${elapsed.toFixed(1)}s`}
              </span>
              {socketState.graphPathReady && (
                <button
                  onClick={socketState.resetGraph}
                  className="font-mono text-[9px] font-bold px-2.5 py-1 rounded bg-orange-100 hover:bg-orange-200 border border-orange-300 text-orange-700 transition-colors shrink-0"
                >
                  Reset Graph ×
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 relative min-h-0">
          <KnowledgeGraph {...socketState} patternHighlight={patternHighlight} />
          <GraphLegend
            animationMode={socketState.animationMode}
            nodeCount={socketState.graphData?.nodes?.length ?? 0}
            edgeCount={socketState.graphData?.links?.length ?? 0}
          />
        </div>

        {/* ── Bottom drawer: RunbookViewer (ASK) or ComparisonView (COMPARE) ── */}
        <AnimatePresence>
          {showDrawer && mode === 'ASK' && socketState.runbookSteps.length > 0 && (
            <RunbookViewer
              steps={socketState.runbookSteps}
              incidentId={activeIncidentId}
              isComplete={socketState.recallComplete}
              symptom={activeSymptom}
              pattern={runbookMeta?.pattern ?? null}
              matchedIncidents={runbookMeta?.matched_incidents ?? 0}
              pitfalls={runbookMeta?.pitfalls ?? []}
              sourceIncidentUrls={runbookMeta?.source_incident_urls ?? []}
              causalLinks={runbookMeta?.causal_links ?? []}
              onClose={closeDrawer}
              onResolved={handleResolved}
            />
          )}

          {showDrawer && mode === 'COMPARE' && compareSymptom && (
            <motion.div
              key="compare-drawer"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: '62vh', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="shrink-0 border-t border-slate-200 bg-white overflow-hidden"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[9px] text-slate-400 tracking-widest uppercase">
                    Comparison
                  </span>
                  <span className="font-mono text-[10px] text-slate-600">
                    Same {socketState.graphData?.nodes?.length ?? '?'} incidents · Same Groq Llama 3.3-70B · Only retrieval differs
                  </span>
                </div>
                <button
                  onClick={closeDrawer}
                  className="font-mono text-[10px] text-slate-400 hover:text-slate-700 transition-colors"
                >
                  close ×
                </button>
              </div>

              <div className="h-[calc(100%-37px)] overflow-hidden">
                <ComparisonView symptom={compareSymptom} animate={traceEnabled} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      </div>{/* end app body */}

      {/* Builder footer */}
      <footer className="shrink-0 flex items-center justify-between px-6 h-10 bg-slate-600 border-t border-slate-500 relative">
        {/* Left — builder */}
        <div className="flex items-center gap-2.5 font-mono text-[11px]">
          <span className="text-slate-200">Built by</span>
          <span className="text-white font-bold">Samyakkumar Jain (Sam)</span>
          <span className="text-slate-400">·</span>
          <a href="https://github.com/samyaktempwork-cell" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white transition-colors">GitHub</a>
        </div>

        {/* Center — stack */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 font-mono text-[10px] text-slate-300">
          <span>Next.js</span><span className="text-slate-400">·</span>
          <span>FastAPI</span><span className="text-slate-400">·</span>
          <span className="text-indigo-300 font-bold">Cognee Cloud</span><span className="text-slate-400">·</span>
          <span>Groq Llama 3.3-70B</span><span className="text-slate-400">·</span>
          <span>ChromaDB</span><span className="text-slate-400">·</span>
          <span>D3 force-graph</span>
        </div>

        {/* Right — submission */}
        <div className="flex items-center gap-2.5 font-mono text-[11px]">
          <a href="https://github.com/samyaktempwork-cell/runbook-os" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white transition-colors">Source</a>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300">© 2026</span>
        </div>
      </footer>

      <AlertConfigModal
        scenario={alertModalScenario}
        onClose={() => setAlertModalScenario(null)}
        onFire={(scenario, overrides) => handleSimulateAlert(scenario, overrides)}
        firing={simulatingAlert}
      />

    </div>
  )
}
