import { memo, useMemo } from 'react'

import StatusBadge from './StatusBadge'

interface KpiBarProps {
  totalPorts: number
  normalPorts: number
  warningPorts: number
  criticalPorts: number
  backendMode: string
  connectionState: string
  connectionTone: 'normal' | 'warning' | 'critical' | 'neutral'
  lastUpdated: string | null
  isRefreshing: boolean
}

function KpiBar({
  totalPorts,
  normalPorts,
  warningPorts,
  criticalPorts,
  backendMode,
  connectionState,
  connectionTone,
  lastUpdated,
  isRefreshing,
}: KpiBarProps) {
  const items = useMemo(
    () => [
      {
        label: 'Total ports',
        value: String(totalPorts),
        tone: 'neutral' as const,
        meta: 'All configured monitor slots',
      },
      {
        label: 'Normal',
        value: String(normalPorts),
        tone: 'normal' as const,
        meta: 'Operational and valid PDI',
      },
      {
        label: 'Warning',
        value: String(warningPorts),
        tone: 'warning' as const,
        meta: 'Events active or PDI invalid',
      },
      {
        label: 'Critical',
        value: String(criticalPorts),
        tone: 'critical' as const,
        meta: 'Fault condition detected',
      },
      {
        label: 'Backend mode',
        value: backendMode,
        tone: backendMode === 'simulator' ? ('normal' as const) : ('warning' as const),
        meta: 'Simulator-first, hardware-ready shell',
      },
      {
        label: 'Connection state',
        value: connectionState,
        tone: connectionTone,
        meta: 'Frontend monitor session',
      },
      {
        label: 'Refresh cadence',
        value: '1000 ms',
        tone: isRefreshing ? ('normal' as const) : ('neutral' as const),
        meta: lastUpdated ? `Last sync ${lastUpdated}` : 'Waiting for first sample',
      },
    ],
    [
      backendMode,
      connectionState,
      connectionTone,
      criticalPorts,
      isRefreshing,
      lastUpdated,
      normalPorts,
      totalPorts,
      warningPorts,
    ],
  )

  return (
    <section className="kpi-bar" aria-label="Operational summary">
      {items.map((item) => (
        <article key={item.label} className="kpi-card">
          <div className="kpi-card__header">
            <span className="kpi-card__label">{item.label}</span>
            <StatusBadge label={item.value} tone={item.tone} />
          </div>
          <strong className="kpi-card__value">{item.value}</strong>
          <p className="kpi-card__meta">{item.meta}</p>
          {item.label === 'Refresh cadence' ? (
            <span
              className={`kpi-card__signal ${isRefreshing ? 'kpi-card__signal--active' : ''}`}
              aria-hidden="true"
            />
          ) : null}
        </article>
      ))}
    </section>
  )
}

export default memo(KpiBar)
