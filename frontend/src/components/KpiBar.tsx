import { memo, useMemo } from 'react'

import StatusBadge from './StatusBadge'

interface KpiBarProps {
  totalPorts: number
  normalPorts: number
  warningPorts: number
  connectionState: string
  connectionTone: 'normal' | 'warning' | 'critical' | 'neutral'
  connectionMeta: string
  backendPollMs: number
  cacheAgeMs: number | null
  cacheIsStale: boolean
}

function KpiBar({
  totalPorts,
  normalPorts,
  warningPorts,
  connectionState,
  connectionTone,
  connectionMeta,
  backendPollMs,
  cacheAgeMs,
  cacheIsStale,
}: KpiBarProps) {
  const items = useMemo(
    () => [
      { label: 'Ports', value: String(totalPorts) },
      { label: 'Normal', value: String(normalPorts) },
      { label: 'Warn', value: String(warningPorts) },
    ],
    [normalPorts, totalPorts, warningPorts],
  )

  const rateTone = cacheIsStale ? 'warning' : 'normal'
  const rateMeta =
    cacheAgeMs === null ? 'Awaiting live cache' : `Age ${cacheAgeMs} ms`

  return (
    <section className="kpi-bar" aria-label="Operational telemetry strip">
      <div className="kpi-strip__group">
        {items.map((item) => (
          <article key={item.label} className="kpi-chip">
            <span className="kpi-chip__label">{item.label}</span>
            <strong className="kpi-chip__value">{item.value}</strong>
          </article>
        ))}
      </div>

      <article className="kpi-chip kpi-chip--connection">
        <span className="kpi-chip__label">Connection</span>
        <div className="kpi-chip__status">
          <StatusBadge label={connectionState} tone={connectionTone} />
          <span className="kpi-chip__meta">{connectionMeta}</span>
        </div>
      </article>

      <article className="kpi-chip kpi-chip--rate">
        <span className="kpi-chip__label">Comm Rate</span>
        <div className="kpi-chip__status">
          <StatusBadge label={`${backendPollMs} ms`} tone={rateTone} />
          <span className="kpi-chip__meta">{rateMeta}</span>
        </div>
      </article>
    </section>
  )
}

export default memo(KpiBar)
