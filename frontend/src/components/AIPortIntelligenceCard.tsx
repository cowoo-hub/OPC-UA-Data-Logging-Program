import { memo } from 'react'

import type { PortDiagnostic, PortDisplayConfig } from '../api/types'
import StatusBadge from './StatusBadge'

interface AIPortIntelligenceCardProps {
  diagnostic: PortDiagnostic
  displayConfig: PortDisplayConfig
  selected: boolean
  onSelect: (portNumber: number) => void
  onOpenOverview: (portNumber: number) => void
}

function AIPortIntelligenceCard({
  diagnostic,
  displayConfig,
  selected,
  onSelect,
  onOpenOverview,
}: AIPortIntelligenceCardProps) {
  const topCause = diagnostic.probableCauses[0]?.title ?? 'No dominant anomaly driver'

  return (
    <article
      className={`ai-port-card ai-port-card--${diagnostic.level} ${
        selected ? 'ai-port-card--selected' : ''
      }`}
    >
      <button
        type="button"
        className="ai-port-card__main"
        onClick={() => onSelect(diagnostic.portNumber)}
      >
        <div className="ai-port-card__header">
          <div>
            <p className="section-kicker">Port {diagnostic.portNumber}</p>
            <h3 className="ai-port-card__title">{displayConfig.label}</h3>
          </div>
          <StatusBadge label={diagnostic.level} tone={diagnostic.level} />
        </div>

        <div className="ai-port-card__metrics">
          <div className="ai-port-card__metric">
            <span>Value</span>
            <strong>{diagnostic.liveValue ?? 'Unavailable'}</strong>
          </div>
          <div className="ai-port-card__metric">
            <span>Anomaly</span>
            <strong>{diagnostic.anomalyScore}%</strong>
          </div>
          <div className="ai-port-card__metric">
            <span>Forecast</span>
            <strong>{diagnostic.forecast.direction}</strong>
          </div>
        </div>

        <p className="ai-port-card__summary">{topCause}</p>
      </button>

      <button
        type="button"
        className="action-button action-button--ghost action-button--compact"
        onClick={() => onOpenOverview(diagnostic.portNumber)}
      >
        Engineering View
      </button>
    </article>
  )
}

export default memo(AIPortIntelligenceCard)
