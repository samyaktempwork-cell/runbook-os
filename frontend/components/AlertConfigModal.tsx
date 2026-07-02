'use client'

import { useState, useEffect, useRef } from 'react'

type Scenario = 'redis' | 'postgres' | 'kafka'
type Severity = 'critical' | 'warning' | 'info'

interface AlertFields {
  alertname: string
  severity: Severity
  service: string
  environment: string
  summary: string
  description: string
}

interface Props {
  scenario: Scenario | null
  onClose: () => void
  onFire: (scenario: Scenario, overrides: AlertFields) => void
  firing: boolean
}

const PRESETS: Record<Scenario, AlertFields> = {
  redis: {
    alertname: 'RedisHighMemory',
    severity: 'critical',
    service: 'payment-svc',
    environment: 'production',
    summary: 'Redis memory critical on payment-svc — OOM risk',
    description: 'redis-payment-01 at 94% memory (3.76GB/4GB). payment-svc returning 504s. Worker pods OOMKilled. Connection pool exhausted at 512/512.',
  },
  postgres: {
    alertname: 'PostgresConnectionPoolExhausted',
    severity: 'critical',
    service: 'catalog-api',
    environment: 'production',
    summary: 'Postgres connection pool exhausted on catalog-api',
    description: 'catalog-db connection pool at 500/500. New queries queuing with 30s+ wait. catalog-api latency p99 at 8200ms. Idle connections not being released.',
  },
  kafka: {
    alertname: 'KafkaConsumerLag',
    severity: 'warning',
    service: 'order-processor',
    environment: 'production',
    summary: 'Kafka consumer lag growing on order-processor',
    description: 'orders-topic consumer group order-processor-cg lag at 45000 messages and growing. order-processor pod count: 2. Throughput dropped from 1200 msg/s to 80 msg/s after last deploy.',
  },
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'bg-rose-100 text-rose-700 border-rose-300',
  warning:  'bg-amber-100 text-amber-700 border-amber-300',
  info:     'bg-sky-100 text-sky-700 border-sky-300',
}

const SCENARIO_LABELS: Record<Scenario, string> = {
  redis: 'Redis',
  postgres: 'Postgres',
  kafka: 'Kafka',
}

export default function AlertConfigModal({ scenario, onClose, onFire, firing }: Props) {
  const [fields, setFields] = useState<AlertFields | null>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (scenario) {
      setFields({ ...PRESETS[scenario] })
      setTimeout(() => firstInputRef.current?.focus(), 50)
    }
  }, [scenario])

  if (!scenario || !fields) return null

  const set = (k: keyof AlertFields, v: string) =>
    setFields((f) => f ? { ...f, [k]: v } : f)

  const handleFire = () => {
    if (!firing) onFire(scenario, fields)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />

      {/* Panel */}
      <div className="relative z-10 w-[460px] bg-white border border-slate-200 rounded-lg shadow-xl font-mono overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-widest text-slate-400 uppercase">Fire Alert</span>
            <span className="text-slate-300">·</span>
            <span className="text-[11px] font-bold text-slate-700">{SCENARIO_LABELS[scenario]}</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-[14px] leading-none px-1"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">

          {/* Row: alertname + severity */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[8px] tracking-widest text-slate-400 uppercase mb-1">Alert Name</label>
              <input
                ref={firstInputRef}
                value={fields.alertname}
                onChange={(e) => set('alertname', e.target.value)}
                className="w-full text-[10px] border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:border-indigo-400"
              />
            </div>
            <div className="w-28">
              <label className="block text-[8px] tracking-widest text-slate-400 uppercase mb-1">Severity</label>
              <select
                value={fields.severity}
                onChange={(e) => set('severity', e.target.value as Severity)}
                className={`w-full text-[10px] border rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400 ${SEVERITY_COLORS[fields.severity]}`}
              >
                <option value="critical">critical</option>
                <option value="warning">warning</option>
                <option value="info">info</option>
              </select>
            </div>
          </div>

          {/* Row: service + environment */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[8px] tracking-widest text-slate-400 uppercase mb-1">Service</label>
              <input
                value={fields.service}
                onChange={(e) => set('service', e.target.value)}
                className="w-full text-[10px] border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:border-indigo-400"
                placeholder="e.g. payment-svc"
              />
            </div>
            <div className="w-32">
              <label className="block text-[8px] tracking-widest text-slate-400 uppercase mb-1">Environment</label>
              <select
                value={fields.environment}
                onChange={(e) => set('environment', e.target.value)}
                className="w-full text-[10px] border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:border-indigo-400"
              >
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="dev">dev</option>
              </select>
            </div>
          </div>

          {/* Summary */}
          <div>
            <label className="block text-[8px] tracking-widest text-slate-400 uppercase mb-1">Summary</label>
            <input
              value={fields.summary}
              onChange={(e) => set('summary', e.target.value)}
              className="w-full text-[10px] border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:border-indigo-400"
              placeholder="Short human-readable alert summary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[8px] tracking-widest text-slate-400 uppercase mb-1">Description</label>
            <textarea
              value={fields.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              className="w-full text-[10px] border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:border-indigo-400 resize-none leading-relaxed"
              placeholder="Detailed alert body — metrics, thresholds, context"
            />
          </div>

          {/* Reset hint */}
          <p className="text-[8px] text-slate-400">
            Editing overrides the preset — click Reset to restore defaults.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
          <button
            onClick={() => setFields({ ...PRESETS[scenario] })}
            className="text-[9px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            Reset to preset
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-[9px] px-3 py-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleFire}
              disabled={firing || !fields.summary.trim()}
              className="text-[9px] px-4 py-1.5 rounded bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-40 transition-colors"
            >
              {firing ? 'Firing…' : 'Fire Alert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
