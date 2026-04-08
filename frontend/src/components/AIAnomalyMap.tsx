import { memo } from 'react'

import type { DiagnosticLevel } from '../api/types'
import StatusBadge from './StatusBadge'

interface AIAnomalyMapItem {
  portNumber: number
  level: DiagnosticLevel
  title: string
  summary: string
  aiScore: number
}

interface AIAnomalyMapProps {
  items: AIAnomalyMapItem[]
  selectedPortNumber: number
  onSelect: (portNumber: number) => void
}

function AIAnomalyMap({
  items,
  selectedPortNumber,
  onSelect,
}: AIAnomalyMapProps) {
  return (
    <section className="ai-holo-panel ai-holo-panel--ports">
      <div className="ai-holo-panel__head">
        <div>
          <p className="section-kicker">Port intelligence</p>
          <h3 className="section-title">Anomaly map</h3>
        </div>
      </div>

      <div className="ai-port-list">
        {items.map((item) => (
          <button
            key={item.portNumber}
            type="button"
            className={`ai-port-list__item ai-port-list__item--${item.level} ${
              item.portNumber === selectedPortNumber ? 'ai-port-list__item--selected' : ''
            }`}
            onClick={() => onSelect(item.portNumber)}
          >
            <div className="ai-port-list__identity">
              <strong className="ai-port-list__title">{item.title}</strong>
              <p className="ai-port-list__summary" title={item.summary}>
                {item.summary}
              </p>
            </div>

            <div className="ai-port-list__meta">
              <StatusBadge label={item.level} tone={item.level} />
              <span className="ai-port-list__score">AI score {item.aiScore}%</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

export default memo(AIAnomalyMap)
