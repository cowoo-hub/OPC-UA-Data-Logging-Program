import { memo, useMemo } from 'react'

import type {
  ByteOrder,
  DecodedPreview,
  DecodeType,
  PortDisplayConfig,
  PortDisplayOverride,
  ResolutionFactor,
  PortSeverity,
  PortSnapshot,
  WordOrder,
} from '../api/types'
import type { PortTrendSeries } from '../utils/history'
import {
  RESOLUTION_FACTOR_OPTIONS,
  formatResolutionFactor,
} from '../utils/portDisplay'
import { formatDecodedValue } from '../utils/decode'
import StableSelect from './StableSelect'
import StatusBadge from './StatusBadge'
import StatusBitIndicators from './StatusBitIndicators'
import TrendSparkline from './TrendSparkline'

interface PortCardProps {
  snapshot: PortSnapshot
  displayConfig: PortDisplayConfig
  displayOverride: PortDisplayOverride | null
  featuredPreview: DecodedPreview
  trendSeries: PortTrendSeries
  historyWindowLabel: string
  onOverrideChange: (portNumber: number, override: PortDisplayOverride) => void
  onOpenOverview: (portNumber: number) => void
}

const severityLabels: Record<PortSeverity, string> = {
  normal: 'Normal',
  warning: 'Warning',
  critical: 'Critical',
}

const decodeTypeOptions: Array<{ value: DecodeType; label: string }> = [
  { value: 'float32', label: 'Float32' },
  { value: 'uint16', label: 'UInt16' },
  { value: 'int16', label: 'Int16' },
  { value: 'uint32', label: 'UInt32' },
  { value: 'int32', label: 'Int32' },
  { value: 'binary', label: 'Binary' },
]

const wordOrderOptions: Array<{ value: WordOrder; label: string }> = [
  { value: 'big', label: 'Big words' },
  { value: 'little', label: 'Little words' },
]

const byteOrderOptions: Array<{ value: ByteOrder; label: string }> = [
  { value: 'big', label: 'Big bytes' },
  { value: 'little', label: 'Little bytes' },
]

function buildRawPreview(registers: number[]) {
  if (registers.length === 0) {
    return 'No payload'
  }

  return registers
    .slice(0, 4)
    .map((register) => register.toString())
    .join(' | ')
}

function buildRegisterMeta(registers: number[]) {
  if (registers.length === 0) {
    return 'Awaiting payload registers'
  }

  return `${registers.length} payload words`
}

function booleanLabel(isActive: boolean, activeLabel: string, inactiveLabel: string) {
  return isActive ? activeLabel : inactiveLabel
}

