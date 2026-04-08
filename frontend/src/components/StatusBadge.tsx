import { memo } from 'react'

export type StatusTone = 'normal' | 'warning' | 'critical' | 'neutral'

interface StatusBadgeProps {
  label: string
  tone?: StatusTone
}

function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  )
}

export default memo(StatusBadge)
