import { memo } from 'react'

import type { DiagnosticLevel } from '../api/types'

type MeterTone = DiagnosticLevel | 'neutral'

interface AIConfidenceMeterProps {
  label: string
  score: number
  tone?: MeterTone
  detail?: string
}

function AIConfidenceMeter({
  label,
  score,
  tone = 'neutral',
  detail,
}: AIConfidenceMeterProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)))

  return (
    <div className={`ai-meter ai-meter--${tone}`}>
      <div className="ai-meter__head">
        <span className="ai-meter__label">{label}</span>
        <strong className="ai-meter__score">{clampedScore}%</strong>
      </div>
      <div className="ai-meter__track" aria-hidden="true">
        <span className="ai-meter__fill" style={{ width: `${clampedScore}%` }} />
      </div>
      {detail ? <p className="ai-meter__detail">{detail}</p> : null}
    </div>
  )
}

export default memo(AIConfidenceMeter)
