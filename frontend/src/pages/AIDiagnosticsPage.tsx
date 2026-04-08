import { useMemo, useState, type FormEvent } from 'react'

import {
  HISTORY_EXPORT_RANGES,
  PERF_OVERLAY_ENABLED,
  downloadPortHistoryCsv,
  getHistoryExportRangeByWindowMs,
} from '../api/client'
import type {
  DiagnosticForecastDirection,
  DiagnosticLevel,
  HistoryExportRange,
  PortDiagnostic,
  PortDisplayConfig,
  PortSnapshot,
} from '../api/types'
import AIAnomalyMap from '../components/AIAnomalyMap'
import AIHolographicCore from '../components/AIHolographicCore'
import StatusBadge from '../components/StatusBadge'
import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import { formatLocalDateTimeDisplay } from '../utils/history'

function getSystemLevel(diagnostics: PortDiagnostic[]): DiagnosticLevel {
  if (diagnostics.some((diagnostic) => diagnostic.level === 'critical')) {
    return 'critical'
  }

  if (diagnostics.some((diagnostic) => diagnostic.level === 'warning')) {
    return 'warning'
  }

  return 'normal'
}

function getDirectionLabel(direction: DiagnosticForecastDirection) {
  switch (direction) {
    case 'rising':
      return 'UPWARD'
    case 'falling':
      return 'DOWNWARD'
    case 'stable':
      return 'STABLE'
    case 'unknown':
    default:
      return 'UNKNOWN'
  }
}

function getShortPortSummary(diagnostic: PortDiagnostic) {
  const dominantReason = diagnostic.reasons[0]

  if (!dominantReason) {
    return 'Stable within learned band'
  }

  switch (dominantReason.code) {
    case 'fault':
      return 'Critical: fault risk'
    case 'drift':
      return dominantReason.title === 'Recovery not yet confirmed'
        ? 'Watch: recovery settling'
        : dominantReason.level === 'critical'
          ? 'Critical: baseline deviation'
          : 'Watch: mild drift'
    case 'spike':
      return 'Watch: sudden deviation'
    case 'stale_data':
      return 'Watch: stale evidence'
    case 'polling_error':
      return 'Critical: communication loss'
    case 'invalid_pdi':
      return 'Watch: invalid process data'
    case 'sentinel_value':
      return dominantReason.title === 'No measurement data'
        ? 'Watch: no measurement data'
        : dominantReason.title === 'No echo condition'
          ? 'Watch: no echo'
          : dominantReason.title === 'Out-of-range condition'
            ? 'Watch: out of range'
            : dominantReason.level === 'critical'
              ? 'Critical: invalid measurement'
              : 'Watch: invalid measurement'
    case 'value_out_of_range':
      return dominantReason.level === 'critical'
        ? 'Critical: envelope breach'
        : 'Watch: outside envelope'
    case 'flatline':
      return 'Watch: signal flatline'
    case 'event_code':
      return 'Watch: device event active'
    case 'no_snapshot':
      return 'Watch: no live evidence'
    default:
      return diagnostic.level === 'normal'
        ? 'Stable: no anomaly'
        : `${diagnostic.level === 'critical' ? 'Critical' : 'Watch'}: review required`
  }
}

function buildActionItems(diagnostic: PortDiagnostic) {
  const leadCause = diagnostic.probableCauses[0]
  const firstEvidence = diagnostic.evidence[0]

  return [
    {
      title:
        diagnostic.level === 'critical'
          ? 'Intervene immediately'
          : diagnostic.level === 'warning'
            ? 'Stabilize selected port'
            : 'Maintain intelligent watch',
      rationale:
        diagnostic.suggestedAction,
    },
    {
      title: 'Validate likely cause',
      rationale: leadCause
        ? `${leadCause.title}: ${leadCause.detail}`
        : 'No dominant anomaly driver is currently overriding the signal.',
    },
    {
      title: 'Prepare next-state response',
      rationale:
        diagnostic.forecast.worseningProbability >= 60
          ? `Forecast risk is ${diagnostic.forecast.worseningProbability}% over ${diagnostic.forecast.horizonLabel}.`
          : firstEvidence
            ? `${firstEvidence.label}: ${firstEvidence.detail}`
            : diagnostic.forecast.expectedState,
    },
  ]
}

