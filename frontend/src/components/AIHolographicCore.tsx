import { memo } from 'react'

import type { PortDiagnostic, PortDisplayConfig } from '../api/types'
import type { PortTrendSeries } from '../utils/history'
import AIWaveField from './AIWaveField'
import StatusBadge from './StatusBadge'

interface AIHolographicCoreProps {
  diagnostic: PortDiagnostic
  displayConfig: PortDisplayConfig
  selectedPortNumber: number
  trendSeries: PortTrendSeries
}

function AIHolographicCore({
  diagnostic,
  displayConfig,
  selectedPortNumber,
  trendSeries,
}: AIHolographicCoreProps) {
  return (
    <section className="ai-holo-panel ai-holo-panel--core">
      <div className="ai-holo-panel__head">
        <div>
          <p className="section-kicker">AI core</p>
        </div>
        <StatusBadge label={diagnostic.level} tone={diagnostic.level} />
      </div>

      <div className="ai-core-orbit">
        <div className="ai-core-orbit__rings" aria-hidden="true">
          <span className="ai-core-orbit__ring ai-core-orbit__ring--outer" />
          <span className="ai-core-orbit__ring ai-core-orbit__ring--mid" />
          <span className="ai-core-orbit__ring ai-core-orbit__ring--inner" />
        </div>

        <AIWaveField
          series={trendSeries}
          level={diagnostic.level}
        />

        <div className="ai-core-orbit__center">
          <span className="ai-core-orbit__eyebrow">Selected focus</span>
          <strong className="ai-core-orbit__title">Port {selectedPortNumber}</strong>
          <span className="ai-core-orbit__subtitle">{displayConfig.label}</span>
          <strong className="ai-core-orbit__live">
            {diagnostic.liveValue ?? 'Awaiting value'}
          </strong>
        </div>

      </div>
    </section>
  )
}

export default memo(AIHolographicCore)
