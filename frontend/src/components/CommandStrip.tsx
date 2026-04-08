import type { ChangeEvent } from 'react'

import type { ConnectionDraft } from '../api/types'
import type { BannerState, StatusTone } from '../hooks/useMonitoringWorkspace'
import StableSelect from './StableSelect'
import StatusBadge from './StatusBadge'

interface CommandStripProps {
  connectionDraft: ConnectionDraft
  backendMode: string
  connectionSummary: string
  connectionMeta: string
  communicationStateLabel: string
  communicationTone: StatusTone
  staleStateLabel: string
  staleStateTone: StatusTone
  lastUpdatedLabel: string | null
  banner: BannerState
  isConnecting: boolean
  isDisconnecting: boolean
  onConnectionChange: (nextValue: ConnectionDraft) => void
  onConnect: () => void
  onDisconnect: () => void
  onRefresh: () => void
}

function CommandStrip({
  connectionDraft,
  backendMode,
  connectionSummary,
  connectionMeta,
  communicationStateLabel,
  communicationTone,
  staleStateLabel,
  staleStateTone,
  lastUpdatedLabel,
  banner,
  isConnecting,
  isDisconnecting,
  onConnectionChange,
  onConnect,
  onDisconnect,
  onRefresh,
}: CommandStripProps) {
  const updateConnectionField =
    (field: keyof ConnectionDraft) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onConnectionChange({
        ...connectionDraft,
        [field]: event.target.value,
      })
    }

  const updateConnectionValue =
    (field: keyof ConnectionDraft) =>
    (value: string) => {
      onConnectionChange({
        ...connectionDraft,
        [field]: value,
      })
    }

  return (
    <section className="command-strip">
      <div className="command-strip__surface command-strip__surface--identity">
        <div>
          <p className="section-kicker">ICE2 Nexus / Command Strip</p>
          <h1 className="command-strip__title">PDI command fabric</h1>
        </div>
        <div className="command-strip__status-row">
          <StatusBadge label={communicationStateLabel} tone={communicationTone} />
          <StatusBadge label={backendMode} tone={backendMode === 'real' ? 'normal' : 'warning'} />
          <StatusBadge label={staleStateLabel} tone={staleStateTone} />
        </div>
        <p className="command-strip__summary">{connectionSummary}</p>
        <p className="command-strip__meta">
          {connectionMeta}
          {lastUpdatedLabel ? ` | Last sync ${lastUpdatedLabel}` : ''}
        </p>
      </div>

      <div className="command-strip__surface command-strip__surface--connection">
        <div className="command-strip__surface-head">
          <div>
            <p className="section-kicker">Target session</p>
            <h2 className="section-title">Device lane</h2>
          </div>
          <button
            type="button"
            className="action-button action-button--ghost action-button--compact"
            onClick={onRefresh}
            disabled={isConnecting || isDisconnecting}
          >
            Refresh
          </button>
        </div>

        <div className="command-strip__fields command-strip__fields--connection">
          <label className="command-field command-field--mode">
            <span className="command-field__label">Mode</span>
            <StableSelect
              value={connectionDraft.mode}
              onChange={updateConnectionValue('mode')}
              options={[
                { value: 'real', label: 'Real ICE2' },
                { value: 'simulator', label: 'Simulator' },
              ]}
            />
          </label>

          <label className="command-field command-field--host">
            <span className="command-field__label">Host / IP</span>
            <input
              type="text"
              value={connectionDraft.host}
              onChange={updateConnectionField('host')}
              spellCheck={false}
              placeholder="192.168.1.108"
            />
          </label>

          <label className="command-field">
            <span className="command-field__label">Port</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={connectionDraft.port}
              onChange={updateConnectionField('port')}
            />
          </label>

          <label className="command-field">
            <span className="command-field__label">Slave</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={connectionDraft.slaveId}
              onChange={updateConnectionField('slaveId')}
            />
          </label>

          <label className="command-field">
            <span className="command-field__label">Timeout</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              step="0.1"
              value={connectionDraft.timeout}
              onChange={updateConnectionField('timeout')}
            />
          </label>

          <label className="command-field">
            <span className="command-field__label">Retries</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={connectionDraft.retries}
              onChange={updateConnectionField('retries')}
            />
          </label>

          <div className="command-strip__actions">
            <button
              type="button"
              className="action-button action-button--primary"
              onClick={onConnect}
              disabled={isConnecting || isDisconnecting}
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
            <button
              type="button"
              className="action-button action-button--ghost"
              onClick={onDisconnect}
              disabled={isConnecting || isDisconnecting}
            >
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </div>
      </div>

      <div className={`system-banner system-banner--${banner.tone}`}>
        <div className="system-banner__copy">
          <p className="system-banner__title">{banner.title}</p>
          <p className="system-banner__body">{banner.body}</p>
        </div>
      </div>
    </section>
  )
}

export default CommandStrip
