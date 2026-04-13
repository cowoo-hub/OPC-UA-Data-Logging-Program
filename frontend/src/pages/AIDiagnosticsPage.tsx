import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { PERF_OVERLAY_ENABLED } from '../api/client'
import type {
  DiagnosticForecastDirection,
  DiagnosticLevel,
  PortDiagnostic,
  PortDisplayConfig,
} from '../api/types'
import AIAnomalyMap from '../components/AIAnomalyMap'
import AIHolographicCore from '../components/AIHolographicCore'
import StatusBadge from '../components/StatusBadge'
import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import { AI_LEARNING_DURATION_OPTIONS } from '../utils/aiLearning'

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
    return 'Stable in normal model'
  }

  switch (dominantReason.code) {
    case 'fault':
      return 'Critical: fault risk'
    case 'drift':
      return dominantReason.title === 'Recovery not yet confirmed'
        ? 'Watch: recovery settling'
        : dominantReason.level === 'critical'
          ? 'Critical: model deviation'
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

function formatLearningTime(ms: number | null) {
  if (ms === null || ms <= 0) {
    return '--'
  }

  if (ms < 60000) {
    return `${Math.ceil(ms / 1000)} s`
  }

  return `${Math.ceil(ms / 60000)} min`
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


function formatLearningValue(value: number | null, unit = '') {
  if (value === null || !Number.isFinite(value)) {
    return '--'
  }

  const absoluteValue = Math.abs(value)
  const precision = absoluteValue >= 100 ? 1 : absoluteValue >= 10 ? 2 : 3
  const formattedValue = value
    .toFixed(precision)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')

  return `${formattedValue}${unit ? ` ${unit}` : ''}`
}

function getLearningProgressPercent(learning: PortDiagnostic['learning'], nowMs: number) {
  if (learning.status === 'trained') {
    return 100
  }

  if (
    learning.status !== 'learning' ||
    learning.startedAtMs === null ||
    learning.targetEndAtMs === null
  ) {
    return 0
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        ((nowMs - learning.startedAtMs) /
          Math.max(1, learning.targetEndAtMs - learning.startedAtMs)) *
          100,
      ),
    ),
  )
}

interface AILearningResultPanelProps {
  diagnostic: PortDiagnostic
  displayConfig: PortDisplayConfig
}

