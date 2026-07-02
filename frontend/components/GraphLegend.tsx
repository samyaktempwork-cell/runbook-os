'use client'

import type { AnimationMode } from '@/lib/types'

interface Props {
  animationMode: AnimationMode
  nodeCount: number
  edgeCount: number
}

const NODE_TYPES = [
  { type: 'service', color: '#6366f1', label: 'Service' },
  { type: 'error',   color: '#f43f5e', label: 'Error' },
  { type: 'step',    color: '#f59e0b', label: 'Step' },
  { type: 'outcome', color: '#10b981', label: 'Outcome' },
  { type: 'pattern', color: '#8b5cf6', label: 'Pattern' },
] as const

const MODE_LABELS: Record<AnimationMode, { label: string; color: string }> = {
  idle:    { label: 'IDLE',    color: '#94a3b8' },
  learn:   { label: 'LEARNING',  color: '#6366f1' },
  recall:  { label: 'RECALLING', color: '#f97316' },
  improve: { label: 'IMPROVING', color: '#22c55e' },
}

export default function GraphLegend({ animationMode, nodeCount, edgeCount }: Props) {
  const mode = MODE_LABELS[animationMode]

  return (
    <div className="absolute bottom-4 left-4 bg-white/95 border border-slate-200 rounded-lg px-3 py-2.5 shadow-md backdrop-blur-sm pointer-events-none select-none">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-slate-100">
        <span
          className="font-mono text-[10px] font-bold tracking-widest"
          style={{ color: mode.color }}
        >
          {mode.label}
        </span>
        <span className="font-mono text-[10px] text-slate-400">
          {nodeCount}n · {edgeCount}e
        </span>
      </div>

      <div className="space-y-1">
        {NODE_TYPES.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <circle cx="4" cy="4" r="3.5" fill={color} />
            </svg>
            <span className="font-mono text-[10px] text-slate-600">{label}</span>
          </div>
        ))}
      </div>

      {animationMode === 'recall' && (
        <div className="mt-2 pt-1.5 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <svg width="16" height="4" viewBox="0 0 16 4">
              <line x1="0" y1="2" x2="16" y2="2" stroke="#f97316" strokeWidth="2" />
            </svg>
            <span className="font-mono text-[10px] text-slate-600">Causal path</span>
          </div>
        </div>
      )}

      {animationMode === 'improve' && (
        <div className="mt-2 pt-1.5 border-t border-slate-100 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-emerald-600">▲</span>
            <span className="font-mono text-[10px] text-slate-600">Edge weight up</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-rose-500">▼</span>
            <span className="font-mono text-[10px] text-slate-600">Edge weight down</span>
          </div>
        </div>
      )}
    </div>
  )
}
