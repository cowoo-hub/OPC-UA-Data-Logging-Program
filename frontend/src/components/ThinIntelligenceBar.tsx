import { memo, useMemo } from 'react'

import type {
  DiagnosticForecastDirection,
  DiagnosticLevel,
  PortSeverity,
} from '../api/types'
import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import StatusBadge, { type StatusTone } from './StatusBadge'

function mapSeverityToPresentation(
  severity: PortSeverity,
): { label: string; tone: StatusTone } {
  switch (severity) {
    case 'critical':
      return { label: 'Critical', tone: 'critical' }
    case 'warning':
      return { label: 'Warning', tone: 'warning' }
    case 'normal':
    default:
      return { label: 'Stable', tone: 'normal' }
  }
}

function mapCommunicationStateToStatus(
  state: 'healthy' | 'stale' | 'disconnected' | 'polling_error',
): { label: string; tone: StatusTone } {
  switch (state) {
    case 'healthy':
      return { label: 'Stable', tone: 'normal' }
    case 'stale':
      return { label: 'Warning', tone: 'warning' }
    case 'polling_error':
    case 'disconnected':
    default:
      return { label: 'Critical', tone: 'critical' }
  }
}

function mapAiState(level: DiagnosticLevel): { label: string; tone: StatusTone } {
  switch (level) {
    case 'critical':
      return { label: 'AI CRITICAL', tone: 'critical' }
    case 'warning':
      return { label: 'AI WARN', tone: 'warning' }
    case 'normal':
    default:
      return { label: 'AI OK', tone: 'normal' }
  }
}

function mapTrend(direction: DiagnosticForecastDirection): {
  arrow: string
  label: string
  tone: StatusTone
} {
  switch (direction) {
    case 'rising':
      return { arrow: '^', label: 'Increasing', tone: 'warning' }
    case 'falling':
      return { arrow: 'v', label: 'Decreasing', tone: 'normal' }
    case 'stable':
      return { arrow: '=', label: 'Stable', tone: 'neutral' }
    case 'unknown':
    default:
      return { arrow: '?', label: 'Unknown', tone: 'neutral' }
  }
}

function formatPrimaryValue(
  displayValue: string | undefined,
  engineeringUnit: string | null,
  hasSentinel: boolean,
) {
  const safeDisplayValue =
    !displayValue || displayValue.trim().length === 0 ? 'Unavailable' : displayValue

  if (safeDisplayValue === 'Unavailable' || hasSentinel || !engineeringUnit) {
    return {
      value: safeDisplayValue,
      unit: null as string | null,
    }
  }

  return {
    value: safeDisplayValue,
    unit: engineeringUnit,
  }
}

function formatLatency(latencyMs: number | null) {
  if (latencyMs === null || !Number.isFinite(latencyMs)) {
    return '-- ms'
  }

  return `${Math.max(0, Math.round(latencyMs))} ms`
}

function ThinIntelligenceBar() {
  const workspace = useMonitoringWorkspaceContext()
  const selectedPreview =
    workspace.featuredDecodesByPort[workspace.selectedPortNumber] ?? null

  const statusPresentation = useMemo(() => {
    if (workspace.selectedPortSnapshot.pdi) {
      return mapSeverityToPresentation(workspace.selectedPortSnapshot.severity)
    }

    return mapCommunicationStateToStatus(workspace.communicationPresentation.state)
  }, [
    workspace.communicationPresentation.state,
    workspace.selectedPortSnapshot.pdi,
    workspace.selectedPortSnapshot.severity,
  ])

  const primaryValue = useMemo(
    () =>
      formatPrimaryValue(
        selectedPreview?.displayValue,
        workspace.selectedPortDisplayConfig.engineeringUnit,
        Boolean(selectedPreview?.sentinelLabel),
      ),
    [
      selectedPreview?.displayValue,
      selectedPreview?.sentinelLabel,
      workspace.selectedPortDisplayConfig.engineeringUnit,
    ],
  )

  const trend = useMemo(
    () => mapTrend(workspace.selectedPortDiagnostic.forecast.direction),
    [workspace.selectedPortDiagnostic.forecast.direction],
  )

  const aiState = useMemo(
    () => mapAiState(workspace.selectedPortDiagnostic.level),
    [workspace.selectedPortDiagnostic.level],
  )

  const latencyValue = useMemo(
    () =>
      formatLatency(
        workspace.dashboard?.polling.age_ms ?? workspace.dashboard?.polling.interval_ms ?? null,
      ),
    [workspace.dashboard?.polling.age_ms, workspace.dashboard?.polling.interval_ms],
  )

  return (
    <section className="thin-intelligence-bar" aria-label="Thin intelligence bar">
      <div className="thin-intelligence-bar__brand" aria-label="Masterway">
        <img
          className="thin-intelligence-bar__logo"
          src="/masterway-logo-ui.png"
          alt="Masterway"
        />
      </div>

      <div className="thin-intelligence-bar__item" aria-label={`Selected port Port ${workspace.selectedPortNumber}`}>
        <strong className="thin-intelligence-bar__value thin-intelligence-bar__value--mono">
          Port {workspace.selectedPortNumber}
        </strong>
      </div>

      <div className="thin-intelligence-bar__item" aria-label={`Selected port status ${statusPresentation.label}`}>
        <StatusBadge label={statusPresentation.label} tone={statusPresentation.tone} />
      </div>

      <div
        className="thin-intelligence-bar__item thin-intelligence-bar__item--value"
        aria-label={`Primary process value ${primaryValue.value}${primaryValue.unit ? ` ${primaryValue.unit}` : ''}`}
        title={`${primaryValue.value}${primaryValue.unit ? ` ${primaryValue.unit}` : ''}`}
      >
        <strong className="thin-intelligence-bar__value">{primaryValue.value}</strong>
        {primaryValue.unit ? (
          <span className="thin-intelligence-bar__unit">{primaryValue.unit}</span>
        ) : null}
      </div>

      <div className="thin-intelligence-bar__item thin-intelligence-bar__item--trend">
        <span
          className={`thin-intelligence-bar__trend thin-intelligence-bar__trend--${trend.tone}`}
          aria-label={`Trend ${trend.label}`}
          title={trend.label}
        >
          {trend.arrow}
        </span>
      </div>

      <div className="thin-intelligence-bar__item" aria-label={`AI state ${aiState.label}`}>
        <StatusBadge label={aiState.label} tone={aiState.tone} />
      </div>

      <div className="thin-intelligence-bar__item" aria-label={`Latency ${latencyValue}`}>
        <strong className="thin-intelligence-bar__value thin-intelligence-bar__value--mono">
          {latencyValue}
        </strong>
      </div>
    </section>
  )
}

export default memo(ThinIntelligenceBar)