function PortCard({
  snapshot,
  displayConfig,
  displayOverride,
  featuredPreview,
  trendSeries,
  historyWindowLabel,
  onOverrideChange,
  onOpenOverview,
}: PortCardProps) {
  const { pdi, severity, portNumber } = snapshot

  const quickIndicators = useMemo(() => {
    if (!pdi) {
      return [
        { label: 'Operational', value: '--', tone: 'neutral' as const },
        { label: 'PDI', value: '--', tone: 'neutral' as const },
        { label: 'Event', value: '--', tone: 'neutral' as const },
      ]
    }

    return [
      {
        label: 'Operational',
        value: booleanLabel(pdi.header.port_status.operational, 'Online', 'Offline'),
        tone: pdi.header.port_status.operational ? ('normal' as const) : ('neutral' as const),
      },
      {
        label: 'PDI',
        value: booleanLabel(pdi.header.port_status.pdi_valid, 'Valid', 'Invalid'),
        tone: pdi.header.port_status.pdi_valid
          ? ('normal' as const)
          : pdi.header.port_status.fault
            ? ('critical' as const)
            : ('warning' as const),
      },
      {
        label: 'Event',
        value: pdi.header.event_code.active ? pdi.header.event_code.raw : 'None',
        tone: pdi.header.event_code.active ? ('warning' as const) : ('neutral' as const),
      },
    ]
  }, [pdi])

  const rawPreview = useMemo(
    () => buildRawPreview(pdi?.payload.registers ?? []),
    [pdi?.payload.registers],
  )

  const hasProfileOverride =
    displayOverride?.engineeringUnit !== undefined ||
    displayOverride?.preferredDecodeType !== undefined ||
    displayOverride?.wordOrder !== undefined ||
    displayOverride?.byteOrder !== undefined ||
    displayOverride?.resolutionFactor !== undefined ||
    displayOverride?.sourceWordCount !== undefined ||
    displayOverride?.fieldMode !== undefined ||
    displayOverride?.bitOffset !== undefined ||
    displayOverride?.bitLength !== undefined ||
    displayOverride?.signed !== undefined ||
    displayOverride?.sentinelMappings !== undefined ||
    displayOverride?.statusBits !== undefined

  const valueMeta = useMemo(() => {
    if (featuredPreview.error) {
      return featuredPreview.error
    }

    if (
      featuredPreview.sentinelLabel &&
      typeof featuredPreview.mappingComparisonValue === 'number'
    ) {
      return `Value ${formatDecodedValue(
        featuredPreview.mappingComparisonValue,
        displayConfig.preferredDecodeType,
      )} | Custom map`
    }

    if (
      displayConfig.resolutionFactor !== 1 &&
      featuredPreview.rawDisplayValue &&
      featuredPreview.rawDisplayValue !== featuredPreview.displayValue
    ) {
      return `Raw ${featuredPreview.rawDisplayValue} | x${formatResolutionFactor(displayConfig.resolutionFactor)}`
    }

    return buildRegisterMeta(pdi?.payload.registers ?? [])
  }, [
    displayConfig.preferredDecodeType,
    displayConfig.resolutionFactor,
    featuredPreview.displayValue,
    featuredPreview.error,
    featuredPreview.mappingComparisonValue,
    featuredPreview.rawDisplayValue,
    featuredPreview.sentinelLabel,
    pdi?.payload.registers,
  ])
  const liveStatusBits = featuredPreview.statusBits

  function updateProfileField<Key extends keyof PortDisplayOverride>(
    field: Key,
    value: PortDisplayOverride[Key],
  ) {
    onOverrideChange(portNumber, {
      ...(displayOverride ?? {}),
      [field]: value,
    })
  }

  function clearQuickProfile() {
    const nextOverride = { ...(displayOverride ?? {}) }
    delete nextOverride.preferredDecodeType
    delete nextOverride.wordOrder
    delete nextOverride.byteOrder
    delete nextOverride.resolutionFactor
    onOverrideChange(portNumber, nextOverride)
  }

  return (
    <article className={`monitor-card monitor-card--${severity}`}>
      <header className="monitor-card__header">
        <div className="monitor-card__heading">
          <p className="monitor-card__eyebrow">Port {portNumber}</p>
          <h3 className="monitor-card__title">{displayConfig.label}</h3>
        </div>
        <div className="monitor-card__badges">
          <StatusBadge label={severityLabels[severity]} tone={severity} />
          <StatusBadge
            label={hasProfileOverride ? 'Custom decode' : 'Profile default'}
            tone={hasProfileOverride ? 'warning' : 'neutral'}
          />
        </div>
      </header>

      <div className="monitor-card__value-shell">
        <div className="monitor-card__value-copy">
          <p className="monitor-card__value-label">{displayConfig.engineeringLabel}</p>
          <div className="monitor-card__value-line">
            <div className="monitor-card__value-line-main">
              <strong className="monitor-card__value">{featuredPreview.displayValue}</strong>
              {displayConfig.engineeringUnit ? (
                <span className="monitor-card__unit">{displayConfig.engineeringUnit}</span>
              ) : null}
            </div>
            <StatusBitIndicators
              statusBits={liveStatusBits}
              className="status-bit-indicators--card"
              maxItems={2}
            />
          </div>
          <p className="monitor-card__value-meta">{valueMeta}</p>
        </div>

        <div className="monitor-card__indicator-row">
          {quickIndicators.map((indicator) => (
            <div key={indicator.label} className="monitor-indicator">
              <span className="monitor-indicator__label">{indicator.label}</span>
              <StatusBadge label={String(indicator.value)} tone={indicator.tone} />
            </div>
          ))}
        </div>

        <div className="monitor-card__raw">
          <span className="monitor-card__raw-label">Raw preview</span>
          <code className="monitor-card__raw-value">{rawPreview}</code>
        </div>

        <div className="monitor-card__profile-strip">
          <label className="monitor-card__profile-field">
            <span className="monitor-card__profile-label">Decode</span>
            <StableSelect
              value={displayConfig.preferredDecodeType}
              onChange={(nextValue) =>
                updateProfileField('preferredDecodeType', nextValue as DecodeType)
              }
              options={decodeTypeOptions}
              className="stable-select--compact"
              triggerClassName="stable-select__trigger--compact"
              menuClassName="stable-select__menu--compact"
            />
          </label>

          <label className="monitor-card__profile-field">
            <span className="monitor-card__profile-label">Words</span>
            <StableSelect
              value={displayConfig.wordOrder}
              onChange={(nextValue) =>
                updateProfileField('wordOrder', nextValue as WordOrder)
              }
              options={wordOrderOptions}
              className="stable-select--compact"
              triggerClassName="stable-select__trigger--compact"
              menuClassName="stable-select__menu--compact"
            />
          </label>

          <label className="monitor-card__profile-field">
            <span className="monitor-card__profile-label">Bytes</span>
            <StableSelect
              value={displayConfig.byteOrder}
              onChange={(nextValue) =>
                updateProfileField('byteOrder', nextValue as ByteOrder)
              }
              options={byteOrderOptions}
              className="stable-select--compact"
              triggerClassName="stable-select__trigger--compact"
              menuClassName="stable-select__menu--compact"
            />
          </label>

          <label className="monitor-card__profile-field">
            <span className="monitor-card__profile-label">Scale</span>
            <StableSelect
              value={String(displayConfig.resolutionFactor)}
              onChange={(nextValue) =>
                updateProfileField('resolutionFactor', Number(nextValue) as ResolutionFactor)
              }
              options={RESOLUTION_FACTOR_OPTIONS.map((option) => ({
                value: String(option),
                label: formatResolutionFactor(option),
              }))}
              className="stable-select--compact"
              triggerClassName="stable-select__trigger--compact"
              menuClassName="stable-select__menu--compact"
            />
          </label>

          <div className="monitor-card__actions">
            <button
              type="button"
              className="action-button action-button--ghost action-button--compact"
              onClick={() => onOpenOverview(portNumber)}
            >
              Overview
            </button>
            <button
              type="button"
              className="action-button action-button--ghost action-button--compact"
              onClick={clearQuickProfile}
              disabled={!hasProfileOverride}
            >
              Default
            </button>
          </div>
        </div>

        <div className="monitor-card__trend">
          <TrendSparkline
            series={trendSeries}
            severity={severity}
            windowLabel={historyWindowLabel}
            variant="card"
          />
        </div>
      </div>
    </article>
  )
}

export default memo(
  PortCard,
  (previousProps, nextProps) =>
    previousProps.snapshot === nextProps.snapshot &&
    previousProps.displayConfig === nextProps.displayConfig &&
    previousProps.displayOverride === nextProps.displayOverride &&
    previousProps.featuredPreview === nextProps.featuredPreview &&
    previousProps.trendSeries === nextProps.trendSeries &&
    previousProps.historyWindowLabel === nextProps.historyWindowLabel,
)
