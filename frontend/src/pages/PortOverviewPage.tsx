import { useMemo, useState } from 'react'

import {
  HISTORY_EXPORT_RANGES,
  downloadPortHistoryCsv,
  getHistoryExportRangeByValue,
  getHistoryExportRangeByWindowMs,
} from '../api/client'
import type {
  DiagnosticLevel,
  HistoryExportMode,
  HistoryExportRange,
  ParsedProcessDataField,
  PortDisplayConfig,
  PortSeverity,
} from '../api/types'
import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import { formatDecodedValue } from '../utils/decode'
import {
  formatDateTimeLocalInputValue,
  formatHistoryWindow,
  formatLocalDateTimeDisplay,
  parseDateTimeLocalInputToUtcIso,
} from '../utils/history'
import { formatResolutionFactor } from '../utils/portDisplay'
import DiagnosticCard from '../components/DiagnosticCard'
import HistoryChart from '../components/HistoryChart'
import PortDisplayControls from '../components/PortDisplayControls'
import PortSelectorStrip from '../components/PortSelectorStrip'
import StableSelect from '../components/StableSelect'
import StatusBadge from '../components/StatusBadge'

function formatResolutionSourceLabel(source: string) {
  switch (source) {
    case 'manual_selection':
      return 'Manual profile'
    case 'device_identity':
      return 'Device identity'
    case 'device_key':
      return 'Device key'
    case 'manual_disabled':
      return 'Manual mode'
    case 'unresolved':
    default:
      return 'Unresolved'
  }
}

function formatProcessDataFieldTypeLabel(field: ParsedProcessDataField) {
  switch (field.type) {
    case 'bool':
      return 'Boolean'
    case 'int':
      return 'Signed'
    case 'uint':
      return 'Unsigned'
    case 'enum':
      return 'Enum'
    case 'float32':
      return 'Float32'
    case 'binary':
    default:
      return 'Binary'
  }
}

function ProcessDataFieldValue({ field }: { field: ParsedProcessDataField }) {
  if (field.active !== null) {
    return (
      <div
        className={`overview-process-card__state overview-process-card__state--${field.active ? 'on' : 'off'}`}
      >
        <span
          className={`status-bit-indicators__led status-bit-indicators__led--${field.active ? 'on' : 'off'}`}
          aria-hidden="true"
        />
        <strong>{field.active ? 'ON' : 'OFF'}</strong>
        <span>{field.active ? 'Active state' : 'Inactive state'}</span>
      </div>
    )
  }

  if (field.isMapped) {
    return (
      <div className="overview-process-card__value-block">
        <span className="overview-process-card__badge">{field.displayValue}</span>
        <strong className="overview-process-card__value overview-process-card__value--secondary">
          Raw {field.rawDisplayValue}
        </strong>
      </div>
    )
  }

  return (
    <strong className="overview-process-card__value">
      {field.displayValue}
      {field.unit ? ` ${field.unit}` : ''}
    </strong>
  )
}

interface OverviewHistoryToolsProps {
  selectedPortNumber: number
  selectedHistoryRange: {
    value: HistoryExportRange
    label: string
    windowMs: number
  }
  displayConfig: PortDisplayConfig
  status: PortSeverity
  eventCode: string | null
  anomalyState: DiagnosticLevel
  retainedStartMs: number
  retainedEndMs: number
  defaultCustomStart: string
  defaultCustomEnd: string
  onHistoryRangeChange: (value: HistoryExportRange) => void
}

