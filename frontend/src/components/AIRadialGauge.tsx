import { memo, useMemo } from 'react'

import { useSmoothedNumber } from '../hooks/useSmoothedNumber'

interface AIRadialGaugeProps {
  label: string
  value: number
  tone?: 'normal' | 'warning' | 'critical' | 'neutral'
  size?: 'default' | 'compact'
}

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function AIRadialGauge({
  label,
  value,
  tone = 'neutral',
  size = 'default',
}: AIRadialGaugeProps) {
  const smoothedValue = useSmoothedNumber(Math.max(0, Math.min(100, value)), {
    durationMs: 160,
    precision: 2,
  })
  const clampedValue = Math.max(0, Math.min(100, smoothedValue))
  const displayValue = Math.round(clampedValue)
  const dashOffset = useMemo(
    () => CIRCUMFERENCE - (clampedValue / 100) * CIRCUMFERENCE,
    [clampedValue],
  )

  return (
    <div className={`ai-radial-gauge ai-radial-gauge--${tone} ai-radial-gauge--${size}`}>
      <svg
        className="ai-radial-gauge__svg"
        viewBox="0 0 120 120"
        shapeRendering="geometricPrecision"
        aria-hidden="true"
      >
        <circle className="ai-radial-gauge__halo" cx="60" cy="60" r="50" />
        <circle className="ai-radial-gauge__track" cx="60" cy="60" r={RADIUS} />
        <circle
          className="ai-radial-gauge__progress"
          cx="60"
          cy="60"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
        <circle className="ai-radial-gauge__core" cx="60" cy="60" r="31" />
      </svg>

      <div className="ai-radial-gauge__content">
        <strong className="ai-radial-gauge__value">{displayValue}%</strong>
        <span className="ai-radial-gauge__label">{label}</span>
      </div>
    </div>
  )
}

export default memo(AIRadialGauge)
