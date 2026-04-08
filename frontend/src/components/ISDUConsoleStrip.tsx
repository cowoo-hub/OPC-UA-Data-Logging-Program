import { memo } from 'react'

import StatusBadge, { type StatusTone } from './StatusBadge'

interface ISDUConsoleStripProps {
  selectedPort: number
  targetSummary: string
  operationLabel: string
  operationTone: StatusTone
  lastDurationMs: number | null
  lastCompletedLabel: string | null
}

function ISDUConsoleStrip({
  selectedPort,
  targetSummary,
  operationLabel,
  operationTone,
  lastDurationMs,
  lastCompletedLabel,
}: ISDUConsoleStripProps) {
  return (
    <section className="isdu-console-strip">
      <div className="isdu-console-strip__identity">
        <p className="section-kicker">ISDU engineering console</p>
        <h2 className="section-title">Parameter read / write</h2>
        <p className="isdu-console-strip__summary">{targetSummary}</p>
      </div>

      <div className="isdu-console-strip__metrics" aria-label="ISDU operation telemetry">
        <div className="isdu-console-strip__metric">
          <span className="isdu-console-strip__label">Port</span>
          <strong className="isdu-console-strip__value">{selectedPort}</strong>
        </div>

        <div className="isdu-console-strip__metric isdu-console-strip__metric--status">
          <span className="isdu-console-strip__label">State</span>
          <StatusBadge label={operationLabel} tone={operationTone} />
        </div>

        <div className="isdu-console-strip__metric">
          <span className="isdu-console-strip__label">Resp time</span>
          <strong className="isdu-console-strip__value">
            {lastDurationMs === null ? '--' : `${lastDurationMs} ms`}
          </strong>
        </div>

        <div className="isdu-console-strip__metric">
          <span className="isdu-console-strip__label">Last result</span>
          <strong className="isdu-console-strip__value">
            {lastCompletedLabel ?? '--'}
          </strong>
        </div>
      </div>
    </section>
  )
}

export default memo(ISDUConsoleStrip)
