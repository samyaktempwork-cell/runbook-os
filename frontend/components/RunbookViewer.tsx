'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import type { RunbookStep, StepOutcome } from '@/lib/types'

interface Props {
  steps: RunbookStep[]
  incidentId?: string
  isComplete: boolean
  symptom?: string
  pattern?: string | null
  matchedIncidents?: number
  pitfalls?: string[]
  sourceIncidentUrls?: string[]
  causalLinks?: string[]
  onClose: () => void
  onResolved?: () => void
}

export default function RunbookViewer({
  steps, incidentId, isComplete, symptom, pattern, matchedIncidents = 0,
  pitfalls = [], sourceIncidentUrls = [], causalLinks = [], onClose, onResolved,
}: Props) {
  const [outcomes, setOutcomes] = useState<Record<number, boolean | null>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const markStep = (step: number, worked: boolean) => {
    setOutcomes((prev) => ({ ...prev, [step]: worked }))
  }

  const handleResolve = async () => {
    if (!incidentId) return
    setSubmitting(true)
    try {
      const stepOutcomes: StepOutcome[] = steps.map((s) => ({
        step: s.step, description: s.description, worked: outcomes[s.step] ?? true,
      }))
      await api.resolveIncident(incidentId, stepOutcomes)
      setSubmitted(true)
      onResolved?.()
    } finally {
      setSubmitting(false)
    }
  }

  if (steps.length === 0) return null

  return (
    <motion.div
      initial={{ y: '100%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="flex flex-col bg-white border-t border-slate-200 shadow-lg max-h-[60vh] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-xs font-bold text-slate-900">RUNBOOK</span>
            {matchedIncidents > 0 && (
              <span className="font-mono text-[10px] text-slate-500">
                from {matchedIncidents} past incident{matchedIncidents !== 1 ? 's' : ''}
              </span>
            )}
            {!isComplete && (
              <span className="font-mono text-[10px] text-orange-500 animate-pulse">generating…</span>
            )}
          </div>
          {symptom && (
            <p className="font-mono text-[10px] text-slate-500 mt-0.5 truncate max-w-lg">{symptom}</p>
          )}
          {/* Source incident links */}
          {sourceIncidentUrls.length > 0 && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="font-mono text-[9px] text-slate-400">sources:</span>
              {sourceIncidentUrls.slice(0, 4).map((url) => {
                const parts = url.replace('https://github.com/', '').split('/')
                const label = parts.length >= 4 ? `${parts[0]}/${parts[1]}#${parts[3]}` : url
                return (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[9px] text-indigo-500 hover:text-indigo-700 hover:underline"
                  >
                    {label}
                  </a>
                )
              })}
            </div>
          )}
        </div>
        <button onClick={onClose} className="font-mono text-xs text-slate-400 hover:text-slate-700 transition-colors shrink-0 ml-4">
          ✕ close
        </button>
      </div>

      {/* Steps */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        <AnimatePresence initial={false}>
          {steps.map((step) => (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="p-3 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-6 h-6 rounded-full border border-slate-300 flex items-center justify-center font-mono text-[10px] text-slate-500">
                  {step.step}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs text-slate-800 leading-relaxed">{step.description}</p>

                  {/* Branch condition */}
                  {step.branch_condition && (
                    <p className="mt-1.5 font-mono text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      ⤳ {step.branch_condition}
                    </p>
                  )}

                  {step.command && (
                    <code className="block mt-1.5 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded font-mono text-[10px] text-indigo-300 overflow-x-auto whitespace-nowrap">
                      $ {step.command}
                    </code>
                  )}

                  {/* Step-level pitfall */}
                  {step.pitfall && (
                    <p className="mt-1.5 font-mono text-[10px] text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                      ⚠ {step.pitfall}
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <div className="font-mono text-[10px] font-bold" style={{ color: confidenceColor(step.confidence) }}>
                    {(step.confidence * 100).toFixed(0)}%
                  </div>
                  <div className="font-mono text-[9px] text-slate-400">success</div>
                </div>

                {isComplete && !submitted && (
                  <div className="shrink-0 flex flex-col gap-1">
                    <button
                      onClick={() => markStep(step.step, true)}
                      className={`font-mono text-[9px] px-2 py-0.5 rounded transition-colors ${
                        outcomes[step.step] === true
                          ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                          : 'text-slate-400 hover:text-emerald-600 border border-transparent'
                      }`}
                    >
                      ✓ worked
                    </button>
                    <button
                      onClick={() => markStep(step.step, false)}
                      className={`font-mono text-[9px] px-2 py-0.5 rounded transition-colors ${
                        outcomes[step.step] === false
                          ? 'bg-rose-100 text-rose-600 border border-rose-300'
                          : 'text-slate-400 hover:text-rose-500 border border-transparent'
                      }`}
                    >
                      ✗ didn&apos;t
                    </button>
                  </div>
                )}

                {submitted && (
                  <span className="shrink-0 font-mono text-[9px] text-emerald-600">saved</span>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Pattern */}
      {pattern && (
        <div className="px-5 py-2 border-t border-slate-200 bg-violet-50 shrink-0">
          <div className="flex items-start gap-2">
            <span className="text-violet-500 text-xs mt-0.5 shrink-0">&#9656;</span>
            <p className="font-mono text-[10px] text-violet-700">{pattern}</p>
          </div>
        </div>
      )}

      {/* Real cause->effect edges from the Cognee graph */}
      {causalLinks.length > 0 && (
        <div className="px-5 py-2 border-t border-slate-200 bg-orange-50 shrink-0">
          <p className="font-mono text-[9px] font-bold text-orange-700 mb-1 tracking-widest uppercase">
            Causal chain <span className="text-orange-400 font-normal normal-case">· from Cognee graph</span>
          </p>
          {causalLinks.map((c, i) => (
            <p key={i} className="font-mono text-[10px] text-orange-600 leading-relaxed">
              {c}
            </p>
          ))}
        </div>
      )}

      {/* Cross-incident pitfalls */}
      {pitfalls.length > 0 && (
        <div className="px-5 py-2 border-t border-slate-200 bg-rose-50 shrink-0">
          <p className="font-mono text-[9px] font-bold text-rose-700 mb-1 tracking-widest uppercase">Common pitfalls</p>
          {pitfalls.map((p, i) => (
            <p key={i} className="font-mono text-[10px] text-rose-600 leading-relaxed">
              • {p}
            </p>
          ))}
        </div>
      )}

      {isComplete && !submitted && incidentId && (
        <div className="px-5 py-3 border-t border-slate-200 shrink-0">
          <button
            onClick={handleResolve}
            disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-mono text-xs font-bold py-2 rounded transition-colors"
          >
            {submitting ? 'Saving to memory…' : '✓ Mark Resolved — Improve Memory'}
          </button>
        </div>
      )}

      {submitted && (
        <div className="px-5 py-3 border-t border-slate-200 shrink-0 font-mono text-xs text-emerald-600 text-center">
          Resolution added to Cognee memory — future recalls will factor in what worked
        </div>
      )}
    </motion.div>
  )
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return '#16a34a'
  if (confidence >= 0.65) return '#d97706'
  return '#e11d48'
}
