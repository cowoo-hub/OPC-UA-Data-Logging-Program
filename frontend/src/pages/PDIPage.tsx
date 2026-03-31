import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  DEFAULT_SIMULATOR_CONNECT_REQUEST,
  connectTarget,
  fetchConnectionStatus,
  fetchDecodedPreview,
  fetchHealth,
  fetchPortPdi,
} from '../api/client'
import type {
  ConnectionDraft,
  ConnectionStatusResponse,
  DecodeSettings,
  DecodeType,
  DecodedPreview,
  HealthResponse,
  PortDecodeCollection,
  PortSeverity,
  PortSnapshot,
  PdiResponse,
} from '../api/types'
import ConnectionPanel from '../components/ConnectionPanel'
import DecodeControls from '../components/DecodeControls'
import KpiBar from '../components/KpiBar'
import PortCard from '../components/PortCard'
import StatusBadge from '../components/StatusBadge'

const PORT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8]
const QUICK_DECODE_TYPES: DecodeType[] = ['float32', 'uint32', 'int32', 'binary']

const DEFAULT_DECODE_SETTINGS: DecodeSettings = {
  dataType: 'float32',
  wordOrder: 'big',
  byteOrder: 'big',
}

interface BannerState {
  tone: 'error' | 'info' | 'success'
  title: string
  body: string
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected frontend error'
}

function groupBinaryValue(binaryValue: string) {
  return binaryValue.match(/.{1,8}/g)?.join(' ') ?? binaryValue
}

function formatDecodedValue(
  value: number | string,
  dataType: DecodeType,
): string {
  if (typeof value === 'string') {
    return dataType === 'binary' ? groupBinaryValue(value) : value
  }

  if (Number.isInteger(value)) {
    return value.toLocaleString()
  }

  return value.toFixed(3).replace(/\.?0+$/, '')
}

function getPortSeverity(pdi: PdiResponse): PortSeverity {
  if (pdi.header.port_status.fault) {
    return 'critical'
  }

  if (!pdi.header.port_status.pdi_valid || pdi.header.event_code.active) {
    return 'warning'
  }

  return 'normal'
}

function createEmptySnapshot(portNumber: number): PortSnapshot {
  return {
    portNumber,
    severity: 'normal',
    pdi: null,
    decodes: null,
    error: null,
  }
}

function buildConnectionDraft(
  connection: ConnectionStatusResponse | null,
): ConnectionDraft {
  return {
    host:
      connection?.connection?.host ?? DEFAULT_SIMULATOR_CONNECT_REQUEST.host,
    port: String(
      connection?.connection?.port ?? DEFAULT_SIMULATOR_CONNECT_REQUEST.port,
    ),
    slaveId: String(
      connection?.connection?.slave_id ?? DEFAULT_SIMULATOR_CONNECT_REQUEST.slave_id,
    ),
  }
}

function createFailedPreview(error: unknown): DecodedPreview {
  return {
    displayValue: 'Unavailable',
    rawValue: null,
    sourceRegisters: [],
    error: getErrorMessage(error),
  }
}

async function loadPortDecodes(
  registers: number[],
  decodeSettings: DecodeSettings,
): Promise<PortDecodeCollection> {
  const decodeTypes = Array.from(
    new Set<DecodeType>([decodeSettings.dataType, ...QUICK_DECODE_TYPES]),
  )

  const decodeEntries = await Promise.all(
    decodeTypes.map(async (decodeType) => {
      try {
        const preview = await fetchDecodedPreview(registers, decodeSettings, decodeType)

        return [
          decodeType,
          {
            displayValue: formatDecodedValue(preview.value, decodeType),
            rawValue: preview.value,
            sourceRegisters: preview.registers,
            error: null,
          } satisfies DecodedPreview,
        ] as const
      } catch (error) {
        return [decodeType, createFailedPreview(error)] as const
      }
    }),
  )

  const decodeMap = new Map<DecodeType, DecodedPreview>(decodeEntries)

  return {
    featured:
      decodeMap.get(decodeSettings.dataType) ??
      createFailedPreview('Decode unavailable'),
    float32: decodeMap.get('float32') ?? createFailedPreview('Decode unavailable'),
    uint32: decodeMap.get('uint32') ?? createFailedPreview('Decode unavailable'),
    int32: decodeMap.get('int32') ?? createFailedPreview('Decode unavailable'),
    binary: decodeMap.get('binary') ?? createFailedPreview('Decode unavailable'),
  }
}

