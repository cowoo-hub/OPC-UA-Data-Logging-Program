import type { ChangeEvent } from 'react'

import type { ConnectionDraft, ConnectionInfo } from '../api/types'
import StatusBadge from './StatusBadge'

interface ConnectionPanelProps {
  value: ConnectionDraft
  backendConnection: ConnectionInfo | null
  configured: boolean
  monitorPaused: boolean
  isConnecting: boolean
  onChange: (nextValue: ConnectionDraft) => void
  onConnect: () => void
  onDisconnect: () => void
}

function ConnectionPanel({
  value,
  backendConnection,
  configured,
  monitorPaused,
  isConnecting,
  onChange,
  onConnect,
  onDisconnect,
}: ConnectionPanelProps) {
  const updateField =
    (field: keyof ConnectionDraft) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange({
        ...value,
        [field]: event.target.value,
      })
    }

  const connectionStateLabel = monitorPaused
    ? 'Paused'
    : configured
      ? 'Live'
      : 'Not configured'

  const connectionStateTone = monitorPaused
    ? 'warning'
    : configured
      ? 'normal'
      : 'neutral'

  const backendSummary = backendConnection
    ? `${backendConnection.host}:${backendConnection.port} | slave ${backendConnection.slave_id}`
    : 'No backend target configured'

  return (
    <section className="control-panel control-panel--connection">
      <div className="control-panel__header">
        <div>
          <p className="section-kicker">Connection control</p>
          <h2 className="section-title">Backend target session</h2>
        </div>
        <div className="control-panel__status-stack">
          <StatusBadge label={connectionStateLabel} tone={connectionStateTone} />
          <StatusBadge
            label={configured ? 'Backend configured' : 'Awaiting target'}
            tone={configured ? 'normal' : 'neutral'}
          />
        </div>
      </div>

      <p className="control-panel__hint">
        The current backend API exposes <code>/connect</code> but no disconnect
        endpoint yet. Disconnect pauses live reads in the frontend while
        preserving the backend contract exactly as implemented.
      </p>

      <div className="connection-grid">
        <label className="control-field">
          <span className="control-field__label">Host</span>
          <input
            type="text"
            value={value.host}
            onChange={updateField('host')}
            placeholder="ice2-simulator"
            spellCheck={false}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Port</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            value={value.port}
            onChange={updateField('port')}
            placeholder="502"
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Slave ID</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={value.slaveId}
            onChange={updateField('slaveId')}
            placeholder="1"
          />
        </label>

        <div className="connection-actions">
          <button
            type="button"
            className="action-button action-button--primary"
            onClick={onConnect}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
          <button
            type="button"
            className="action-button action-button--ghost"
            onClick={onDisconnect}
            disabled={isConnecting}
          >
            Disconnect
          </button>
        </div>
      </div>

      <div className="control-panel__footer">
        <div className="detail-chip detail-chip--wide">
          <span className="detail-chip__label">Current backend target</span>
          <strong className="detail-chip__value detail-chip__value--mono">
            {backendSummary}
          </strong>
        </div>
      </div>
    </section>
  )
}

export default ConnectionPanel