function AILearningResultPanel({
  diagnostic,
  displayConfig,
}: AILearningResultPanelProps) {
  const learning = diagnostic.learning
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (learning.status !== 'learning') {
      return undefined
    }

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [learning.status])

  const unit = learning.unit || displayConfig.engineeringUnit || ''
  const progress = getLearningProgressPercent(learning, nowMs)
  const remainingMs =
    learning.status === 'learning' && learning.targetEndAtMs !== null
      ? Math.max(0, learning.targetEndAtMs - nowMs)
      : null
  const statusTone =
    learning.status === 'trained'
      ? 'normal'
      : learning.status === 'insufficient_data'
        ? 'warning'
        : 'neutral'
  const rangeValue =
    learning.minimumValue === null || learning.maximumValue === null
      ? '--'
      : `${formatLearningValue(learning.minimumValue, unit)} - ${formatLearningValue(
          learning.maximumValue,
          unit,
        )}`
  const toleranceValue =
    learning.bandHalfWidth === null
      ? '--'
      : `+/- ${formatLearningValue(learning.bandHalfWidth, unit)}`
  const message =
    learning.status === 'learning'
      ? `Collecting normal signal behavior. Remaining ${formatLearningTime(remainingMs)}.`
      : learning.message
  const progressStyle = {
    '--learning-progress': `${progress}%`,
  } as CSSProperties & Record<'--learning-progress', string>

  return (
    <section className="ai-holo-panel ai-holo-panel--learning-result">
      <div className="ai-learning-result__body">
        <div className="ai-learning-result__message">
          <div className="ai-learning-result__message-head">
            <p className="section-kicker">Learning result</p>
            <StatusBadge
              label={learning.status.replace('_', ' ').toUpperCase()}
              tone={statusTone}
            />
          </div>
          <strong>
            {learning.status === 'trained' ? 'Learned normal envelope ready' : 'Model readiness'}
          </strong>
          <p>{message}</p>
          <div className="ai-learning-result__meter" style={progressStyle} aria-hidden="true">
            <span />
          </div>
        </div>

        <div className="ai-learning-result__facts">
          <div>
            <span>Window</span>
            <strong>{formatLearningTime(learning.durationMs)}</strong>
          </div>
          <div>
            <span>Samples</span>
            <strong>{learning.sampleCount}</strong>
          </div>
          <div>
            <span>Center</span>
            <strong>{formatLearningValue(learning.baselineValue, unit)}</strong>
          </div>
          <div>
            <span>Range</span>
            <strong>{rangeValue}</strong>
          </div>
          <div>
            <span>Noise sigma</span>
            <strong>{formatLearningValue(learning.standardDeviation, unit)}</strong>
          </div>
          <div>
            <span>Tolerance</span>
            <strong>{toleranceValue}</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function AILearningControlPanel() {
  const workspace = useMonitoringWorkspaceContext()
  const {
    selectedPortNumber,
    selectedPortDiagnostic,
    selectedPortDisplayConfig,
    startPortLearning,
    resetPortLearning,
  } = workspace
  const [durationMs, setDurationMs] = useState(AI_LEARNING_DURATION_OPTIONS[1].value)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const learning = selectedPortDiagnostic.learning

  useEffect(() => {
    if (learning.status !== 'learning') {
      return undefined
    }

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [learning.status])

  const remainingMs =
    learning.status === 'learning' && learning.targetEndAtMs !== null
      ? Math.max(0, learning.targetEndAtMs - nowMs)
      : null
  const learningProgressPercent =
    learning.status === 'trained'
      ? 100
      : learning.status === 'learning' &&
          learning.startedAtMs !== null &&
          learning.targetEndAtMs !== null
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((nowMs - learning.startedAtMs) /
                  Math.max(1, learning.targetEndAtMs - learning.startedAtMs)) *
                  100,
              ),
            ),
          )
        : 0
  const learningGraphStyle = {
    '--learning-progress': `${learningProgressPercent}%`,
  } as CSSProperties & Record<'--learning-progress', string>
  const canReset = learning.status === 'trained' || learning.status === 'insufficient_data'
  const learningStatusText =
    learning.status === 'learning'
      ? `Learning ${learningProgressPercent}%`
      : learning.status === 'trained'
        ? `Trained from ${learning.sampleCount} samples`
        : learning.status === 'insufficient_data'
          ? `Need more samples (${learning.sampleCount})`
          : 'Not trained'

  return (
    <section className="ai-learning-panel" aria-label="Port signal learning">
      <div className="ai-learning-panel__main">
        <div
          className={`ai-learning-orbit ai-learning-orbit--${
            learning.status === 'learning'
              ? 'active'
              : learning.status === 'trained'
                ? 'trained'
                : 'idle'
          }`}
          style={learningGraphStyle}
          aria-label={`Learning progress ${learningProgressPercent}%`}
        >
          <div className="ai-learning-orbit__core">
            <span>{learning.status === 'learning' ? `${learningProgressPercent}%` : learning.status === 'trained' ? 'OK' : 'AI'}</span>
          </div>
        </div>

        <div className="ai-learning-panel__identity">
          <p className="section-kicker">Signal learning</p>
          <h3 className="section-title">Port {selectedPortNumber} model</h3>
        </div>

        <div className="ai-learning-panel__status">
          <StatusBadge
            label={learning.status.replace('_', ' ').toUpperCase()}
            tone={
              learning.status === 'trained'
                ? 'normal'
                : learning.status === 'insufficient_data'
                  ? 'warning'
                  : 'neutral'
            }
          />
          <span title={learning.message}>{learningStatusText}</span>
        </div>
      </div>

      <div className="ai-learning-panel__metrics">
        <span>Profile: {selectedPortDisplayConfig.label}</span>
        <span>Samples: {learning.sampleCount}</span>
        <span>Remaining: {formatLearningTime(remainingMs)}</span>
        <label className="ai-learning-panel__time">
          <span>Learn time</span>
          <select
            value={durationMs}
            disabled={learning.status === 'learning'}
            onChange={(event) => setDurationMs(Number(event.target.value))}
          >
            {AI_LEARNING_DURATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ai-learning-panel__actions">
        <button
          type="button"
          className="action-button action-button--primary action-button--compact"
          disabled={learning.status === 'learning'}
          onClick={() => startPortLearning(selectedPortNumber, durationMs)}
        >
          Start Learning
        </button>

        <button
          type="button"
          className="action-button action-button--ghost action-button--compact"
          disabled={!canReset}
          onClick={() => resetPortLearning(selectedPortNumber)}
        >
          Reset Model
        </button>
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

        </section>
      </div>

      <AILearningControlPanel />

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

          <AILearningResultPanel
            diagnostic={selectedPortDiagnostic}
            displayConfig={selectedPortDisplayConfig}
          />

          <section className="ai-holo-panel ai-holo-panel--analysis">
            <div className="ai-holo-panel__head">
              <div>
                <p className="section-kicker">Current AI analysis</p>
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
          <div className="ai-holo-future-bar">
            <div>
              <p className="section-kicker">Future prediction</p>
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
              <strong className="ai-holo-diagnosis__value">
                {selectedPortDiagnostic.forecast.summary}
              </strong>
            </div>

            <div className="ai-holo-future__facts ai-holo-future__facts--compact">
              <div className="ai-holo-future__fact">
                <span>Risk</span>
                <strong>{selectedPortDiagnostic.projectedRiskScore}%</strong>
              </div>
              <div className="ai-holo-future__fact">
                <span>Probability</span>
                <strong>{selectedPortDiagnostic.forecast.worseningProbability}%</strong>
              </div>
              <div className="ai-holo-future__fact">
                <span>Next</span>
                <strong>{selectedPortDiagnostic.forecast.expectedState}</strong>
              </div>
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