function OverviewHistoryTools({
  selectedPortNumber,
  selectedHistoryRange,
  displayConfig,
  status,
  eventCode,
  anomalyState,
  retainedStartMs,
  retainedEndMs,
  defaultCustomStart,
  defaultCustomEnd,
  onHistoryRangeChange,
}: OverviewHistoryToolsProps) {
  const [isExportingHistory, setIsExportingHistory] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportMode, setExportMode] = useState<HistoryExportMode>('preset')
  const [customExportStart, setCustomExportStart] = useState(defaultCustomStart)
  const [customExportEnd, setCustomExportEnd] = useState(defaultCustomEnd)
  const retainedStartInputValue = formatDateTimeLocalInputValue(retainedStartMs)
  const retainedEndInputValue = formatDateTimeLocalInputValue(retainedEndMs)
  const retainedStartLabel = formatLocalDateTimeDisplay(retainedStartMs)
  const retainedEndLabel = formatLocalDateTimeDisplay(retainedEndMs)

  const customExportValidationError = useMemo(() => {
    if (exportMode !== 'custom') {
      return null
    }

    if (!customExportStart || !customExportEnd) {
      return 'Choose both start and end times.'
    }

    const startTimestamp = Date.parse(customExportStart)
    const endTimestamp = Date.parse(customExportEnd)

    if (Number.isNaN(startTimestamp) || Number.isNaN(endTimestamp)) {
      return 'Enter valid custom export times.'
    }

    if (startTimestamp >= endTimestamp) {
      return 'Start must be earlier than end.'
    }

    if (startTimestamp < retainedStartMs || endTimestamp > retainedEndMs) {
      return 'Custom range must stay inside retained history.'
    }

    return null
  }, [
    customExportEnd,
    customExportStart,
    exportMode,
    retainedEndMs,
    retainedStartMs,
  ])

  async function handleExportCsv() {
    if (customExportValidationError) {
      setExportError(customExportValidationError)
      return
    }

    setIsExportingHistory(true)
    setExportError(null)

    try {
      await downloadPortHistoryCsv({
        portNumber: selectedPortNumber,
        exportMode,
        range: exportMode === 'preset' ? selectedHistoryRange.value : undefined,
        customRange:
          exportMode === 'custom'
            ? {
                start: parseDateTimeLocalInputToUtcIso(customExportStart) ?? '',
                end: parseDateTimeLocalInputToUtcIso(customExportEnd) ?? '',
              }
            : undefined,
        displayConfig,
        status,
        eventCode,
        anomalyState,
      })
    } catch (exportFailure) {
      setExportError(
        exportFailure instanceof Error ? exportFailure.message : 'CSV export failed.',
      )
    } finally {
      setIsExportingHistory(false)
    }
  }

  return (
    <div className="overview-history-tools">
      <div className="overview-history-tools__group">
        <label className="overview-history-tools__field" htmlFor="overview-history-range">
          <span className="control-field__label">History window</span>
          <StableSelect
            id="overview-history-range"
            value={selectedHistoryRange.value}
            onChange={(nextValue) => {
              setExportError(null)
              onHistoryRangeChange(nextValue as HistoryExportRange)
            }}
            options={HISTORY_EXPORT_RANGES.map((rangeOption) => ({
              value: rangeOption.value,
              label: rangeOption.label,
            }))}
            className="stable-select--compact"
            triggerClassName="stable-select__trigger--compact"
            menuClassName="stable-select__menu--compact"
          />
        </label>

        <label className="overview-history-tools__field" htmlFor="overview-export-mode">
          <span className="control-field__label">Export mode</span>
          <StableSelect
            id="overview-export-mode"
            value={exportMode}
            onChange={(nextValue) => {
              setExportMode(nextValue as HistoryExportMode)
              setExportError(null)
            }}
            options={[
              { value: 'preset', label: 'Preset' },
              { value: 'custom', label: 'Custom' },
            ]}
            className="stable-select--compact"
            triggerClassName="stable-select__trigger--compact"
            menuClassName="stable-select__menu--compact"
          />
        </label>

        {exportMode === 'custom' ? (
          <div className="overview-history-tools__custom-range">
            <label
              className="overview-history-tools__field overview-history-tools__field--datetime"
              htmlFor="overview-export-start"
            >
              <span className="control-field__label">Start</span>
              <input
                id="overview-export-start"
                type="datetime-local"
                step={1}
                min={retainedStartInputValue}
                max={retainedEndInputValue}
                value={customExportStart}
                onChange={(event) => {
                  setCustomExportStart(event.target.value)
                  setExportError(null)
                }}
              />
            </label>

            <label
              className="overview-history-tools__field overview-history-tools__field--datetime"
              htmlFor="overview-export-end"
            >
              <span className="control-field__label">End</span>
              <input
                id="overview-export-end"
                type="datetime-local"
                step={1}
                min={retainedStartInputValue}
                max={retainedEndInputValue}
                value={customExportEnd}
                onChange={(event) => {
                  setCustomExportEnd(event.target.value)
                  setExportError(null)
                }}
              />
            </label>
          </div>
        ) : null}
      </div>

      <div className="overview-history-tools__group overview-history-tools__group--actions">
        {exportError || customExportValidationError ? (
          <span className="overview-history-tools__message" role="alert">
            {exportError ?? customExportValidationError}
          </span>
        ) : exportMode === 'custom' ? (
          <span className="overview-history-tools__message overview-history-tools__message--info">
            Retained {retainedStartLabel} to {retainedEndLabel}
          </span>
        ) : null}

        <button
          type="button"
          className="action-button action-button--compact"
          onClick={() => void handleExportCsv()}
          disabled={isExportingHistory || Boolean(customExportValidationError)}
        >
          {isExportingHistory
            ? 'Exporting...'
            : exportMode === 'custom'
              ? 'Export custom CSV'
              : 'Export CSV'}
        </button>
      </div>
    </div>
  )
}

