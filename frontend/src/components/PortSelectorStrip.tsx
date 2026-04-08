import { memo } from 'react'

import type { PortDisplayConfig, PortSnapshot } from '../api/types'

interface PortSelectorStripProps {
  ports: PortSnapshot[]
  displayConfigs: Record<number, PortDisplayConfig>
  selectedPortNumber: number
  onSelect: (portNumber: number) => void
  variant?: 'default' | 'compact'
}

function PortSelectorStrip({
  ports,
  displayConfigs,
  selectedPortNumber,
  onSelect,
  variant = 'default',
}: PortSelectorStripProps) {
  const sortedPorts = [...ports].sort((leftPort, rightPort) => leftPort.portNumber - rightPort.portNumber)
  const isCompact = variant === 'compact'

  return (
    <section className={`selector-panel ${isCompact ? 'selector-panel--compact' : ''}`}>
      <div className="selector-panel__head">
        <div>
          <p className="section-kicker">Port index</p>
          <h2 className="section-title">{isCompact ? 'Active port' : 'Overview focus'}</h2>
        </div>
        <div className="selector-port-chip" aria-label={`Selected port ${selectedPortNumber}`}>
          <span className="selector-port-chip__label">Port</span>
          <strong className="selector-port-chip__value">{selectedPortNumber}</strong>
        </div>
      </div>

      <div className="selector-grid">
        {sortedPorts.map((snapshot) => {
          const isActive = snapshot.portNumber === selectedPortNumber
          const config = displayConfigs[snapshot.portNumber]

          return (
            <button
              key={snapshot.portNumber}
              type="button"
              className={`selector-card ${isActive ? 'selector-card--active' : ''}`}
              onClick={() => onSelect(snapshot.portNumber)}
            >
              <div className="selector-card__copy">
                <p className="selector-card__eyebrow">P{snapshot.portNumber}</p>
                <strong className="selector-card__title">
                  {isCompact ? `Port ${snapshot.portNumber}` : config.label}
                </strong>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default memo(PortSelectorStrip)