const AI_EXPORT_RANGE_PATTERNS: Array<{
  value: HistoryExportRange
  label: string
  patterns: RegExp[]
}> = [
  {
    value: '30s',
    label: 'last 30 seconds',
    patterns: [/\b30\s*(?:s|sec|secs|second|seconds)\b/i],
  },
  {
    value: '2min',
    label: 'last 2 minutes',
    patterns: [/\b2\s*(?:m|min|mins|minute|minutes)\b/i],
  },
  {
    value: '10min',
    label: 'last 10 minutes',
    patterns: [/\b10\s*(?:m|min|mins|minute|minutes)\b/i],
  },
  {
    value: '15min',
    label: 'last 15 minutes',
    patterns: [/\b15\s*(?:m|min|mins|minute|minutes)\b/i],
  },
  {
    value: '30min',
    label: 'last 30 minutes',
    patterns: [/\b30\s*(?:m|min|mins|minute|minutes)\b/i],
  },
  {
    value: '1h',
    label: 'last 1 hour',
    patterns: [/\b1\s*(?:h|hr|hour)\b/i, /\b60\s*(?:m|min|mins|minute|minutes)\b/i],
  },
]

interface ParsedCustomRange {
  start: string
  end: string
  label: string
}

interface ParsedExportIntent {
  portNumber: number
  rangeValue: HistoryExportRange | null
  customRange: ParsedCustomRange | null
  requiresCustomRangeDetails: boolean
}

function normalizePromptDateToken(value: string) {
  const trimmed = value.trim().replace(/\s+/g, ' ')

  if (!trimmed) {
    return null
  }

  const isoLikeValue = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed
  const parsedTimestamp = new Date(isoLikeValue)

  if (Number.isNaN(parsedTimestamp.valueOf())) {
    return null
  }

  return {
    iso: parsedTimestamp.toISOString(),
    label: formatLocalDateTimeDisplay(parsedTimestamp),
    timestampMs: parsedTimestamp.valueOf(),
  }
}

function parseCustomExportRange(question: string): ParsedCustomRange | null {
  const explicitRangeMatch = question.match(/\bfrom\s+(.+?)\s+(?:to|until)\s+(.+)$/i)

  if (!explicitRangeMatch) {
    return null
  }

  const start = normalizePromptDateToken(explicitRangeMatch[1])
  const end = normalizePromptDateToken(explicitRangeMatch[2])

  if (!start || !end || start.timestampMs >= end.timestampMs) {
    return null
  }

  return {
    start: start.iso,
    end: end.iso,
    label: `${start.label} to ${end.label}`,
  }
}

function parseExportIntent(
  question: string,
  {
    selectedPortNumber,
    defaultRange,
  }: {
    selectedPortNumber: number
    defaultRange: HistoryExportRange
  },
): ParsedExportIntent | null {
  const normalizedQuestion = question.toLowerCase()
  const isExportRequest =
    normalizedQuestion.includes('export') || normalizedQuestion.includes('download')

  if (!isExportRequest) {
    return null
  }

  const portMatch = normalizedQuestion.match(/\bport\s+([1-8])\b/)
  const portNumber = portMatch ? Number(portMatch[1]) : selectedPortNumber
  const customRange = parseCustomExportRange(question)
  const matchedRange =
    AI_EXPORT_RANGE_PATTERNS.find((rangeOption) =>
      rangeOption.patterns.some((pattern) => pattern.test(question)),
    )?.value ?? defaultRange

  if (customRange) {
    return {
      portNumber,
      rangeValue: null,
      customRange,
      requiresCustomRangeDetails: false,
    }
  }

  return {
    portNumber,
    rangeValue: matchedRange,
    customRange: null,
    requiresCustomRangeDetails: /\bcustom\s+range\b/i.test(question),
  }
}