async function loadPortSnapshot(
  portNumber: number,
  decodeSettings: DecodeSettings,
): Promise<PortSnapshot> {
  const pdi = await fetchPortPdi(portNumber)
  const decodes = await loadPortDecodes(pdi.payload.registers, decodeSettings)

  return {
    portNumber,
    severity: getPortSeverity(pdi),
    pdi,
    decodes,
    error: null,
  }
}

function buildFailedSnapshot(portNumber: number, error: unknown): PortSnapshot {
  return {
    portNumber,
    severity: 'critical',
    pdi: null,
    decodes: null,
    error: getErrorMessage(error),
  }
}

function serializeValue(value: unknown) {
  return JSON.stringify(value)
}

function preserveReferenceIfEqual<T>(previousValue: T, nextValue: T): T {
  return serializeValue(previousValue) === serializeValue(nextValue)
    ? previousValue
    : nextValue
}

function mergePortSnapshots(
  previousSnapshots: PortSnapshot[],
  nextSnapshots: PortSnapshot[],
): PortSnapshot[] {
  const previousByPort = new Map(
    previousSnapshots.map((snapshot) => [snapshot.portNumber, snapshot]),
  )

  return nextSnapshots.map((nextSnapshot) => {
    const previousSnapshot = previousByPort.get(nextSnapshot.portNumber)

    if (!previousSnapshot) {
      return nextSnapshot
    }

    if (nextSnapshot.pdi === null && nextSnapshot.error && previousSnapshot.pdi) {
      return previousSnapshot
    }

    return serializeValue(previousSnapshot) === serializeValue(nextSnapshot)
      ? previousSnapshot
      : nextSnapshot
  })
}

function PDIPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [connection, setConnection] = useState<ConnectionStatusResponse | null>(null)
  const [ports, setPorts] = useState<PortSnapshot[]>(
    PORT_NUMBERS.map((portNumber) => createEmptySnapshot(portNumber)),
  )
  const [decodeSettings, setDecodeSettings] = useState<DecodeSettings>(
    DEFAULT_DECODE_SETTINGS,
  )
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>(
    buildConnectionDraft(null),
  )
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [monitorPaused, setMonitorPaused] = useState(false)
  const [banner, setBanner] = useState<BannerState | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const decodeSettingsRef = useRef(decodeSettings)
  const monitorPausedRef = useRef(monitorPaused)
  const lastUpdatedRef = useRef<string | null>(null)
  const seedDraftRef = useRef(false)
  const isPollingRef = useRef(false)

  useEffect(() => {
    decodeSettingsRef.current = decodeSettings
  }, [decodeSettings])

  useEffect(() => {
    monitorPausedRef.current = monitorPaused
  }, [monitorPaused])

  useEffect(() => {
    lastUpdatedRef.current = lastUpdated
  }, [lastUpdated])

  const refreshDashboard = useCallback(
    async ({
      initial = false,
      allowAutoConnect = false,
    }: {
      initial?: boolean
      allowAutoConnect?: boolean
    } = {}) => {
      if (isPollingRef.current || monitorPausedRef.current || document.hidden) {
        return
      }

      isPollingRef.current = true
      setIsRefreshing(true)

      try {
        const [healthResponse, connectionResponse] = await Promise.all([
          fetchHealth(),
          fetchConnectionStatus(),
        ])

        let resolvedConnection = connectionResponse

        if (allowAutoConnect && !connectionResponse.configured) {
          const connectResponse = await connectTarget(
            DEFAULT_SIMULATOR_CONNECT_REQUEST,
          )

          resolvedConnection = {
            configured: connectResponse.connected,
            connection: connectResponse.connection,
          }
        }

        const portResults = await Promise.allSettled(
          PORT_NUMBERS.map((portNumber) =>
            loadPortSnapshot(portNumber, decodeSettingsRef.current),
          ),
        )

        const nextSnapshots = portResults.map((result, index) =>
          result.status === 'fulfilled'
            ? result.value
            : buildFailedSnapshot(PORT_NUMBERS[index], result.reason),
        )

        const failedCount = nextSnapshots.filter((snapshot) => snapshot.error).length
        const nextBanner =
          failedCount === PORT_NUMBERS.length
            ? {
                tone: 'error' as const,
                title: 'Live stream unavailable',
                body: 'The backend PDI endpoints could not be reached. Check the FastAPI server and try again.',
              }
            : failedCount > 0
              ? {
                  tone: 'info' as const,
                  title: 'Partial refresh issue',
                  body: 'Some ports could not refresh this cycle, so the dashboard is holding the last known values for those cards.',
                }
              : null

        const syncTime =
          failedCount < PORT_NUMBERS.length
            ? new Date().toLocaleTimeString()
            : lastUpdatedRef.current

        startTransition(() => {
          setHealth((previousValue) =>
            preserveReferenceIfEqual(previousValue, healthResponse),
          )
          setConnection((previousValue) =>
            preserveReferenceIfEqual(previousValue, resolvedConnection),
          )
          setPorts((previousValue) =>
            mergePortSnapshots(previousValue, nextSnapshots),
          )
          setBanner(nextBanner)
          setLastUpdated(syncTime)
          setHasLoadedOnce(true)
        })

        if (!seedDraftRef.current && resolvedConnection.connection) {
          seedDraftRef.current = true
          setConnectionDraft(buildConnectionDraft(resolvedConnection))
        }

        if (initial && !connectionResponse.configured && resolvedConnection.configured) {
          setBanner({
            tone: 'success',
            title: 'Simulator session ready',
            body: 'The frontend connected itself to the local simulator target so the PDI dashboard can start streaming immediately.',
          })
        }
      } catch (loadError) {
        setBanner({
          tone: 'error',
          title: 'Dashboard refresh failed',
          body: getErrorMessage(loadError),
        })
      } finally {
        setIsRefreshing(false)
        isPollingRef.current = false
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    void refreshDashboard({ initial: true, allowAutoConnect: true })

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        void refreshDashboard()
      }
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [refreshDashboard])

  useEffect(() => {
    if (!hasLoadedOnce || monitorPaused) {
      return
    }

    void refreshDashboard()
  }, [decodeSettings, hasLoadedOnce, monitorPaused, refreshDashboard])

  const connectionTone = useMemo(() => {
    if (monitorPaused) {
      return 'warning' as const
    }

    if (connection?.configured) {
      return 'normal' as const
    }

    return 'neutral' as const
  }, [connection?.configured, monitorPaused])

  const connectionStateLabel = useMemo(() => {
    if (monitorPaused) {
      return 'Paused'
    }

    if (connection?.configured) {
      return 'Live'
    }

    return 'Awaiting target'
  }, [connection?.configured, monitorPaused])

  const severityCounts = useMemo(() => {
    return ports.reduce(
      (accumulator, snapshot) => {
        if (snapshot.pdi) {
          accumulator[snapshot.severity] += 1
        }

        return accumulator
      },
      {
        normal: 0,
        warning: 0,
        critical: 0,
      },
    )
  }, [ports])

  const connectionSummary = useMemo(() => {
    if (!connection?.connection) {
      return 'Awaiting simulator or hardware target'
    }

    return `${connection.connection.host}:${connection.connection.port} | slave ${connection.connection.slave_id}`
  }, [connection])

  const headerModeLabel = health?.backend_mode ?? 'loading'

  async function handleConnect() {
    const host = connectionDraft.host.trim()
    const port = Number(connectionDraft.port)
    const slaveId = Number(connectionDraft.slaveId)

    if (
      !host ||
      !Number.isInteger(port) ||
      port <= 0 ||
      !Number.isInteger(slaveId) ||
      slaveId < 0
    ) {
      setBanner({
        tone: 'error',
        title: 'Connection details incomplete',
        body: 'Enter a host plus valid numeric values for port and slave ID before connecting.',
      })
      return
    }

    setIsConnecting(true)

    try {
      const response = await connectTarget({
        host,
        port,
        slave_id: slaveId,
        timeout: connection?.connection?.timeout ?? DEFAULT_SIMULATOR_CONNECT_REQUEST.timeout,
        retries: connection?.connection?.retries ?? DEFAULT_SIMULATOR_CONNECT_REQUEST.retries,
      })

      setMonitorPaused(false)
      setConnection({
        configured: response.connected,
        connection: response.connection,
      })
      seedDraftRef.current = true
      setConnectionDraft(
        buildConnectionDraft({
          configured: response.connected,
          connection: response.connection,
        }),
      )

      await refreshDashboard()

      setBanner({
        tone: 'success',
        title: 'Connection updated',
        body: `Connected to ${response.connection.host}:${response.connection.port} with slave ${response.connection.slave_id}.`,
      })
    } catch (error) {
      setBanner({
        tone: 'error',
        title: 'Connection failed',
        body: getErrorMessage(error),
      })
    } finally {
      setIsConnecting(false)
    }
  }

  function handleDisconnect() {
    setMonitorPaused(true)
    setBanner({
      tone: 'info',
      title: 'Live monitor paused',
      body: 'Polling is paused locally. The current backend contract does not include a disconnect endpoint yet, so the backend target remains configured until a new connect call is made.',
    })
  }

  return (
    <div className="page-shell">
      <header className="ops-header">
        <div className="ops-header__copy">
          <p className="section-kicker">Phase 2 frontend</p>
          <h2 className="page-title">Future industrial PDI monitor</h2>
          <p className="page-description">
            A stable simulator-first operations surface for ICE2 process data,
            designed to feel like a premium industrial monitoring product today
            and grow cleanly into ISDU, MQTT, AI diagnostics, and hardware mode
            later.
          </p>
        </div>

        <div className="hero-status-card">
          <div className="hero-status-card__row">
            <span className="hero-status-card__label">Backend mode</span>
            <StatusBadge
              label={headerModeLabel}
              tone={headerModeLabel === 'simulator' ? 'normal' : 'warning'}
            />
          </div>
          <div className="hero-status-card__row">
            <span className="hero-status-card__label">Connection</span>
            <StatusBadge label={connectionStateLabel} tone={connectionTone} />
          </div>
          <div className="hero-status-card__row hero-status-card__row--stacked">
            <span className="hero-status-card__label">Current target</span>
            <strong className="hero-status-card__value">{connectionSummary}</strong>
          </div>
          <div className="hero-status-card__footer">
            <div className="live-indicator">
              <span
                className={`live-indicator__dot ${isRefreshing ? 'live-indicator__dot--active' : ''}`}
                aria-hidden="true"
              />
              <span>1 second polling cadence</span>
            </div>
            <span className="hero-status-card__timestamp">
              {lastUpdated ? `Last sync ${lastUpdated}` : 'Awaiting first sample'}
            </span>
          </div>
        </div>
      </header>

      <KpiBar
        totalPorts={PORT_NUMBERS.length}
        normalPorts={severityCounts.normal}
        warningPorts={severityCounts.warning}
        criticalPorts={severityCounts.critical}
        backendMode={headerModeLabel}
        connectionState={connectionStateLabel}
        connectionTone={connectionTone}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      <section className="controls-row">
        <ConnectionPanel
          value={connectionDraft}
          backendConnection={connection?.connection ?? null}
          configured={connection?.configured ?? false}
          monitorPaused={monitorPaused}
          isConnecting={isConnecting}
          onChange={setConnectionDraft}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />

        <DecodeControls
          value={decodeSettings}
          onChange={setDecodeSettings}
          disabled={!hasLoadedOnce && isRefreshing}
        />
      </section>

      {banner ? (
        <div className={`state-banner state-banner--${banner.tone}`}>
          <div>
            <p className="state-banner__title">{banner.title}</p>
            <p className="state-banner__body">{banner.body}</p>
          </div>
          <button
            type="button"
            className="action-button action-button--ghost"
            onClick={() => void refreshDashboard()}
          >
            Refresh now
          </button>
        </div>
      ) : null}

      {!hasLoadedOnce ? (
        <section className="ports-grid" aria-label="Loading PDI cards">
          {PORT_NUMBERS.map((portNumber) => (
            <div key={portNumber} className="port-card port-card--loading">
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--text" />
              <div className="skeleton skeleton--metrics" />
              <div className="skeleton skeleton--panel" />
              <div className="skeleton skeleton--panel" />
            </div>
          ))}
        </section>
      ) : (
        <section className="ports-grid">
          {ports.map((snapshot) => (
            <PortCard
              key={snapshot.portNumber}
              snapshot={snapshot}
              selectedDecodeType={decodeSettings.dataType}
            />
          ))}
        </section>
      )}
    </div>
  )
}

export default PDIPage
