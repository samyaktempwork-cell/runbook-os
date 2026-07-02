'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import type { Pattern } from '@/lib/types'

interface Props {
  refreshTrigger?: number
  onPatternClick?: (insight: string) => void
  activePattern?: string | null
}

export default function PatternPanel({ refreshTrigger, onPatternClick, activePattern }: Props) {
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (total < 5) return
    setLoading(true)
    api.getPatterns()
      .then((res) => {
        setPatterns(res.patterns)
        setTotal(res.total_incidents)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refreshTrigger, total])

  useEffect(() => {
    api.health().then((h) => setTotal(h.incidents)).catch(() => {})
  }, [refreshTrigger])

  if (total < 5) {
    return (
      <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
        <h2 className="font-mono text-xs font-bold text-slate-700 tracking-widest uppercase mb-1">
          Patterns
        </h2>
        <p className="font-mono text-[10px] text-slate-500 leading-relaxed">
          Feed {5 - total} more incident{5 - total !== 1 ? 's' : ''} to surface systemic patterns.
        </p>
      </div>
    )
  }

  return (
    <div className="border-t border-slate-200">
      <div className="px-4 py-3">
        <h2 className="font-mono text-xs font-bold text-slate-700 tracking-widest uppercase mb-2">
          Systemic Patterns
        </h2>

        {loading && (
          <div className="font-mono text-[10px] text-slate-400 animate-pulse">Analysing memory…</div>
        )}

        <AnimatePresence>
          {patterns.map((pattern, i) => {
            const isActive = activePattern === pattern.insight
            return (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => onPatternClick?.(isActive ? '' : pattern.insight)}
                className={`w-full text-left mb-2 p-2.5 rounded-lg border shadow-sm transition-colors ${
                  isActive
                    ? 'bg-violet-50 border-violet-300'
                    : 'bg-white border-slate-200 hover:border-violet-200 hover:bg-violet-50/40'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className={`text-xs mt-0.5 shrink-0 ${isActive ? 'text-violet-600' : 'text-violet-400'}`}>&#9656;</span>
                  <p className={`font-mono text-[10px] leading-relaxed ${isActive ? 'text-violet-700' : 'text-slate-700'}`}>
                    {pattern.insight}
                  </p>
                </div>
                {isActive && (
                  <p className="font-mono text-[8px] text-violet-400 mt-1 ml-4">
                    matching nodes highlighted in graph ↑
                  </p>
                )}
              </motion.button>
            )
          })}
        </AnimatePresence>

        {!loading && patterns.length === 0 && (
          <p className="font-mono text-[10px] text-slate-400">No systemic patterns detected yet.</p>
        )}
      </div>
    </div>
  )
}