function PortOverviewPage() {
  const workspace = useMonitoringWorkspaceContext()
  const {
    selectedPortNumber,
    selectedPortSnapshot,
    selectedPortTrendSeries,
    selectedPortIoddProfile,
    selectedPortProcessData,
    selectedPortOverride,
    selectedPortDisplayConfig,
    selectedPortDiagnostic,
    selectedPortDecodes,
    resolvedPortDisplayConfigs,
    ports,
    historySnapshot,
    historyWindowMs,
    setHistoryWindowMs,
    setSelectedPortNumber,
    updatePortDisplayOverride,
    resetPortDisplay,
  } = workspace

  const { pdi, severity, error } = selectedPortSnapshot
  const effectiveHistoryWindowMs = historySnapshot?.history_window_ms ?? historyWindowMs
  const selectedHistoryRange = useMemo(
    () =>
      getHistoryExportRangeByWindowMs(effectiveHistoryWindowMs) ?? HISTORY_EXPORT_RANGES[0],
    [effectiveHistoryWindowMs],
  )
  const latestHistoryTimestampMs = useMemo(() => {
    if (selectedPortTrendSeries.latestTimestampMs !== null) {
      return selectedPortTrendSeries.latestTimestampMs
    }

    const fallbackTimestamp =
      historySnapshot?.polling.last_successful_poll_at ??
      historySnapshot?.polling.updated_at ??
      null
    const parsedFallback = fallbackTimestamp ? Date.parse(fallbackTimestamp) : Number.NaN

    if (Number.isFinite(parsedFallback)) {
      return parsedFallback
    }

    return selectedPortTrendSeries.oldestTimestampMs ?? 0
  }, [
    historySnapshot?.polling.last_successful_poll_at,
    historySnapshot?.polling.updated_at,
    selectedPortTrendSeries.oldestTimestampMs,
    selectedPortTrendSeries.latestTimestampMs,
  ])
  const historyRetentionMs = historySnapshot?.history_retention_ms ?? effectiveHistoryWindowMs
  const retainedHistoryStartMs = latestHistoryTimestampMs - historyRetentionMs
  const defaultCustomRangeStartMs = Math.max(
    retainedHistoryStartMs,
    latestHistoryTimestampMs - selectedHistoryRange.windowMs,
  )
  const defaultCustomRangeStart = formatDateTimeLocalInputValue(defaultCustomRangeStartMs)
  const defaultCustomRangeEnd = formatDateTimeLocalInputValue(latestHistoryTimestampMs)

  const focusIndicators = pdi
    ? [
        {
          label: 'Operational',
          value: pdi.header.port_status.operational ? 'Online' : 'Offline',
        },
        {
          label: 'PDI',
          value: pdi.header.port_status.pdi_valid ? 'Valid' : 'Invalid',
        },
        {
          label: 'Event',
          value: pdi.header.event_code.active ? pdi.header.event_code.raw : 'Clear',
        },
        {
          label: 'Payload',
          value: `${pdi.payload.registers.length} words`,
        },
      ]
    : []

  const statusRows = pdi
    ? [
        {
          label: 'Initialization',
          value: pdi.header.port_status.initialization_active ? 'Active' : 'Idle',
        },
        {
          label: 'Operational',
          value: pdi.header.port_status.operational ? 'Online' : 'Offline',
        },
        {
          label: 'PDI validity',
          value: pdi.header.port_status.pdi_valid ? 'Valid' : 'Invalid',
        },
        {
          label: 'Fault',
          value: pdi.header.port_status.fault
            ? pdi.header.port_status.fault_severity ?? 'Faulted'
            : 'Clear',
        },
        {
          label: 'Aux input',
          value: pdi.header.auxiliary_input.active ? 'Active' : 'Inactive',
        },
        {
          label: 'Event code',
          value: pdi.header.event_code.raw,
        },
      ]
    : []

  const metadataRows = pdi
    ? [
        { label: 'Backend mode', value: pdi.connection.mode },
        { label: 'Target', value: `${pdi.connection.host}:${pdi.connection.port}` },
        { label: 'Slave ID', value: String(pdi.connection.slave_id) },
        { label: 'Field mode', value: selectedPortDisplayConfig.fieldMode.replace('_', ' ') },
        { label: 'Source words', value: String(selectedPortDisplayConfig.sourceWordCount) },
        { label: 'Block mode', value: pdi.pdi_block.mode },
        { label: 'Base1 address', value: String(pdi.pdi_block.base1_address) },
        {
          label: 'Bit range',
          value:
            selectedPortDisplayConfig.fieldMode === 'bit_field'
              ? `${selectedPortDisplayConfig.bitOffset}-${selectedPortDisplayConfig.bitOffset + selectedPortDisplayConfig.bitLength - 1}`
              : 'Full payload word',
        },
      ]
    : []

  const decodeRows = selectedPortDecodes
    ? [
        {
          label: 'UInt16',
          value: selectedPortDecodes.uint16.displayValue,
          meta:
            selectedPortDisplayConfig.resolutionFactor !== 1 &&
            selectedPortDecodes.uint16.rawDisplayValue &&
            selectedPortDecodes.uint16.rawDisplayValue !==
              selectedPortDecodes.uint16.displayValue
              ? `Raw ${selectedPortDecodes.uint16.rawDisplayValue}`
              : selectedPortDecodes.uint16.error,
        },
        {
          label: 'Int16',
          value: selectedPortDecodes.int16.displayValue,
          meta:
            selectedPortDisplayConfig.resolutionFactor !== 1 &&
            selectedPortDecodes.int16.rawDisplayValue &&
            selectedPortDecodes.int16.rawDisplayValue !==
              selectedPortDecodes.int16.displayValue
              ? `Raw ${selectedPortDecodes.int16.rawDisplayValue}`
              : selectedPortDecodes.int16.error,
        },
        {
          label: 'Float32',
          value: selectedPortDecodes.float32.displayValue,
          meta:
            selectedPortDisplayConfig.resolutionFactor !== 1 &&
            selectedPortDecodes.float32.rawDisplayValue &&
            selectedPortDecodes.float32.rawDisplayValue !==
              selectedPortDecodes.float32.displayValue
              ? `Raw ${selectedPortDecodes.float32.rawDisplayValue}`
              : selectedPortDecodes.float32.error,
        },
        {
          label: 'UInt32',
          value: selectedPortDecodes.uint32.displayValue,
          meta:
            selectedPortDisplayConfig.resolutionFactor !== 1 &&
            selectedPortDecodes.uint32.rawDisplayValue &&
            selectedPortDecodes.uint32.rawDisplayValue !==
              selectedPortDecodes.uint32.displayValue
              ? `Raw ${selectedPortDecodes.uint32.rawDisplayValue}`
              : selectedPortDecodes.uint32.error,
        },
        {
          label: 'Int32',
          value: selectedPortDecodes.int32.displayValue,
          meta:
            selectedPortDisplayConfig.resolutionFactor !== 1 &&
            selectedPortDecodes.int32.rawDisplayValue &&
            selectedPortDecodes.int32.rawDisplayValue !==
              selectedPortDecodes.int32.displayValue
              ? `Raw ${selectedPortDecodes.int32.rawDisplayValue}`
              : selectedPortDecodes.int32.error,
        },
        {
          label: 'Binary',
          value: selectedPortDecodes.binary.displayValue,
          meta: selectedPortDecodes.binary.error,
        },
      ]
    : []

  const heroMetaParts = [
    selectedPortDisplayConfig.profileId !== 'generic'
      ? selectedPortDisplayConfig.profileLabel
      : null,
    selectedPortProcessData?.name ?? null,
    selectedPortDisplayConfig.preferredDecodeType,
    selectedPortDisplayConfig.fieldMode === 'bit_field'
      ? `bits ${selectedPortDisplayConfig.bitOffset}-${selectedPortDisplayConfig.bitOffset + selectedPortDisplayConfig.bitLength - 1}`
      : `${selectedPortDisplayConfig.sourceWordCount} word source`,
    `x${formatResolutionFactor(selectedPortDisplayConfig.resolutionFactor)}`,
    `${selectedPortDisplayConfig.wordOrder} words`,
    `${selectedPortDisplayConfig.byteOrder} bytes`,
  ].filter(Boolean)

  const configuredStatusBits = selectedPortDecodes?.featured.statusBits ?? []
  const rawRegisterWords = pdi
    ? pdi.payload.registers.slice(0, selectedPortDisplayConfig.sourceWordCount)
    : []
  const rawRegisterHex = rawRegisterWords
    .map((registerValue) => `0x${registerValue.toString(16).padStart(4, '0').toUpperCase()}`)
    .join(' ')
  const extractedFieldValue =
    selectedPortDecodes?.featured.rawDisplayValue ?? selectedPortDecodes?.featured.displayValue ?? '--'
  const scaledEngineeringValue = selectedPortDecodes?.featured.displayValue ?? '--'
  const mappingComparisonDisplayValue =
    typeof selectedPortDecodes?.featured.mappingComparisonValue === 'number'
      ? formatDecodedValue(
          selectedPortDecodes.featured.mappingComparisonValue,
          selectedPortDisplayConfig.preferredDecodeType,
        )
      : null
  const engineeringValueMeta = selectedPortDecodes?.featured.sentinelLabel
    ? [
        mappingComparisonDisplayValue ? `Compare ${mappingComparisonDisplayValue}` : null,
        'Customizing Map',
        selectedPortDecodes.featured.sentinelLabel,
      ]
        .filter(Boolean)
        .join(' | ')
    : [
        mappingComparisonDisplayValue ? `Compare ${mappingComparisonDisplayValue}` : null,
        `x${formatResolutionFactor(selectedPortDisplayConfig.resolutionFactor)}`,
        selectedPortDisplayConfig.engineeringUnit,
      ]
        .filter(Boolean)
        .join(' | ')

  const hasStructuredProcessData =
    selectedPortProcessData !== null && selectedPortProcessData.fields.length > 0
  const processDataSummaryParts = selectedPortProcessData
    ? [
        selectedPortIoddProfile?.vendorName ?? null,
        formatResolutionSourceLabel(selectedPortProcessData.resolutionSource),
        `${selectedPortProcessData.fields.length} fields`,
        `${selectedPortProcessData.totalBitLength} bit`,
        `${selectedPortProcessData.sourceWordCount} word source`,
        selectedPortProcessData.rawHex ? `Hex ${selectedPortProcessData.rawHex}` : null,
      ].filter(Boolean)
    : []

  const handleHistoryRangeChange = (nextValue: HistoryExportRange) => {
    const nextRange = getHistoryExportRangeByValue(nextValue)

    if (!nextRange) {
      return
    }

    setHistoryWindowMs(nextRange.windowMs)
  }

  return (
    <div className="workspace-page workspace-page--overview">
      <header className="page-header page-header--overview">
        <div>
          <p className="section-kicker">Port overview</p>
          <h2 className="page-title">Single-port analytical view</h2>
          <p className="page-description">
            Focused inspection for one active port with live value, recent
            history, compact diagnostics, and engineering context.
          </p>
        </div>
      </header>

      <section className="overview-screen">
        <PortSelectorStrip
          ports={ports}
          displayConfigs={resolvedPortDisplayConfigs}
          selectedPortNumber={selectedPortNumber}
          onSelect={setSelectedPortNumber}
          variant="compact"
        />

        {!pdi ? (
          <section className="overview-panel overview-panel--empty">
            <div className="overview-panel__head">
              <div>
                <p className="section-kicker">Selected port</p>
                <h3 className="section-title">No cached payload available</h3>
              </div>
              <div
                className="overview-port-chip"
                aria-label={`Selected port ${selectedPortNumber}`}
              >
                <span className="overview-port-chip__label">Port</span>
                <strong className="overview-port-chip__value">{selectedPortNumber}</strong>
              </div>
            </div>
            <p className="page-description">
              {error ?? 'The backend has not delivered a cached snapshot for this port yet.'}
            </p>
          </section>
        ) : (
          <>
            <div className="overview-focus-grid">
              <section className="overview-panel overview-panel--focus">
                <div className="overview-panel__head">
                  <div className="overview-focus__header">
                    <div
                      className="overview-port-chip"
                      aria-label={`Selected port ${selectedPortNumber}`}
                    >
                      <span className="overview-port-chip__label">Port</span>
                      <strong className="overview-port-chip__value">{selectedPortNumber}</strong>
                    </div>
                    <div className="overview-focus__identity">
                      <p className="section-kicker">Selected port</p>
                      <h3 className="overview-hero__title">
                        {selectedPortDisplayConfig.label}
                      </h3>
                      <p className="overview-hero__meta">{heroMetaParts.join(' | ')}</p>
                    </div>
                  </div>
                  <StatusBadge label={severity} tone={severity} />
                </div>

                <div className="overview-focus__reading">
                  <strong className="overview-hero__value">
                    {selectedPortDecodes?.featured.displayValue ?? '--'}
                  </strong>
                  {selectedPortDisplayConfig.engineeringUnit ? (
                    <span className="overview-hero__unit">
                      {selectedPortDisplayConfig.engineeringUnit}
                    </span>
                  ) : null}
                </div>

                {selectedPortDisplayConfig.resolutionFactor !== 1 &&
                selectedPortDecodes?.featured.rawDisplayValue &&
                selectedPortDecodes.featured.rawDisplayValue !==
                  selectedPortDecodes.featured.displayValue ? (
                  <p className="overview-hero__raw">
                    Raw {selectedPortDecodes.featured.rawDisplayValue}
                    {selectedPortDecodes.featured.sentinelLabel
                      ? ` | Mapped ${selectedPortDecodes.featured.sentinelLabel}`
                      : ''}
                  </p>
                ) : selectedPortDecodes?.featured.sentinelLabel ? (
                  <p className="overview-hero__raw">
                    Customizing Map raw {selectedPortDecodes.featured.rawDisplayValue}
                  </p>
                ) : null}

                <div className="overview-focus__indicators">
                  {focusIndicators.map((indicator) => (
                    <div key={indicator.label} className="overview-focus__indicator">
                      <span>{indicator.label}</span>
                      <strong>{indicator.value}</strong>
                    </div>
                  ))}
                </div>
                </section>

              <PortDisplayControls
                selectedPortNumber={selectedPortNumber}
                selectedConfig={selectedPortDisplayConfig}
                selectedOverride={selectedPortOverride}
                selectedStatusBitStates={selectedPortDecodes?.featured.statusBits ?? []}
                showPortSelector={false}
                variant="compact"
                className="control-panel--profile-dock"
                onSelectedPortNumberChange={setSelectedPortNumber}
                onOverrideChange={updatePortDisplayOverride}
                onResetPort={resetPortDisplay}
              />

              <section className="overview-focus-grid__chart overview-panel overview-panel--chart-shell">
                <OverviewHistoryTools
                  key={`${selectedPortNumber}:${selectedHistoryRange.value}:${historyRetentionMs}`}
                  selectedPortNumber={selectedPortNumber}
                  selectedHistoryRange={selectedHistoryRange}
                  displayConfig={selectedPortDisplayConfig}
                  status={severity}
                  eventCode={pdi ? String(pdi.header.event_code.raw) : null}
                  anomalyState={selectedPortDiagnostic.level}
                  retainedStartMs={retainedHistoryStartMs}
                  retainedEndMs={latestHistoryTimestampMs}
                  defaultCustomStart={defaultCustomRangeStart}
                  defaultCustomEnd={defaultCustomRangeEnd}
                  onHistoryRangeChange={handleHistoryRangeChange}
                />

                <div className="overview-focus-grid__chart-body">
                  <HistoryChart
                    series={selectedPortTrendSeries}
                    severity={severity}
                    windowMs={effectiveHistoryWindowMs}
                  />
                </div>
              </section>
            </div>

            <div className="overview-analysis-grid">
              <section className="overview-panel overview-panel--status">
                <div className="overview-panel__head">
                  <p className="section-kicker">Live state</p>
                  <StatusBadge label={selectedPortDiagnostic.level} tone={selectedPortDiagnostic.level} />
                </div>

                <div className="overview-list overview-list--dense">
                  {statusRows.map((row) => (
                    <div key={row.label} className="overview-list__row">
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>

                {configuredStatusBits.length > 0 ? (
                  <div className="overview-status-bits">
                    {configuredStatusBits.map((statusBit) => (
                      <div key={statusBit.bit} className="overview-status-bits__item">
                        <span>{statusBit.label}</span>
                        <StatusBadge
                          label={statusBit.active ? 'On' : 'Off'}
                          tone={statusBit.active ? 'normal' : 'neutral'}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="overview-panel overview-panel--diagnostic">
                <div className="overview-panel__head">
                  <p className="section-kicker">AI diagnostics</p>
                  <StatusBadge label={selectedPortDiagnostic.level} tone={selectedPortDiagnostic.level} />
                </div>

                <DiagnosticCard
                  diagnostic={selectedPortDiagnostic}
                  displayConfig={selectedPortDisplayConfig}
                  trendSeries={selectedPortTrendSeries}
                  historyWindowLabel={formatHistoryWindow(
                    historySnapshot?.history_window_ms ?? historyWindowMs,
                  )}
                  variant="detail"
                />
              </section>

              <section className="overview-panel overview-panel--engineering">
                <div className="overview-panel__head">
                  <p className="section-kicker">Engineering and raw detail</p>
                  <StatusBadge label={pdi.connection.mode} tone="normal" />
                </div>

                <div className="overview-debug-grid">
                  <div className="overview-debug-card">
                    <span className="overview-debug-card__label">Raw register</span>
                    <strong className="overview-debug-card__value">
                      {rawRegisterWords.length > 0 ? rawRegisterWords.join(', ') : 'No registers'}
                    </strong>
                    <span className="overview-debug-card__meta">
                      {rawRegisterHex || pdi.payload.hex || 'No payload hex'}
                    </span>
                  </div>

                  <div className="overview-debug-card">
                    <span className="overview-debug-card__label">Extracted field</span>
                    <strong className="overview-debug-card__value">{extractedFieldValue}</strong>
                    <span className="overview-debug-card__meta">
                      {selectedPortDisplayConfig.fieldMode === 'bit_field'
                        ? `Bits ${selectedPortDisplayConfig.bitOffset}-${selectedPortDisplayConfig.bitOffset + selectedPortDisplayConfig.bitLength - 1} | ${selectedPortDisplayConfig.signed ? 'Signed' : 'Unsigned'}`
                        : `Full-word decode | ${selectedPortDisplayConfig.sourceWordCount} source word${selectedPortDisplayConfig.sourceWordCount === 1 ? '' : 's'}`}
                    </span>
                  </div>

                  <div className="overview-debug-card">
                    <span className="overview-debug-card__label">Scaled engineering</span>
                    <strong className="overview-debug-card__value">
                      {scaledEngineeringValue}
                    </strong>
                    <span className="overview-debug-card__meta">
                      {engineeringValueMeta || 'Direct engineering value'}
                    </span>
                  </div>
                </div>

                <div className="overview-list overview-list--compact">
                  {metadataRows.map((row) => (
                    <div key={row.label} className="overview-list__row">
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>

                <div className="overview-raw-grid">
                  <div className="mono-surface">
                    {pdi.payload.registers.join(', ') || 'No registers'}
                  </div>
                  <div className="mono-surface">
                    {pdi.payload.hex || 'No payload hex'}
                  </div>
                </div>
              </section>

              <section className="overview-panel overview-panel--decode">
                <div className="overview-panel__head">
                  <p className="section-kicker">
                    {hasStructuredProcessData ? 'Process data map' : 'Decode matrix'}
                  </p>
                  <StatusBadge
                    label={
                      hasStructuredProcessData
                        ? selectedPortProcessData?.name ?? 'Structured'
                        : selectedPortDisplayConfig.preferredDecodeType
                    }
                    tone="normal"
                  />
                </div>

                {hasStructuredProcessData ? (
                  <div className="overview-process-map">
                    <div className="overview-process-map__summary">
                      <strong>
                        {selectedPortProcessData?.description ?? 'Structured process-data map'}
                      </strong>
                      <span>{processDataSummaryParts.join(' | ')}</span>
                    </div>

                    {selectedPortProcessData?.primaryField ? (
                      <div className="overview-process-primary">
                        <span className="overview-process-primary__label">
                          Primary field
                        </span>
                        <strong className="overview-process-primary__value">
                          {selectedPortProcessData.primaryField.label}: {' '}
                          {selectedPortProcessData.primaryField.displayValue}
                          {selectedPortProcessData.primaryField.unit
                            ? ` ${selectedPortProcessData.primaryField.unit}`
                            : ''}
                        </strong>
                        <span className="overview-process-primary__meta">
                          {selectedPortProcessData.primaryField.bitRangeLabel} |{' '}
                          {selectedPortProcessData.primaryField.bitLength}-bit{' '}
                          {formatProcessDataFieldTypeLabel(selectedPortProcessData.primaryField)}
                          {selectedPortProcessData.primaryField.description
                            ? ` | ${selectedPortProcessData.primaryField.description}`
                            : ''}
                        </span>
                      </div>
                    ) : null}

                    {selectedPortProcessData?.error ? (
                      <p className="overview-process-map__empty">
                        {selectedPortProcessData.error}
                      </p>
                    ) : null}

                    <div className="overview-process-grid">
                      {selectedPortProcessData?.fields.map((field) => (
                        <article key={field.name} className="overview-process-card">
                          <div className="overview-process-card__head">
                            <span className="overview-process-card__label">{field.label}</span>
                            <span className="overview-process-card__role">
                              {(field.role ?? 'field').replace(/_/g, ' ')}
                            </span>
                          </div>
                          <ProcessDataFieldValue field={field} />
                          <div className="overview-process-card__meta-grid">
                            <span className="overview-process-card__meta">
                              {field.bitRangeLabel} | {field.bitLength}-bit{' '}
                              {formatProcessDataFieldTypeLabel(field)}
                            </span>
                            <span className="overview-process-card__meta">
                              Current {field.displayValue}
                              {field.unit ? ` ${field.unit}` : ''}
                              {field.isMapped ? ` | Raw ${field.rawDisplayValue}` : ''}
                            </span>
                            {field.description ? (
                              <span className="overview-process-card__meta">
                                {field.description}
                              </span>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {selectedPortDisplayConfig.processDataMode !== 'manual' ? (
                      <p className="overview-process-map__empty">
                        No matching structured process-data profile resolved for this port yet.
                        Manual engineering decode remains active.
                      </p>
                    ) : null}

                    <div className="overview-decode-grid">
                      {decodeRows.map((row) => (
                        <div key={row.label} className="overview-decode-card">
                          <span className="overview-decode-card__label">{row.label}</span>
                          <strong className="overview-decode-card__value">{row.value}</strong>
                          <span className="overview-decode-card__meta">
                            {row.meta ?? 'Available from the current payload window'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default PortOverviewPage
