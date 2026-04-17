import { memo, useEffect, useMemo, useState } from 'react'

import { fetchOpcUaNodes } from '../api/client'
import type { OpcUaNodePreview } from '../api/types'
import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import StatusBadge from './StatusBadge'

function getOpcUaPresentation(enabled: boolean, running: boolean, configured: boolean, hasError: boolean) {
  if (!enabled) {
    return { label: 'Disabled', tone: 'neutral' as const }
  }
  if (running) {
    return { label: 'Running', tone: 'normal' as const }
  }
  if (hasError) {
    return { label: 'Error', tone: 'critical' as const }
  }
  return { label: configured ? 'Starting' : 'Unconfigured', tone: configured ? ('warning' as const) : ('neutral' as const) }
}

function formatOpcUaNodeValue(value: OpcUaNodePreview['value']) {
  if (value === null || value === '') {
    return '--'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]'
    }

    const visibleValues = value.slice(0, 8).join(', ')
    return value.length > 8 ? `[${visibleValues}, ...]` : `[${visibleValues}]`
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }

  return String(value)
}

function OpcUaPanel() {
  const workspace = useMonitoringWorkspaceContext()
  const draft = workspace.opcUaDraft
  const status = workspace.opcUaStatus
  const portCheck = workspace.opcUaPortCheck
  const [nodePreview, setNodePreview] = useState<OpcUaNodePreview[]>([])
  const [nodeCount, setNodeCount] = useState(0)
  const [nodePreviewError, setNodePreviewError] = useState<string | null>(null)

  const presentation = useMemo(
    () =>
      getOpcUaPresentation(
        draft.enabled,
        Boolean(status?.running),
        Boolean(status?.configured),
        Boolean(status?.last_error),
      ),
    [draft.enabled, status?.configured, status?.last_error, status?.running],
  )
  const portCheckTone = useMemo(() => {
    if (!portCheck) {
      return 'pending'
    }
    if (!portCheck.host_valid || !portCheck.available) {
      return 'error'
    }
    if (portCheck.in_use_by_masterway) {
      return 'warning'
    }
    return 'success'
  }, [portCheck])
  const isPortBlocked = Boolean(portCheck && (!portCheck.host_valid || !portCheck.available))
  const visibleNodes = useMemo(() => nodePreview.slice(0, 120), [nodePreview])

  useEffect(() => {
    let isMounted = true

    async function refreshNodes() {
      try {
        const response = await fetchOpcUaNodes()
        if (!isMounted) {
          return
        }
        setNodePreview(response.nodes)
        setNodeCount(response.count)
        setNodePreviewError(null)
      } catch (error) {
        if (!isMounted) {
          return
        }
        setNodePreview([])
        setNodeCount(0)
        setNodePreviewError(error instanceof Error ? error.message : 'Node preview unavailable')
      }
    }

    void refreshNodes()

    if (!draft.enabled && !status?.running) {
      return () => {
        isMounted = false
      }
    }

    const intervalId = window.setInterval(() => {
      void refreshNodes()
    }, 1000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [draft.enabled, status?.running])

  useEffect(() => {
    if (!draft.enabled) {
      void workspace.checkOpcUaPort(draft)
      return
    }

    const timeoutId = window.setTimeout(() => {
      void workspace.checkOpcUaPort(draft)
    }, 350)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    draft.enabled,
    draft.endpointUrl,
    draft.host,
    draft.port,
    workspace.checkOpcUaPort,
  ])

  function updateEndpoint(endpointUrl: string) {
    const match = endpointUrl
      .trim()
      .match(/^opc\.tcp:\/\/([^:/\s]+):(\d{1,5})(?:\/(.+))?$/)

    workspace.setOpcUaDraft({
      ...draft,
      endpointUrl,
      ...(match
        ? {
            host: match[1],
            port: match[2],
            path: (match[3] ?? 'masterway').replace(/^\/+/, '') || 'masterway',
          }
        : {}),
    })
  }

  function applyServerState(enabled: boolean) {
    const nextDraft = {
      ...draft,
      enabled,
    }
    workspace.setOpcUaDraft(nextDraft)
    void workspace.handleSaveOpcUa(nextDraft)
  }

  return (
    <section className="opcua-panel" aria-label="OPC UA server settings">
      <div className="opcua-panel__header">
        <div>
          <span className="section-kicker">OPC UA Server</span>
        </div>
        <div className="opcua-panel__header-actions">
          <StatusBadge label={presentation.label} tone={presentation.tone} />
          <button
            type="button"
            className="action-button action-button--primary action-button--compact"
            onClick={() => applyServerState(true)}
            disabled={workspace.isSavingOpcUa || Boolean(status?.running)}
          >
            Connect
          </button>
          <button
            type="button"
            className="action-button action-button--ghost action-button--compact"
            onClick={() => applyServerState(false)}
            disabled={workspace.isSavingOpcUa || (!draft.enabled && !status?.running)}
          >
            Disconnect
          </button>
        </div>
      </div>

      <label className="opcua-panel__endpoint control-field">
        <span className="control-field__label">Endpoint URL</span>
        <input
          type="text"
          value={draft.endpointUrl}
          placeholder="opc.tcp://127.0.0.1:4840/masterway"
          spellCheck={false}
          onChange={(event) => updateEndpoint(event.target.value)}
        />
      </label>

      {workspace.isCheckingOpcUaPort || portCheck ? (
        <div className={`opcua-panel__port-check opcua-panel__port-check--${portCheckTone}`}>
          <span>
            {workspace.isCheckingOpcUaPort
              ? 'Checking port availability...'
              : portCheck?.message}
          </span>
          {portCheck ? (
            <span className="opcua-panel__port-check-meta">
              Bind {portCheck.bind_host} · Advertise {portCheck.endpoint_host}:{portCheck.port}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="opcua-panel__grid">
        <label className="control-field">
          <span className="control-field__label">Host</span>
          <input
            type="text"
            value={draft.host}
            placeholder="0.0.0.0"
            onChange={(event) =>
              workspace.setOpcUaDraft({
                ...draft,
                host: event.target.value,
                endpointUrl: `opc.tcp://${event.target.value || '0.0.0.0'}:${draft.port || '4840'}/${draft.path || 'masterway'}`,
              })
            }
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={draft.port}
            onChange={(event) =>
              workspace.setOpcUaDraft({
                ...draft,
                port: event.target.value,
                endpointUrl: `opc.tcp://${draft.host || '0.0.0.0'}:${event.target.value || '4840'}/${draft.path || 'masterway'}`,
              })
            }
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Path</span>
          <input
            type="text"
            value={draft.path}
            onChange={(event) =>
              workspace.setOpcUaDraft({
                ...draft,
                path: event.target.value,
                endpointUrl: `opc.tcp://${draft.host || '0.0.0.0'}:${draft.port || '4840'}/${event.target.value || 'masterway'}`,
              })
            }
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Namespace URI</span>
          <input
            type="text"
            value={draft.namespaceUri}
            onChange={(event) =>
              workspace.setOpcUaDraft({
                ...draft,
                namespaceUri: event.target.value,
              })
            }
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Server Name</span>
          <input
            type="text"
            value={draft.serverName}
            onChange={(event) =>
              workspace.setOpcUaDraft({
                ...draft,
                serverName: event.target.value,
              })
            }
          />
        </label>
      </div>

      <div className="opcua-panel__toggles">
        <label className="integration-toggle">
          <input
            type="checkbox"
            checked={draft.anonymous}
            onChange={(event) =>
              workspace.setOpcUaDraft({
                ...draft,
                anonymous: event.target.checked,
              })
            }
          />
          <span>Anonymous access</span>
        </label>

        <label className="integration-toggle">
          <input type="checkbox" checked={false} disabled readOnly />
          <span>Read-only nodes</span>
        </label>

        <label className="integration-toggle">
          <input type="checkbox" checked={false} disabled readOnly />
          <span>Security: None</span>
        </label>
      </div>

      <div className="opcua-panel__nodes">
        <div className="opcua-panel__nodes-head">
          <span className="control-field__label">Live nodes preview</span>
          <span>{nodePreviewError ?? `${nodeCount} nodes exposed`}</span>
        </div>
        <div className="opcua-panel__node-table" role="table" aria-label="OPC UA live node values">
          <div className="opcua-panel__node-row opcua-panel__node-row--head" role="row">
            <span>Browse path</span>
            <span>Type</span>
            <span>Live value</span>
          </div>
          {visibleNodes.length > 0 ? (
            visibleNodes.map((node) => (
              <div className="opcua-panel__node-row" role="row" key={node.key}>
                <code title={node.browse_path}>{node.browse_path}</code>
                <span>{node.data_type}</span>
                <strong title={formatOpcUaNodeValue(node.value)}>
                  {formatOpcUaNodeValue(node.value)}
                </strong>
              </div>
            ))
          ) : (
            <div className="opcua-panel__node-empty">
              {nodePreviewError ??
                'No live OPC UA nodes yet. Connect the OPC UA server and wait for the first PDI update.'}
            </div>
          )}
        </div>
      </div>

      <div className="opcua-panel__footer">
        <div className="opcua-panel__meta">
          <span>Namespace: {status?.namespace_index ?? '--'}</span>
          <span>Last update: {status?.last_update_at ?? '--'}</span>
          <span>Error: {status?.last_error ?? 'none'}</span>
        </div>
        <button
          type="button"
          className="action-button action-button--primary action-button--compact"
          onClick={() => void workspace.handleSaveOpcUa()}
          disabled={workspace.isSavingOpcUa || isPortBlocked}
        >
          {workspace.isSavingOpcUa ? 'Applying...' : 'Save OPC UA'}
        </button>
      </div>
    </section>
  )
}

export default memo(OpcUaPanel)