function buildAskAnythingReply(
  question: string,
  diagnostic: PortDiagnostic,
  portNumber: number,
  displayLabel: string,
) {
  const normalizedQuestion = question.toLowerCase()
  const leadCause = diagnostic.probableCauses[0]
  const leadEvidence = diagnostic.evidence[0]

  if (
    normalizedQuestion.includes('why') ||
    normalizedQuestion.includes('cause') ||
    normalizedQuestion.includes('reason')
  ) {
    return leadCause
      ? `Port ${portNumber} (${displayLabel}) is reading as ${diagnostic.currentInterpretation}. The strongest cause is ${leadCause.title.toLowerCase()}: ${leadCause.detail}`
      : `Port ${portNumber} is currently ${diagnostic.currentInterpretation.toLowerCase()}, with no single dominant anomaly driver overriding the learned signal band.`
  }

  if (
    normalizedQuestion.includes('next') ||
    normalizedQuestion.includes('future') ||
    normalizedQuestion.includes('predict') ||
    normalizedQuestion.includes('risk')
  ) {
    return `Near-term forecast for Port ${portNumber}: ${diagnostic.forecast.summary} Expected state: ${diagnostic.forecast.expectedState}. Escalation probability is ${diagnostic.forecast.worseningProbability}%.`
  }

  if (
    normalizedQuestion.includes('action') ||
    normalizedQuestion.includes('do') ||
    normalizedQuestion.includes('recommend')
  ) {
    return `Recommended action for Port ${portNumber}: ${diagnostic.suggestedAction}`
  }

  if (
    normalizedQuestion.includes('stable') ||
    normalizedQuestion.includes('noise') ||
    normalizedQuestion.includes('band') ||
    normalizedQuestion.includes('fluctuation')
  ) {
    return `Signal quality is ${diagnostic.signalQuality.label}. ${diagnostic.signalQuality.summary}`
  }

  return leadEvidence
    ? `Port ${portNumber} is currently ${diagnostic.currentInterpretation.toLowerCase()}. ${leadEvidence.label}: ${leadEvidence.detail}`
    : `Port ${portNumber} is currently ${diagnostic.currentInterpretation.toLowerCase()}. ${diagnostic.suggestedAction}`
}

interface AIAskAnythingPanelProps {
  diagnostic: PortDiagnostic
  portNumber: number
  displayLabel: string
  defaultExportRange: HistoryExportRange
  historyRetentionMs: number
  portSnapshotsByNumber: Record<number, PortSnapshot>
  displayConfigsByPort: Record<number, PortDisplayConfig>
  diagnosticsByPort: Record<number, PortDiagnostic>
  latestTimestampByPort: Record<number, number | null>
}

