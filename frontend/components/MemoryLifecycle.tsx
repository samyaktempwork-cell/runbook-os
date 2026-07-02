'use client'

import { motion } from 'framer-motion'
import type { LifecycleStage } from '@/hooks/useGraphSocket'

interface Props {
  activeLifecycle: LifecycleStage
}

const STAGES: {
  key: NonNullable<LifecycleStage>
  label: string
  api: string
  color: string
  activeColor: string
  activeBg: string
}[] = [
  {
    key: 'remember',
    label: 'REMEMBER',
    api: 'add_text + cognify',
    color: 'text-slate-400 border-slate-200',
    activeColor: 'text-indigo-600 border-indigo-400',
    activeBg: 'bg-indigo-50',
  },
  {
    key: 'recall',
    label: 'RECALL',
    api: 'GRAPH_COMPLETION',
    color: 'text-slate-400 border-slate-200',
    activeColor: 'text-orange-500 border-orange-400',
    activeBg: 'bg-orange-50',
  },
  {
    key: 'improve',
    label: 'IMPROVE',
    api: 'cognify feedback',
    color: 'text-slate-400 border-slate-200',
    activeColor: 'text-emerald-600 border-emerald-400',
    activeBg: 'bg-emerald-50',
  },
  {
    key: 'forget',
    label: 'FORGET',
    api: 'local prune',
    color: 'text-slate-400 border-slate-200',
    activeColor: 'text-rose-500 border-rose-400',
    activeBg: 'bg-rose-50',
  },
]

export default function MemoryLifecycle({ activeLifecycle }: Props) {
  return (
    <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
      <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-2">
        Cognee Memory Lifecycle
      </p>
      <div className="flex gap-1.5">
        {STAGES.map((stage) => {
          const isActive = activeLifecycle === stage.key
          return (
            <motion.div
              key={stage.key}
              animate={isActive ? { scale: [1, 1.06, 1] } : { scale: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className={`flex-1 rounded border px-1.5 py-1.5 text-center transition-colors duration-300 ${
                isActive
                  ? `${stage.activeColor} ${stage.activeBg}`
                  : stage.color
              }`}
              title={stage.api}
            >
              <p className={`font-mono text-[8px] font-bold tracking-widest leading-none ${isActive ? stage.activeColor.split(' ')[0] : 'text-slate-400'}`}>
                {stage.label}
              </p>
              {isActive && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="font-mono text-[7px] text-slate-400 mt-0.5 leading-none truncate"
                >
                  {stage.api}
                </motion.p>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
