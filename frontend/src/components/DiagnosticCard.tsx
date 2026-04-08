import { memo } from 'react'

import type { PortDiagnostic, PortDisplayConfig } from '../api/types'
import type { PortTrendSeries } from '../utils/history'
import StatusBadge from './StatusBadge'
import TrendSparkline from './TrendSparkline'

interface DiagnosticCardProps {
  diagnostic: PortDiagnostic
  displayConfig: PortDisplayConfig
  trendSeries: PortTrendSeries
  historyWindowLabel: string
  variant?: 'grid' | 'detail'
  onOpenOverview?: (portNumber: number) => void
}

function DiagnosticCard({
  diagnostic,
  displayConfig,
  trendSeries,
  historyWindowLabel,
  variant = 'grid',
  onOpenOverview,
}: DiagnosticCardProps) {
  const isDetail = variant === 'detail'
  const visibleReasons = diagnostic.reasons.slice(0, isDetail ? 4 : 2)

  return (
    <section className={`diagnostic-card diagnostic-card--${variant}`}>
      <header className="diagnostic-card__header">
        <div className="diagnostic-card__heading">
          <p className="section-kicker">Port {diagnostic.portNumber}</p>
          <h3 className="diagnostic-card__title">{displayConfig.label}</h3>
          <p className="diagnostic-card__meta">
            {displayConfig.engineeringLabel}
            {displayConfig.engineeringUnit ? ` | ${displayConfig.engineeringUnit}` : ''}
          </p>
        </div>

        <div className="diagnostic-card__badges">
          <StatusBadge label={diagnostic.level} tone={diagnostic.level} />
          <StatusBadge
            label={diagnostic.trendStatus}
            tone={diagnostic.trendStatus === 'unavailable' ? 'neutral' : 'normal'}
          />
        </div>
      </header>

      <div className="diagnostic-card__value-row">
        <div className="diagnostic-card__value-shell">
          <span className="diagnostic-card__value-label">Live value</span>
          <strong className="diagnostic-card__value">
            {diagnostic.liveValue ?? 'Unavailable'}
          </strong>
        </div>

        <div className="diagnostic-card__value-shell">
          <span className="diagnostic-card__value-label">Trend delta</span>
          <strong className="diagnostic-card__value diagnostic-card__value--small">
            {diagnostic.trendDelta ?? '--'}
          </strong>
        </div>
      </div>

      {variant === 'grid' ? (
        <TrendSparkline
          series={trendSeries}
          severity={diagnostic.level}
          windowLabel={historyWindowLabel}
          variant="compact"
        />
      ) : null}

      <div className="diagnostic-card__summary">
        <p className="diagnostic-card__summary-text">{diagnostic.summary}</p>
      </div>

      <div className="diagnostic-card__reasons">
        {visibleReasons.length > 0 ? (
          visibleReasons.map((reason) => (
            <div key={`${diagnostic.portNumber}-${reason.code}`} className="diagnostic-reason">
              <StatusBadge label={reason.title} tone={reason.level} />
              <p className="diagnostic-reason__detail">{reason.detail}</p>
            </div>
          ))
        ) : (
          <div className="diagnostic-reason diagnostic-reason--empty">
            <StatusBadge label="Stable" tone="normal" />
            <p className="diagnostic-reason__detail">
              No rule-based concerns were triggered for the current snapshot and history window.
            </p>
          </div>
        )}
      </div>

      <footer className="diagnostic-card__footer">
        <p className="diagnostic-card__action">{diagnostic.suggestedAction}</p>
        {onOpenOverview ? (
          <button
            type="button"
            className="action-button action-button--ghost action-button--compact"
            onClick={() => onOpenOverview(diagnostic.portNumber)}
          >
            Overview
          </button>
        ) : null}
      </footer>
    </section>
  )
}

export default memo(DiagnosticCard)