function AIAskAnythingPanel({
  diagnostic,
  portNumber,
  displayLabel,
  defaultExportRange,
  historyRetentionMs,
  portSnapshotsByNumber,
  displayConfigsByPort,
  diagnosticsByPort,
  latestTimestampByPort,
}: AIAskAnythingPanelProps) {
  const [askPrompt, setAskPrompt] = useState('')
  const [askReply, setAskReply] = useState<string | null>(null)
  const [isHandlingAsk, setIsHandlingAsk] = useState(false)

  async function handleAskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = askPrompt.trim()

    if (!trimmedPrompt) {
      return
    }

    const exportIntent = parseExportIntent(trimmedPrompt, {
      selectedPortNumber: portNumber,
      defaultRange: defaultExportRange,
    })

    if (exportIntent) {
      if (exportIntent.requiresCustomRangeDetails) {
        setAskReply(
          'Custom CSV export is ready. Ask with exact bounds such as "export CSV from 2026-04-06 09:00 to 2026-04-06 09:30", or use the custom export fields in Port Overview.',
        )
        return
      }

      const targetDisplayConfig = displayConfigsByPort[exportIntent.portNumber]
      const targetSnapshot = portSnapshotsByNumber[exportIntent.portNumber]
      const targetDiagnostic = diagnosticsByPort[exportIntent.portNumber]
      const latestTimestampMs = latestTimestampByPort[exportIntent.portNumber]

      if (!targetDisplayConfig || !targetDiagnostic) {
        setAskReply(`Port ${exportIntent.portNumber} does not have an exportable profile yet.`)
        return
      }

      if (exportIntent.customRange && latestTimestampMs) {
        const startMs = Date.parse(exportIntent.customRange.start)
        const endMs = Date.parse(exportIntent.customRange.end)
        const earliestRetainedMs = latestTimestampMs - historyRetentionMs

        if (startMs < earliestRetainedMs || endMs > latestTimestampMs) {
          setAskReply(
            `Custom CSV export for Port ${exportIntent.portNumber} must stay inside retained history: ${formatLocalDateTimeDisplay(earliestRetainedMs)} to ${formatLocalDateTimeDisplay(latestTimestampMs)}.`,
          )
          return
        }
      }

      setIsHandlingAsk(true)

      try {
        await downloadPortHistoryCsv({
          portNumber: exportIntent.portNumber,
          exportMode: exportIntent.customRange ? 'custom' : 'preset',
          range: exportIntent.rangeValue ?? undefined,
          customRange:
            exportIntent.customRange === null
              ? undefined
              : {
                  start: exportIntent.customRange.start,
                  end: exportIntent.customRange.end,
                },
          displayConfig: targetDisplayConfig,
          status: targetSnapshot?.severity ?? null,
          eventCode: targetSnapshot?.pdi
            ? String(targetSnapshot.pdi.header.event_code.raw)
            : null,
          anomalyState: targetDiagnostic.level,
        })

        setAskReply(
          exportIntent.customRange
            ? `CSV export started for Port ${exportIntent.portNumber} using the custom interval ${exportIntent.customRange.label}.`
            : `CSV export started for Port ${exportIntent.portNumber} using ${AI_EXPORT_RANGE_PATTERNS.find((rangeOption) => rangeOption.value === exportIntent.rangeValue)?.label ?? 'the selected window'}.`,
        )
      } catch (exportError) {
        setAskReply(
          exportError instanceof Error
            ? exportError.message
            : 'CSV export failed.',
        )
      } finally {
        setIsHandlingAsk(false)
      }

      return
    }

    setAskReply(buildAskAnythingReply(trimmedPrompt, diagnostic, portNumber, displayLabel))
  }

  return (
    <section className="ai-holo-panel ai-holo-panel--ask">
      <div className="ai-holo-panel__head">
        <div>
          <p className="section-kicker">Ask Anything</p>
          <h3 className="section-title">Contextual AI collaboration</h3>
        </div>
      </div>

      <form className="ai-holo-ask" onSubmit={handleAskSubmit}>
        <input
          type="text"
          value={askPrompt}
          onChange={(event) => setAskPrompt(event.target.value)}
          placeholder={`Ask about Port ${portNumber} behavior, risk, or next action`}
          aria-label="Ask the AI about the selected port"
        />
        <button
          type="submit"
          className="action-button action-button--primary action-button--compact"
          disabled={isHandlingAsk}
        >
          {isHandlingAsk ? 'Working...' : 'Ask'}
        </button>
      </form>

      <div className="ai-holo-ask__response" aria-live="polite">
        <span className="ai-holo-ask__response-label">AI guidance</span>
        <p>
          {askReply ??
            `Ask the AI to explain Port ${portNumber}, interpret the current condition, or suggest the next operator action.`}
        </p>
      </div>
    </section>
  )
}

