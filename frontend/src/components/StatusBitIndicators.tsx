import type { StatusBitState } from '../api/types'

interface StatusBitIndicatorsProps {
  statusBits: StatusBitState[]
  className?: string
  maxItems?: number
}

function buildCompactChannelLabel(statusBit: StatusBitState, index: number) {
  const explicitChannelMatch = statusBit.label.match(/\b(?:channel|ch|signal)\s*([1-9]\d*)\b/i)

  if (explicitChannelMatch?.[1]) {
    return `Ch${explicitChannelMatch[1]}`
  }

  const numericMatch = statusBit.label.match(/\b([1-9]\d*)\b/)

  if (numericMatch?.[1]) {
    return `Ch${numericMatch[1]}`
  }

  return `Ch${index + 1}`
}

function StatusBitIndicators({
  statusBits,
  className,
  maxItems = statusBits.length,
}: StatusBitIndicatorsProps) {
  if (statusBits.length === 0 || maxItems <= 0) {
    return null
  }

  const visibleStatusBits = statusBits.slice(0, maxItems)

  return (
    <div className={['status-bit-indicators', className].filter(Boolean).join(' ')}>
      {visibleStatusBits.map((statusBit, index) => {
        const compactLabel = buildCompactChannelLabel(statusBit, index)
        const stateLabel = statusBit.active ? 'ON' : 'OFF'

        return (
          <div
            key={`${statusBit.bit}-${statusBit.label}`}
            className="status-bit-indicators__item"
            title={`${statusBit.label}: ${stateLabel}`}
            aria-label={`${statusBit.label}: ${stateLabel}`}
          >
            <span
              className={`status-bit-indicators__led status-bit-indicators__led--${statusBit.active ? 'on' : 'off'}`}
              aria-hidden="true"
            />
            <span className="status-bit-indicators__label">{compactLabel}</span>
          </div>
        )
      })}
    </div>
  )
}

export default StatusBitIndicators
