'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import type { IncidentRecord } from '@/lib/types'

interface Props {
  refreshTrigger?: number
}

export default function IncidentTimeline({ refreshTrigger }: Props) {
  const [incidents, setIncidents] = useState<IncidentRecord[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [ragIndexed, setRagIndexed] = useState<number | null>(null)

  useEffect(() => {
    api.listIncidents().then(setIncidents).catch(() => {})
    api.health().then((h) => setRagIndexed(h.rag_indexed)).catch(() => {})
  }, [refreshTrigger])

  const handleDelete = async (incident_id: string) => {
    setDeleting(incident_id)
    try {
      await api.deleteIncident(incident_id)
      setIncidents((prev) => prev.filter((i) => i.incident_id !== incident_id))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <h2 className="font-mono text-xs font-bold text-slate-700 tracking-widest uppercase">
          Incidents
        </h2>
        <span className="font-mono text-[10px] text-slate-500">
          {incidents.length} in memory
          {ragIndexed !== null && <> · <span className="text-emerald-600">{ragIndexed} indexed</span></>}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {incidents.length === 0 && (
          <div className="px-4 py-6 text-center font-mono text-xs text-slate-400">
            No incidents yet.<br />Feed one using the command bar.
          </div>
        )}

        <AnimatePresence initial={false}>
          {incidents.map((incident) => (
            <motion.div
              key={incident.incident_id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="border-b border-slate-100"
            >
              <button
                onClick={() => setExpanded((prev) => prev === incident.incident_id ? null : incident.incident_id)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${incident.resolved ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                    <span className="font-mono text-xs text-slate-800 truncate">
                      {incident.text.slice(0, 50)}…
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">
                    {formatRelativeTime(incident.timestamp)}
                  </span>
                </div>
              </button>

              <AnimatePresence>
                {expanded === incident.incident_id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 space-y-2">
                      <p className="font-mono text-[10px] text-slate-600 leading-relaxed">
                        {incident.text.slice(0, 200)}{incident.text.length > 200 ? '…' : ''}
                      </p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`font-mono text-[10px] ${incident.resolved ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {incident.resolved ? '✓ RESOLVED' : '⊙ ACTIVE'}
                        </span>
                        {incident.source_repo && (
                          <a
                            href={incident.source_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-[9px] text-indigo-500 hover:text-indigo-700 hover:underline"
                          >
                            ↗ {incident.source_repo}
                          </a>
                        )}
                        <button
                          onClick={() => handleDelete(incident.incident_id)}
                          disabled={deleting === incident.incident_id}
                          className="font-mono text-[10px] text-rose-500 hover:text-rose-700 disabled:opacity-50 transition-colors"
                        >
                          {deleting === incident.incident_id ? 'removing…' : 'forget →'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