function AIDiagnosticsPage() {
  const workspace = useMonitoringWorkspaceContext()
  const {
    ports,
    diagnosticsByPort,
    resolvedPortDisplayConfigs,
    selectedPortNumber,
    selectedPortDiagnostic,
    selectedPortDisplayConfig,
    selectedPortTrendSeries,
    trendSeriesByPort,
    historySnapshot,
    historyWindowMs,
    setSelectedPortNumber,
  } = workspace

  const insightRecords = useMemo(
    () =>
      ports.map((snapshot) => ({
        portNumber: snapshot.portNumber,
        diagnostic: diagnosticsByPort[snapshot.portNumber],
        displayConfig: resolvedPortDisplayConfigs[snapshot.portNumber],
      })),
    [diagnosticsByPort, ports, resolvedPortDisplayConfigs],
  )

  const prioritizedRecords = useMemo(
    () =>
      [...insightRecords].sort((left, right) => {
        if (right.diagnostic.projectedRiskScore !== left.diagnostic.projectedRiskScore) {
          return right.diagnostic.projectedRiskScore - left.diagnostic.projectedRiskScore
        }

        return right.diagnostic.anomalyScore - left.diagnostic.anomalyScore
      }),
    [insightRecords],
  )

  const leadRecord = prioritizedRecords[0] ?? null
  const systemLevel = useMemo(
    () => getSystemLevel(prioritizedRecords.map((record) => record.diagnostic)),
    [prioritizedRecords],
  )
  const primaryIssue =
    leadRecord?.diagnostic.summary ?? 'Awaiting cached intelligence evidence.'
  const systemTrend = getDirectionLabel(
    leadRecord?.diagnostic.forecast.direction ?? 'unknown',
  )
  const systemConfidence = leadRecord?.diagnostic.confidenceScore ?? 0
  const anomalyItems = useMemo(
    () =>
      insightRecords.map((record) => ({
        portNumber: record.portNumber,
        level: record.diagnostic.level,
        title: `Port ${record.portNumber}`,
        summary: getShortPortSummary(record.diagnostic),
        aiScore: record.diagnostic.anomalyScore,
      })),
    [insightRecords],
  )
  const rootCauses = useMemo(
    () => selectedPortDiagnostic.probableCauses.slice(0, 3),
    [selectedPortDiagnostic],
  )
  const portSnapshotsByNumber = useMemo(
    () =>
      ports.reduce<Record<number, PortSnapshot>>((accumulator, snapshot) => {
        accumulator[snapshot.portNumber] = snapshot
        return accumulator
      }, {}),
    [ports],
  )
  const latestTimestampByPort = useMemo(
    () =>
      Object.entries(trendSeriesByPort).reduce<Record<number, number | null>>(
        (accumulator, [portKey, series]) => {
          accumulator[Number(portKey)] = series.latestTimestampMs
          return accumulator
        },
        {},
      ),
    [trendSeriesByPort],
  )
  const evidenceItems = useMemo(
    () => selectedPortDiagnostic.evidence.slice(0, 3),
    [selectedPortDiagnostic],
  )
  const actionItems = useMemo(
    () => buildActionItems(selectedPortDiagnostic),
    [selectedPortDiagnostic],
  )
  const actionPriority =
    selectedPortDiagnostic.projectedRiskScore >= 75
      ? 'Critical'
      : selectedPortDiagnostic.projectedRiskScore >= 42
        ? 'Priority'
        : 'Routine'
  const defaultExportRange =
    getHistoryExportRangeByWindowMs(historySnapshot?.history_window_ms ?? historyWindowMs)
      ?.value ?? HISTORY_EXPORT_RANGES[0].value

  return (
    <div className="workspace-page workspace-page--ai-holo">
      <div className="ai-holo-top-stack">
        {PERF_OVERLAY_ENABLED ? (
          <aside className="ai-holo-perf-strip" aria-label="AI performance telemetry">
            <span>POLL {workspace.dashboard?.polling.interval_ms ?? 0} ms</span>
            <span>HIST {workspace.dashboard?.polling.history_sample_interval_ms ?? 0} ms</span>
            <span>CACHE {workspace.dashboard?.polling.age_ms ?? 0} ms</span>
            <span>UI {workspace.uiRefreshMs} ms</span>
          </aside>
        ) : null}

        <section className="ai-holo-strip">
          <div className="ai-holo-strip__item">
            <span className="ai-holo-strip__label">System status</span>
            <StatusBadge label={systemLevel.toUpperCase()} tone={systemLevel} />
          </div>

          <div className="ai-holo-strip__item ai-holo-strip__item--primary">
            <span className="ai-holo-strip__label">Primary issue</span>
            <strong className="ai-holo-strip__value" title={primaryIssue}>
              {primaryIssue}
            </strong>
          </div>

          <div className="ai-holo-strip__item">
            <span className="ai-holo-strip__label">Trend</span>
            <strong className="ai-holo-strip__value">{systemTrend}</strong>
          </div>

          <div className="ai-holo-strip__item">
            <span className="ai-holo-strip__label">Confidence</span>
            <strong className="ai-holo-strip__value">{systemConfidence}%</strong>
          </div>
        </section>
      </div>

      <section className="ai-holo-layout">
        <AIAnomalyMap
          items={anomalyItems}
          selectedPortNumber={selectedPortNumber}
          onSelect={setSelectedPortNumber}
        />

        <section className="ai-holo-center">
          <AIHolographicCore
            diagnostic={selectedPortDiagnostic}
            displayConfig={selectedPortDisplayConfig}
            selectedPortNumber={selectedPortNumber}
            trendSeries={selectedPortTrendSeries}
          />

          <AIAskAnythingPanel
            key={selectedPortNumber}
            diagnostic={selectedPortDiagnostic}
            portNumber={selectedPortNumber}
            displayLabel={selectedPortDisplayConfig.label}
            defaultExportRange={defaultExportRange}
            historyRetentionMs={historySnapshot?.history_retention_ms ?? 0}
            portSnapshotsByNumber={portSnapshotsByNumber}
            displayConfigsByPort={resolvedPortDisplayConfigs}
            diagnosticsByPort={diagnosticsByPort}
            latestTimestampByPort={latestTimestampByPort}
          />

          <section className="ai-holo-panel ai-holo-panel--analysis">
            <div className="ai-holo-panel__head">
              <div>
                <p className="section-kicker">Current AI analysis</p>
                <h3 className="section-title">Diagnosis and reasoning</h3>
              </div>
            </div>

            <div className="ai-holo-diagnosis">
              <span className="ai-holo-diagnosis__label">Diagnosis</span>
              <strong className="ai-holo-diagnosis__value">
                {selectedPortDiagnostic.currentInterpretation}
              </strong>
            </div>

            <div className="ai-holo-analysis-grid">
              <div className="ai-holo-analysis-column">
                <span className="ai-holo-analysis-column__label">Root causes</span>
                <div className="ai-holo-analysis-list">
                  {rootCauses.map((cause) => (
                    <article key={cause.title} className="ai-holo-analysis-item">
                      <div className="ai-holo-analysis-item__head">
                        <strong>{cause.title}</strong>
                        <span>{cause.weight}%</span>
                      </div>
                      <p>{cause.detail}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="ai-holo-analysis-column">
                <span className="ai-holo-analysis-column__label">Evidence</span>
                <div className="ai-holo-analysis-list">
                  {evidenceItems.map((evidence) => (
                    <article
                      key={evidence.label}
                      className="ai-holo-analysis-item ai-holo-analysis-item--evidence"
                    >
                      <strong>{evidence.label}</strong>
                      <p>{evidence.detail}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </section>

        <section className="ai-holo-panel ai-holo-panel--future">
          <div className="ai-holo-panel__head">
            <div>
              <p className="section-kicker">Future prediction</p>
              <h3 className="section-title">Projected next state</h3>
            </div>
            <StatusBadge
              label={selectedPortDiagnostic.forecast.direction}
              tone={
                selectedPortDiagnostic.forecast.direction === 'rising'
                  ? 'warning'
                  : selectedPortDiagnostic.forecast.direction === 'falling'
                    ? 'normal'
                    : 'neutral'
              }
            />
          </div>

          <div className="ai-holo-future__summary">
            <span className="ai-holo-diagnosis__label">Prediction summary</span>
            <strong className="ai-holo-diagnosis__value">
              {selectedPortDiagnostic.forecast.summary}
            </strong>
          </div>

          <div className="ai-holo-future__facts">
            <div className="ai-holo-future__fact">
              <span>Escalation risk</span>
              <strong>{selectedPortDiagnostic.projectedRiskScore}%</strong>
            </div>
            <div className="ai-holo-future__fact">
              <span>Forecast probability</span>
              <strong>{selectedPortDiagnostic.forecast.worseningProbability}%</strong>
            </div>
            <div className="ai-holo-future__fact">
              <span>Likely next state</span>
              <strong>{selectedPortDiagnostic.forecast.expectedState}</strong>
            </div>
            <div className="ai-holo-future__fact">
              <span>Confidence</span>
              <strong>{selectedPortDiagnostic.confidenceScore}%</strong>
            </div>
          </div>
        </section>
      </section>

      <section className="ai-holo-action">
        <div className="ai-holo-action__head">
          <div>
            <p className="section-kicker">Action engine</p>
            <h3 className="section-title">Recommended actions</h3>
          </div>
          <StatusBadge
            label={actionPriority}
            tone={
              actionPriority === 'Critical'
                ? 'critical'
                : actionPriority === 'Priority'
                  ? 'warning'
                  : 'normal'
            }
          />
        </div>

        <div className="ai-holo-action__list">
          {actionItems.map((action) => (
            <article key={action.title} className="ai-holo-action__item">
              <strong>{action.title}</strong>
              <p>{action.rationale}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export default AIDiagnosticsPage
