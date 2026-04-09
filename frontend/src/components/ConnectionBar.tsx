import { memo, useMemo } from 'react'

import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import { useSmoothedNumber } from '../hooks/useSmoothedNumber'
import StableSelect from './StableSelect'
import StatusBadge from './StatusBadge'

function getConnectionStatusPresentation(
  state: 'healthy' | 'stale' | 'disconnected' | 'polling_error',
  hasSnapshot: boolean,
) {
  switch (state) {
    case 'healthy':
      return {
        label: hasSnapshot ? 'Connected' : 'Warming',
        tone: 'normal' as const,
      }
    case 'stale':
      return {
        label: 'Stale',
        tone: 'warning' as const,
      }
    case 'polling_error':
      return {
        label: 'Error',
        tone: 'critical' as const,
      }
    case 'disconnected':
    default:
      return {
        label: 'Idle',
        tone: 'neutral' as const,
      }
  }
}

function formatLatency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-- ms'
  }

  return `${Math.max(0, Math.round(value))} ms`
}

function ConnectionBar() {
  const workspace = useMonitoringWorkspaceContext()

  const polling = workspace.dashboard?.polling ?? null
  const connection = workspace.dashboard?.connection ?? null
  const smoothedIntervalMs = useSmoothedNumber(polling?.interval_ms ?? 0, {
    durationMs: 420,
    disabled: polling?.interval_ms === null || polling?.interval_ms === undefined,
    precision: 0,
  })
  const smoothedAgeMs = useSmoothedNumber(polling?.age_ms ?? 0, {
    durationMs: 760,
    disabled: polling?.age_ms === null || polling?.age_ms === undefined,
    precision: 0,
  })

  const statusPresentation = useMemo(
    () =>
      getConnectionStatusPresentation(
        workspace.communicationPresentation.state,
        Boolean(polling?.has_snapshot),
      ),
    [polling?.has_snapshot, workspace.communicationPresentation.state],
  )

  const targetLabel = useMemo(() => {
    if (!connection) {
      return 'No active target'
    }

    return `${connection.host}:${connection.port}`
  }, [connection])

  const ratePrimary = useMemo(
    () =>
      formatLatency(
        polling?.configured ? smoothedIntervalMs : polling?.interval_ms ?? null,
      ),
    [polling?.configured, polling?.interval_ms, smoothedIntervalMs],
  )

  const rateMeta = useMemo(() => {
    if (!polling?.configured) {
      return 'Awaiting cache'
    }

    return `age ${formatLatency(smoothedAgeMs)}`
  }, [polling?.configured, smoothedAgeMs])

  async function handleSubmitConnect() {
    await workspace.handleConnect()
  }

  return (
    <section className="connection-bar" aria-label="Connection bar">
      <div className="connection-bar__brand" aria-label="Masterway">
        <img
          className="connection-bar__logo"
          src="/masterway-logo-ui.png"
          alt="Masterway"
        />
      </div>

      <label className="connection-bar__mode-field">
        <StableSelect
          value={workspace.connectionDraft.mode}
          ariaLabel="Connection mode"
          onChange={(nextValue) =>
            workspace.setConnectionDraft({
              ...workspace.connectionDraft,
              mode: nextValue as typeof workspace.connectionDraft.mode,
            })
          }
          disabled={workspace.isConnecting || workspace.isDisconnecting}
          options={[
            { value: 'real', label: 'Real' },
            { value: 'simulator', label: 'Sim' },
          ]}
          className="stable-select--compact"
          triggerClassName="stable-select__trigger--compact"
          menuClassName="stable-select__menu--compact"
        />
      </label>

      <label className="connection-bar__host-field">
        <input
          type="text"
          aria-label="ICE2 host or IP"
          value={workspace.connectionDraft.host}
          onChange={(event) =>
            workspace.setConnectionDraft({
              ...workspace.connectionDraft,
              host: event.target.value,
            })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void handleSubmitConnect()
            }
          }}
          placeholder="192.168.1.108"
          spellCheck={false}
        />
      </label>

      <div className="connection-bar__actions">
        <button
          type="button"
          className="action-button action-button--primary action-button--compact"
          onClick={() => void handleSubmitConnect()}
          disabled={workspace.isConnecting || workspace.isDisconnecting}
        >
          {workspace.isConnecting ? 'Connecting...' : 'Connect'}
        </button>

        <button
          type="button"
          className="action-button action-button--ghost action-button--compact"
          onClick={() => void workspace.handleDisconnect()}
          disabled={
            workspace.isConnecting ||
            workspace.isDisconnecting ||
            !workspace.dashboard?.polling.configured
          }
        >
          {workspace.isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>

      <div className="connection-bar__chip" title={targetLabel}>
        <span className="connection-bar__chip-label">Target</span>
        <strong className="connection-bar__chip-value">{targetLabel}</strong>
      </div>

      <div className="connection-bar__chip connection-bar__chip--status">
        <span className="connection-bar__chip-label">Status</span>
        <StatusBadge label={statusPresentation.label} tone={statusPresentation.tone} />
      </div>

      <div className="connection-bar__chip connection-bar__chip--rate">
        <span className="connection-bar__chip-label">Rate</span>
        <strong className="connection-bar__chip-value">{ratePrimary}</strong>
        <span className="connection-bar__chip-meta">{rateMeta}</span>
      </div>
    </section>
  )
}

export default memo(ConnectionBar)
