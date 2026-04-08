import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  DEFAULT_REAL_CONNECT_REQUEST,
  HISTORY_REFRESH_INTERVAL_MS,
  HISTORY_CHART_MAX_POINTS,
  UI_REFRESH_INTERVAL_MS,
  connectTarget,
  convertRegisters,
  disconnectTarget,
  fetchAllPortsHistory,
  fetchAllPortsPdi,
  fetchConnectionStatus,
  fetchIoddLibrary,
} from '../api/client'
import type {
  AllPortsHistoryResponse,
  AllPortsPdiResponse,
  CommunicationState,
  ConnectionDraft,
  ConnectionInfo,
  ConnectionStatusResponse,
  DecodedPreview,
  IoddDeviceProfile,
  ParsedProcessDataProfile,
  PortDiagnostic,
  PortDecodeCollection,
  PortDisplayConfig,
  PortDisplayOverride,
  PortDisplayOverrides,
  PortHistorySeries,
  PortSeverity,
  PortSnapshot,
  PdiResponse,
} from '../api/types'
import {
  applyResolutionToPreview,
  buildDecodePreviewCacheKey,
  buildPortDecodeCollection,
  buildPreviewFromConvertedValue,
  buildUnavailablePreview,
  decodeRegistersPreview,
  getOverviewDecodeTypes,
  prepareRegistersForDecodeRequest,
} from '../utils/decode'
import {
  buildPortTrendSeries,
  formatLocalTimeDisplay,
  type PortTrendSeries,
} from '../utils/history'
import {
  parseProcessDataPayload,
  resolveProcessDataProfile,
  setRuntimeProcessDataProfiles,
} from '../utils/processDataMaps'
import {
  loadPortDisplayOverrides,
  resolvePortDisplayConfig,
  savePortDisplayOverrides,
} from '../utils/portDisplay'
import {
  buildPortDiagnostic,
  countDiagnosticLevels,
} from '../utils/diagnostics'

export const PORT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8]
export const DEFAULT_HISTORY_WINDOW_MS = 30000

export type StatusTone = 'normal' | 'warning' | 'critical' | 'neutral'

export interface BannerState {
  tone: 'error' | 'info' | 'success' | 'warning'
  title: string
  body: string
}

export interface CommunicationPresentation {
  state: CommunicationState
  label: string
  tone: StatusTone
}

interface RefreshDashboardOptions {
  initial?: boolean
  allowAutoConnect?: boolean
  force?: boolean
  includeHistory?: boolean
}

export interface MonitoringWorkspace {
  dashboard: AllPortsPdiResponse | null
  historySnapshot: AllPortsHistoryResponse | null
  ports: PortSnapshot[]
  historyByPort: Record<number, PortHistorySeries>
  trendSeriesByPort: Record<number, PortTrendSeries>
  featuredDecodesByPort: Record<number, DecodedPreview>
  ioddProfiles: IoddDeviceProfile[]
  ioddProfilesById: Record<string, IoddDeviceProfile>
  processDataByPort: Record<number, ParsedProcessDataProfile | null>
  diagnosticsByPort: Record<number, PortDiagnostic>
  selectedPortDecodes: PortDecodeCollection | null
  historyWindowMs: number
  portDisplayOverrides: PortDisplayOverrides
  resolvedPortDisplayConfigs: Record<number, PortDisplayConfig>
  selectedPortNumber: number
  selectedPortSnapshot: PortSnapshot
  selectedPortHistory: PortHistorySeries | null
  selectedPortTrendSeries: PortTrendSeries
  selectedPortIoddProfile: IoddDeviceProfile | null
  selectedPortProcessData: ParsedProcessDataProfile | null
  selectedPortOverride: PortDisplayOverride | null
  selectedPortDisplayConfig: PortDisplayConfig
  selectedPortDiagnostic: PortDiagnostic
  connectionDraft: ConnectionDraft
  hasLoadedOnce: boolean
  isRefreshing: boolean
  isConnecting: boolean
  isDisconnecting: boolean
  banner: BannerState
  communicationPresentation: CommunicationPresentation
  severityCounts: {
    normal: number
    warning: number
    critical: number
  }
  diagnosticCounts: {
    normal: number
    warning: number
    critical: number
  }
  connectionSummary: string
  connectionMeta: string
  backendModeLabel: ConnectionDraft['mode']
  lastUpdatedLabel: string | null
  staleStateLabel: string
  staleStateTone: StatusTone
  uiRefreshMs: number
  historyRefreshMs: number
  setHistoryWindowMs: (value: number) => void
  setSelectedPortNumber: (value: number) => void
  setConnectionDraft: (value: ConnectionDraft) => void
  refreshDashboard: (options?: {
    initial?: boolean
    allowAutoConnect?: boolean
    force?: boolean
    includeHistory?: boolean
  }) => Promise<void>
  refreshIoddLibrary: () => Promise<void>
  handleConnect: () => Promise<void>
  handleDisconnect: () => Promise<void>
  updatePortDisplayOverride: (portNumber: number, override: PortDisplayOverride) => void
  resetPortDisplay: (portNumber: number) => void
}

function compactMessage(message: string, maxLength = 160) {
  const normalized = message.replace(/\s+/g, ' ').trim()

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1)}...`
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return compactMessage(error)
  }

  if (error instanceof Error) {
    return compactMessage(error.message)
  }

  return 'Unexpected frontend error'
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
    error: null,
  }
}

function createEmptyHistorySeries(portNumber: number): PortHistorySeries {
  return {
    port: portNumber,
    samples: [],
  }
}

function createEmptyTrendSeries(): PortTrendSeries {
  return {
    points: [],
    latestValue: null,
    previousValue: null,
    delta: null,
    minimumValue: null,
    maximumValue: null,
    sampleCount: 0,
    decodeType: null,
    status: 'unavailable',
    oldestTimestampMs: null,
    latestTimestampMs: null,
  }
}

function createEmptyDecodePreview(message = 'Awaiting decode'): DecodedPreview {
  return buildUnavailablePreview(message)
}

function createInitialDecodedPreviewMap() {
  return PORT_NUMBERS.reduce<Record<number, DecodedPreview>>((accumulator, portNumber) => {
    accumulator[portNumber] = createEmptyDecodePreview()
    return accumulator
  }, {})
}

function buildConnectionDraft(connection: ConnectionInfo | null): ConnectionDraft {
  return {
    mode: connection?.mode ?? DEFAULT_REAL_CONNECT_REQUEST.mode,
    host: connection?.host ?? DEFAULT_REAL_CONNECT_REQUEST.host,
    port: String(connection?.port ?? DEFAULT_REAL_CONNECT_REQUEST.port),
    slaveId: String(connection?.slave_id ?? DEFAULT_REAL_CONNECT_REQUEST.slave_id),
    timeout: String(connection?.timeout ?? DEFAULT_REAL_CONNECT_REQUEST.timeout),
    retries: String(connection?.retries ?? DEFAULT_REAL_CONNECT_REQUEST.retries),
  }
}

function buildPortSnapshot(pdi: PdiResponse): PortSnapshot {
  return {
    portNumber: pdi.port,
    severity: getPortSeverity(pdi),
    pdi,
    error: null,
  }
}

function mapBulkSnapshotToPorts(snapshot: AllPortsPdiResponse): PortSnapshot[] {
  const portsByNumber = new Map(
    snapshot.ports.map((portSnapshot) => [portSnapshot.port, portSnapshot]),
  )

  return PORT_NUMBERS.map((portNumber) => {
    const portSnapshot = portsByNumber.get(portNumber)

    if (!portSnapshot) {
      return {
        ...createEmptySnapshot(portNumber),
        error: snapshot.polling.configured
          ? 'Waiting for cached PDI data from the background poller.'
          : 'No backend target configured yet.',
      }
    }

    return buildPortSnapshot(portSnapshot)
  })
}

function mapBulkHistoryToPorts(
  historySnapshot: AllPortsHistoryResponse,
): Record<number, PortHistorySeries> {
  const historyByPort = new Map(
    historySnapshot.ports.map((portHistory) => [portHistory.port, portHistory]),
  )

  return PORT_NUMBERS.reduce<Record<number, PortHistorySeries>>((accumulator, portNumber) => {
    accumulator[portNumber] =
      historyByPort.get(portNumber) ?? createEmptyHistorySeries(portNumber)
    return accumulator
  }, {})
}

function serializeValue(value: unknown) {
  return JSON.stringify(value)
}

function preserveReferenceIfEqual<T>(previousValue: T, nextValue: T): T {
  return serializeValue(previousValue) === serializeValue(nextValue)
    ? previousValue
    : nextValue
}

function preserveBannerIfEqual(
  previousBanner: BannerState,
  nextBanner: BannerState,
): BannerState {
  return previousBanner.tone === nextBanner.tone &&
    previousBanner.title === nextBanner.title &&
    previousBanner.body === nextBanner.body
    ? previousBanner
    : nextBanner
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

    if (nextSnapshot.pdi === null && previousSnapshot.pdi !== null) {
      return previousSnapshot
    }

    return serializeValue(previousSnapshot) === serializeValue(nextSnapshot)
      ? previousSnapshot
      : nextSnapshot
  })
}

function mergePortHistory(
  previousHistory: Record<number, PortHistorySeries>,
  nextHistory: Record<number, PortHistorySeries>,
): Record<number, PortHistorySeries> {
  const mergedHistory: Record<number, PortHistorySeries> = {}

  for (const portNumber of PORT_NUMBERS) {
    const previousSeries = previousHistory[portNumber]
    const nextSeries = nextHistory[portNumber]

    if (!previousSeries) {
      mergedHistory[portNumber] = nextSeries
      continue
    }

    if (previousSeries.port !== nextSeries.port) {
      mergedHistory[portNumber] = nextSeries
      continue
    }

    if (previousSeries.samples.length !== nextSeries.samples.length) {
      const previousSamplesByTimestamp = new Map(
        previousSeries.samples.map((sample) => [sample.timestamp, sample]),
      )
      mergedHistory[portNumber] = {
        ...nextSeries,
        samples: nextSeries.samples.map((sample) => {
          const previousSample = previousSamplesByTimestamp.get(sample.timestamp)
          return previousSample && serializeValue(previousSample) === serializeValue(sample)
            ? previousSample
            : sample
        }),
      }
      continue
    }

    let hasChanged = false
    const mergedSamples = nextSeries.samples.map((sample, sampleIndex) => {
      const previousSample = previousSeries.samples[sampleIndex]

      if (
        previousSample &&
        previousSample.timestamp === sample.timestamp &&
        serializeValue(previousSample) === serializeValue(sample)
      ) {
        return previousSample
      }

      hasChanged = true
      return sample
    })

    mergedHistory[portNumber] = hasChanged
      ? {
          ...nextSeries,
          samples: mergedSamples,
        }
      : previousSeries
  }

  return mergedHistory
}

function formatPollingTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return null
  }

  const parsedDate = new Date(timestamp)

  if (Number.isNaN(parsedDate.valueOf())) {
    return timestamp
  }

  return formatLocalTimeDisplay(parsedDate)
}

function formatDurationMs(durationMs: number | null) {
  if (durationMs === null) {
    return null
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1)} s`
}

function getCommunicationPresentation(
  snapshot: AllPortsPdiResponse | null,
): CommunicationPresentation {
  if (!snapshot) {
    return {
      state: 'disconnected',
      label: 'Syncing',
      tone: 'neutral',
    }
  }

  const { communication_state: state, has_snapshot: hasSnapshot } = snapshot.polling

  switch (state) {
    case 'healthy':
      return {
        state,
        label: hasSnapshot ? 'Connected / healthy' : 'Connected / warming',
        tone: 'normal',
      }
    case 'stale':
      return {
        state,
        label: 'Connected / stale',
        tone: 'warning',
      }
    case 'polling_error':
      return {
        state,
        label: 'Polling error',
        tone: 'critical',
      }
    case 'disconnected':
    default:
      return {
        state: 'disconnected',
        label: 'Disconnected',
        tone: 'neutral',
      }
  }
}

function buildBannerFromSnapshot(snapshot: AllPortsPdiResponse | null): BannerState {
  if (!snapshot) {
    return {
      tone: 'info',
      title: 'Initializing live dashboard',
      body: 'Waiting for the backend cache worker to report its first monitoring snapshot.',
    }
  }

  const { polling, connection, ports } = snapshot
  const lastUpdated = formatPollingTimestamp(
    polling.last_successful_poll_at ?? polling.updated_at,
  )
  const retryIn = formatDurationMs(polling.next_retry_in_ms)
  const targetSummary = connection
    ? `${connection.mode} ${connection.host}:${connection.port} slave ${connection.slave_id}`
    : 'no configured target'
  const pollingError = polling.last_error
    ? compactMessage(polling.last_error)
    : null

  switch (polling.communication_state) {
    case 'healthy':
      if (!polling.has_snapshot) {
        return {
          tone: 'info',
          title: 'Connection established, waiting for first sample',
          body: `The backend is connected to ${targetSummary} and the cache worker is warming up.`,
        }
      }

      return {
        tone: 'success',
        title: 'Live cached monitoring healthy',
        body: `Connected to ${targetSummary}. Last successful poll ${lastUpdated ?? 'just now'} at ${polling.interval_ms} ms cadence.`,
      }

    case 'stale':
      return {
        tone: 'warning',
        title: 'Showing last known good snapshot',
        body:
          `${pollingError ?? 'The backend cache is past its freshness target.'} ` +
          `${retryIn ? `Reconnect retry in ${retryIn}. ` : ''}` +
          `${lastUpdated ? `Last good poll ${lastUpdated}.` : 'Waiting for a successful poll.'}`,
      }

    case 'polling_error':
      return {
        tone: 'error',
        title: ports.length > 0 ? 'Communication error, retrying' : 'Initial polling failed',
        body:
          `${pollingError ?? 'The backend could not complete the current polling cycle.'} ` +
          `${retryIn ? `Next retry in ${retryIn}. ` : ''}` +
          `${polling.has_snapshot ? 'The dashboard is still holding the previous good snapshot.' : 'No valid snapshot is available yet.'}`,
      }

    case 'disconnected':
    default:
      return {
        tone: 'info',
        title: 'Backend target disconnected',
        body: 'No ICE2 target is configured right now. Connect a real device or switch to simulator mode to resume cached monitoring.',
      }
  }
}

function buildConnectionMeta(snapshot: AllPortsPdiResponse | null): string {
  if (!snapshot) {
    return 'Waiting for backend cache telemetry'
  }

  const { polling } = snapshot
  const retryIn = formatDurationMs(polling.next_retry_in_ms)
  const lastUpdated = formatPollingTimestamp(
    polling.last_successful_poll_at ?? polling.updated_at,
  )

  switch (polling.communication_state) {
    case 'healthy':
      return lastUpdated
        ? `Last good poll ${lastUpdated}`
        : 'Connected and waiting for first sample'
    case 'stale':
      return retryIn
        ? `Stale cache, reconnect in ${retryIn}`
        : 'Stale cache, reconnect pending'
    case 'polling_error':
      return retryIn
        ? `Retry in ${retryIn} after ${polling.reconnect_attempts} attempt(s)`
        : 'Polling failure, reconnect pending'
    case 'disconnected':
    default:
      return 'No backend target configured'
  }
}

function hydrateSnapshotWithConnectionStatus(
  snapshot: AllPortsPdiResponse,
  connectionStatus: ConnectionStatusResponse | null,
): AllPortsPdiResponse {
  if (!connectionStatus?.configured || !connectionStatus.connection) {
    return snapshot
  }

  if (snapshot.connection && snapshot.polling.configured) {
    return snapshot
  }

  return {
    ...snapshot,
    backend_mode: connectionStatus.connection.mode,
    connection: connectionStatus.connection,
    polling: connectionStatus.polling
      ? connectionStatus.polling
      : {
          ...snapshot.polling,
          backend_mode: connectionStatus.connection.mode,
          configured: true,
        },
  }
}

function normalizePortDisplayOverride(override: PortDisplayOverride): PortDisplayOverride | null {
  const normalized: PortDisplayOverride = {}

  if (override.label?.trim()) {
    normalized.label = override.label.trim()
  }

  if (override.profileId && override.profileId !== 'generic') {
    normalized.profileId = override.profileId
  }

  if ('engineeringUnit' in override) {
    normalized.engineeringUnit = override.engineeringUnit ?? null
  }

  if (override.preferredDecodeType) {
    normalized.preferredDecodeType = override.preferredDecodeType
  }

  if (override.wordOrder) {
    normalized.wordOrder = override.wordOrder
  }

  if (override.byteOrder) {
    normalized.byteOrder = override.byteOrder
  }

  if (override.resolutionFactor && override.resolutionFactor !== 1) {
    normalized.resolutionFactor = override.resolutionFactor
  }

  if (override.sourceWordCount !== undefined) {
    normalized.sourceWordCount = override.sourceWordCount
  }

  if (override.fieldMode !== undefined) {
    normalized.fieldMode = override.fieldMode
  }

  if (override.bitOffset !== undefined) {
    normalized.bitOffset = override.bitOffset
  }

  if (override.bitLength !== undefined) {
    normalized.bitLength = override.bitLength
  }

  if (override.signed !== undefined) {
    normalized.signed = override.signed
  }

  if (override.processDataMode !== undefined) {
    normalized.processDataMode = override.processDataMode
  }

  if ('processDataProfileId' in override) {
    normalized.processDataProfileId = override.processDataProfileId ?? null
  }

  if ('sentinelMappings' in override) {
    normalized.sentinelMappings = override.sentinelMappings ?? []
  }

  if ('statusBits' in override) {
    normalized.statusBits = override.statusBits ?? []
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

function isSamePreview(previousPreview: DecodedPreview, nextPreview: DecodedPreview) {
  return (
    previousPreview.displayValue === nextPreview.displayValue &&
    previousPreview.rawValue === nextPreview.rawValue &&
    previousPreview.scaledValue === nextPreview.scaledValue &&
    previousPreview.mappingComparisonValue === nextPreview.mappingComparisonValue &&
    previousPreview.rawDisplayValue === nextPreview.rawDisplayValue &&
    previousPreview.error === nextPreview.error &&
    previousPreview.sentinelLabel === nextPreview.sentinelLabel &&
    serializeValue(previousPreview.sourceRegisters) ===
      serializeValue(nextPreview.sourceRegisters) &&
    serializeValue(previousPreview.statusBits) === serializeValue(nextPreview.statusBits)
  )
}

export function useMonitoringWorkspace(): MonitoringWorkspace {
  const [dashboard, setDashboard] = useState<AllPortsPdiResponse | null>(null)
  const [historySnapshot, setHistorySnapshot] = useState<AllPortsHistoryResponse | null>(null)
  const [ports, setPorts] = useState<PortSnapshot[]>(
    PORT_NUMBERS.map((portNumber) => createEmptySnapshot(portNumber)),
  )
  const [historyByPort, setHistoryByPort] = useState<Record<number, PortHistorySeries>>(
    () =>
      PORT_NUMBERS.reduce<Record<number, PortHistorySeries>>((accumulator, portNumber) => {
        accumulator[portNumber] = createEmptyHistorySeries(portNumber)
        return accumulator
      }, {}),
  )
  const [featuredDecodesByPort, setFeaturedDecodesByPort] =
    useState<Record<number, DecodedPreview>>(createInitialDecodedPreviewMap)
  const [ioddProfiles, setIoddProfiles] = useState<IoddDeviceProfile[]>([])
  const [selectedPortDecodes, setSelectedPortDecodes] =
    useState<PortDecodeCollection | null>(null)
  const [historyWindowMs, setHistoryWindowMs] = useState(DEFAULT_HISTORY_WINDOW_MS)
  const [portDisplayOverrides, setPortDisplayOverrides] =
    useState<PortDisplayOverrides>(() => loadPortDisplayOverrides())
  const [selectedPortNumber, setSelectedPortNumber] = useState(1)
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>(
    buildConnectionDraft(null),
  )
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [banner, setBanner] = useState<BannerState>(() => buildBannerFromSnapshot(null))
  const connectionActionRef = useRef(false)
  const historyWindowRef = useRef(historyWindowMs)
  const seedDraftRef = useRef(false)
  const isPollingRef = useRef(false)
  const queuedRefreshRef = useRef<RefreshDashboardOptions | null>(null)
  const refreshDashboardRef = useRef<
    (options?: RefreshDashboardOptions) => Promise<void>
  >(async () => {})
  const decodePreviewCacheRef = useRef<Map<string, DecodedPreview>>(new Map())
  const pendingDecodePreviewRef = useRef<Map<string, Promise<DecodedPreview>>>(new Map())
  const featuredDecodeRequestVersionRef = useRef(0)
  const selectedDecodeRequestVersionRef = useRef(0)
  const lastHistoryFetchAtRef = useRef(0)

  useEffect(() => {
    savePortDisplayOverrides(portDisplayOverrides)
  }, [portDisplayOverrides])

  useEffect(() => {
    historyWindowRef.current = historyWindowMs
  }, [historyWindowMs])

  useEffect(() => {
    connectionActionRef.current = isConnecting || isDisconnecting
  }, [isConnecting, isDisconnecting])

  const refreshIoddLibrary = useCallback(async () => {
    try {
      const response = await fetchIoddLibrary()
      const profiles = response.profiles ?? []
      setRuntimeProcessDataProfiles(
        profiles
          .map((profile) => profile.processDataProfile)
          .filter(
            (profile): profile is Exclude<typeof profile, null> => profile !== null,
          ),
      )
      setIoddProfiles((previousProfiles) =>
        preserveReferenceIfEqual(previousProfiles, profiles),
      )
    } catch (error) {
      setBanner((previousBanner) =>
        previousBanner.tone === 'error'
          ? previousBanner
          : {
              tone: 'warning',
              title: 'IODD library unavailable',
              body: getErrorMessage(error),
            },
      )
    }
  }, [])

  const readConnectionStatusSafely = useCallback(async () => {
    try {
      return await fetchConnectionStatus()
    } catch {
      return null
    }
  }, [])

  const resolveConvertedPreview = useCallback(
    async (
      registers: number[],
      displayConfig: PortDisplayConfig,
      dataType = displayConfig.preferredDecodeType,
    ): Promise<DecodedPreview> => {
      try {
        const cacheKey = buildDecodePreviewCacheKey(registers, displayConfig, dataType)
        const cachedPreview = decodePreviewCacheRef.current.get(cacheKey)
        if (cachedPreview) {
          return cachedPreview
        }

        const localPreview = decodeRegistersPreview(registers, displayConfig, dataType)
        if (!localPreview.error) {
          decodePreviewCacheRef.current.set(cacheKey, localPreview)
          return localPreview
        }

        if (displayConfig.fieldMode === 'bit_field') {
          decodePreviewCacheRef.current.set(cacheKey, localPreview)
          return localPreview
        }

        const pendingPreview = pendingDecodePreviewRef.current.get(cacheKey)
        if (pendingPreview) {
          return pendingPreview
        }

        const prepared = prepareRegistersForDecodeRequest(
          registers,
          {
            dataType,
            wordOrder: displayConfig.wordOrder,
            byteOrder: displayConfig.byteOrder,
          },
          dataType,
        )

        const decodePromise = convertRegisters(prepared.request)
          .then((response) =>
            buildPreviewFromConvertedValue(
              dataType,
              prepared.sourceRegisters,
              response.value,
            ),
          )
          .catch(() => localPreview)
          .then((preview) => {
            pendingDecodePreviewRef.current.delete(cacheKey)

            if (decodePreviewCacheRef.current.size > 512) {
              decodePreviewCacheRef.current.clear()
            }

            decodePreviewCacheRef.current.set(cacheKey, preview)
            return preview
          })

        pendingDecodePreviewRef.current.set(cacheKey, decodePromise)
        return decodePromise
      } catch (error) {
        return buildUnavailablePreview(
          error instanceof Error ? error.message : 'Decode unavailable',
        )
      }
    },
    [],
  )

  const refreshDashboard = useCallback(
    async ({
      initial = false,
      allowAutoConnect = false,
      force = false,
      includeHistory = false,
    }: RefreshDashboardOptions = {}) => {
      if (isPollingRef.current) {
        if (initial || allowAutoConnect || force || includeHistory) {
          const queuedRefresh = queuedRefreshRef.current
          queuedRefreshRef.current = {
            initial: Boolean(initial || queuedRefresh?.initial),
            allowAutoConnect: Boolean(
              allowAutoConnect || queuedRefresh?.allowAutoConnect,
            ),
            force: Boolean(force || queuedRefresh?.force),
            includeHistory: Boolean(includeHistory || queuedRefresh?.includeHistory),
          }
        }
        return
      }

      if (!force && (document.hidden || connectionActionRef.current)) {
        return
      }

      isPollingRef.current = true
      const showRefreshIndicator = initial || force
      if (showRefreshIndicator) {
        setIsRefreshing(true)
      }

      try {
        const shouldRefreshHistory =
          includeHistory ||
          lastHistoryFetchAtRef.current === 0 ||
          Date.now() - lastHistoryFetchAtRef.current >= HISTORY_REFRESH_INTERVAL_MS
        const loadSnapshotBundle = async (withHistory: boolean) => {
          if (!withHistory) {
            return {
              bulkSnapshot: await fetchAllPortsPdi(),
              bulkHistory: null as AllPortsHistoryResponse | null,
            }
          }

          const [bulkSnapshot, bulkHistory] = await Promise.all([
            fetchAllPortsPdi(),
            fetchAllPortsHistory(historyWindowRef.current, HISTORY_CHART_MAX_POINTS),
          ])

          return {
            bulkSnapshot,
            bulkHistory,
          }
        }

        let { bulkSnapshot, bulkHistory } = await loadSnapshotBundle(shouldRefreshHistory)
        let autoConnected = false
        let connectionStatus: ConnectionStatusResponse | null = null

        if (bulkHistory) {
          lastHistoryFetchAtRef.current = Date.now()
        }

        if (force || initial || !bulkSnapshot.polling.configured || !bulkSnapshot.connection) {
          connectionStatus = await readConnectionStatusSafely()
          bulkSnapshot = hydrateSnapshotWithConnectionStatus(
            bulkSnapshot,
            connectionStatus,
          )
        }

        if (allowAutoConnect && !bulkSnapshot.polling.configured) {
          const connectResponse = await connectTarget(DEFAULT_REAL_CONNECT_REQUEST)

          autoConnected = true
          seedDraftRef.current = true
          setConnectionDraft(buildConnectionDraft(connectResponse.connection))
          const refreshedBundle = await loadSnapshotBundle(true)
          bulkSnapshot = refreshedBundle.bulkSnapshot
          bulkHistory = refreshedBundle.bulkHistory
          connectionStatus = await readConnectionStatusSafely()
          bulkSnapshot = hydrateSnapshotWithConnectionStatus(
            bulkSnapshot,
            connectionStatus,
          )
          lastHistoryFetchAtRef.current = Date.now()
        }

        const nextPorts = mapBulkSnapshotToPorts(bulkSnapshot)
        const nextHistory = bulkHistory ? mapBulkHistoryToPorts(bulkHistory) : null

        startTransition(() => {
          setDashboard((previousValue) =>
            preserveReferenceIfEqual(previousValue, bulkSnapshot),
          )
          setPorts((previousValue) =>
            mergePortSnapshots(previousValue, nextPorts),
          )
          if (bulkHistory && nextHistory) {
            setHistorySnapshot((previousValue) =>
              preserveReferenceIfEqual(previousValue, bulkHistory),
            )
            setHistoryByPort((previousValue) =>
              mergePortHistory(previousValue, nextHistory),
            )
          }
          setBanner((previousBanner) =>
            preserveBannerIfEqual(
              previousBanner,
              buildBannerFromSnapshot(bulkSnapshot),
            ),
          )
          setHasLoadedOnce(true)
        })

        if (!seedDraftRef.current && bulkSnapshot.connection) {
          seedDraftRef.current = true
          setConnectionDraft(buildConnectionDraft(bulkSnapshot.connection))
        }

        if (initial && autoConnected) {
          setBanner((previousBanner) =>
            preserveBannerIfEqual(previousBanner, {
              tone: 'success',
              title: 'Real device session ready',
              body: 'The frontend connected to the configured ICE2 target and is now reading from the backend polling cache.',
            }),
          )
        }
      } catch (loadError) {
        setBanner((previousBanner) =>
          preserveBannerIfEqual(previousBanner, {
            tone: 'error',
            title: 'Dashboard refresh failed',
            body: getErrorMessage(loadError),
          }),
        )
      } finally {
        if (showRefreshIndicator) {
          setIsRefreshing(false)
        }
        isPollingRef.current = false

        const queuedRefresh = queuedRefreshRef.current
        if (queuedRefresh) {
          queuedRefreshRef.current = null
          window.setTimeout(() => {
            void refreshDashboardRef.current(queuedRefresh)
          }, 0)
        }
      }
    },
    [readConnectionStatusSafely],
  )

  useEffect(() => {
    refreshDashboardRef.current = refreshDashboard
  }, [refreshDashboard])

  useEffect(() => {
    let cancelled = false

    void refreshDashboard({
      initial: true,
      allowAutoConnect: true,
      force: true,
      includeHistory: true,
    })
    void refreshIoddLibrary()

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        void refreshDashboard()
      }
    }, UI_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [refreshDashboard, refreshIoddLibrary])

  useEffect(() => {
    if (!hasLoadedOnce) {
      return
    }

    void refreshDashboard({ force: true, includeHistory: true })
  }, [hasLoadedOnce, historyWindowMs, refreshDashboard])

  const resolvedPortDisplayConfigs = useMemo(() => {
    return PORT_NUMBERS.reduce<Record<number, PortDisplayConfig>>((accumulator, portNumber) => {
      accumulator[portNumber] = resolvePortDisplayConfig(
        portNumber,
        portDisplayOverrides[portNumber],
      )
      return accumulator
    }, {})
  }, [portDisplayOverrides])

  const trendSeriesByPort = useMemo(() => {
    return PORT_NUMBERS.reduce<Record<number, PortTrendSeries>>((accumulator, portNumber) => {
      accumulator[portNumber] = buildPortTrendSeries(
        historyByPort[portNumber]?.samples ?? [],
        resolvedPortDisplayConfigs[portNumber],
      )
      return accumulator
    }, {})
  }, [historyByPort, resolvedPortDisplayConfigs])

  const ioddProfilesById = useMemo(() => {
    return ioddProfiles.reduce<Record<string, IoddDeviceProfile>>((accumulator, profile) => {
      accumulator[profile.profileId] = profile
      return accumulator
    }, {})
  }, [ioddProfiles])

  const processDataByPort = useMemo(() => {
    return PORT_NUMBERS.reduce<Record<number, ParsedProcessDataProfile | null>>(
      (accumulator, portNumber) => {
        const snapshot =
          ports.find((portSnapshot) => portSnapshot.portNumber === portNumber) ??
          createEmptySnapshot(portNumber)
        const displayConfig = resolvedPortDisplayConfigs[portNumber]
        const assignedIoddProfile =
          displayConfig.processDataProfileId !== null
            ? ioddProfilesById[displayConfig.processDataProfileId] ?? null
            : null

        if (!snapshot.pdi) {
          accumulator[portNumber] = null
          return accumulator
        }

        const resolvedProfile = resolveProcessDataProfile({
          mode: displayConfig.processDataMode,
          requestedProfileId: displayConfig.processDataProfileId,
          deviceKey: assignedIoddProfile?.productId ?? assignedIoddProfile?.deviceName ?? null,
          vendorId: assignedIoddProfile?.vendorId ?? null,
          deviceId: assignedIoddProfile?.deviceId ?? null,
        })

        accumulator[portNumber] = resolvedProfile.profile
          ? parseProcessDataPayload({
              registers: snapshot.pdi.payload.registers,
              profile: resolvedProfile.profile,
              wordOrder: displayConfig.wordOrder,
              byteOrder: displayConfig.byteOrder,
              resolutionSource: resolvedProfile.source,
            })
          : null

        return accumulator
      },
      {},
    )
  }, [ioddProfilesById, ports, resolvedPortDisplayConfigs])

  const selectedPortSnapshot = useMemo(
    () =>
      ports.find((snapshot) => snapshot.portNumber === selectedPortNumber) ??
      createEmptySnapshot(selectedPortNumber),
    [ports, selectedPortNumber],
  )

  const selectedPortHistory = useMemo(
    () => historyByPort[selectedPortNumber] ?? createEmptyHistorySeries(selectedPortNumber),
    [historyByPort, selectedPortNumber],
  )

  const selectedPortTrendSeries = useMemo(
    () => trendSeriesByPort[selectedPortNumber] ?? createEmptyTrendSeries(),
    [selectedPortNumber, trendSeriesByPort],
  )

  const selectedPortOverride = portDisplayOverrides[selectedPortNumber] ?? null
  const selectedPortDisplayConfig = resolvedPortDisplayConfigs[selectedPortNumber]

  const selectedPortIoddProfile = useMemo(
    () => {
      const selectedProfileId = selectedPortDisplayConfig.processDataProfileId
      return selectedProfileId ? ioddProfilesById[selectedProfileId] ?? null : null
    },
    [ioddProfilesById, selectedPortDisplayConfig.processDataProfileId],
  )

  const selectedPortProcessData = useMemo(
    () => processDataByPort[selectedPortNumber] ?? null,
    [processDataByPort, selectedPortNumber],
  )

  useEffect(() => {
    const requestVersion = ++featuredDecodeRequestVersionRef.current
    let cancelled = false

    async function syncFeaturedDecodes() {
      const previewEntries = await Promise.all(
        ports.map(async (snapshot) => {
          if (!snapshot.pdi) {
            return [
              snapshot.portNumber,
              buildUnavailablePreview(snapshot.error ?? 'Awaiting cached payload'),
            ] as const
          }

          const preview = await resolveConvertedPreview(
            snapshot.pdi.payload.registers,
            resolvedPortDisplayConfigs[snapshot.portNumber],
          )

          return [
            snapshot.portNumber,
            applyResolutionToPreview(
              preview,
              resolvedPortDisplayConfigs[snapshot.portNumber].preferredDecodeType,
              resolvedPortDisplayConfigs[snapshot.portNumber].resolutionFactor,
              resolvedPortDisplayConfigs[snapshot.portNumber].sentinelMappings,
            ),
          ] as const
        }),
      )

      if (cancelled || requestVersion !== featuredDecodeRequestVersionRef.current) {
        return
      }

      startTransition(() => {
        setFeaturedDecodesByPort((previousPreviews) => {
          let hasChanged = false
          const nextPreviews: Record<number, DecodedPreview> = { ...previousPreviews }

          for (const [portNumber, nextPreview] of previewEntries) {
            const previousPreview = previousPreviews[portNumber]
            if (previousPreview && isSamePreview(previousPreview, nextPreview)) {
              nextPreviews[portNumber] = previousPreview
              continue
            }

            nextPreviews[portNumber] = nextPreview
            hasChanged = true
          }

          return hasChanged ? nextPreviews : previousPreviews
        })
      })
    }

    void syncFeaturedDecodes()

    return () => {
      cancelled = true
    }
  }, [ports, resolvedPortDisplayConfigs, resolveConvertedPreview])

  useEffect(() => {
    const requestVersion = ++selectedDecodeRequestVersionRef.current
    let cancelled = false

    async function syncSelectedPortDecodes() {
      const selectedPdi = selectedPortSnapshot.pdi

      if (!selectedPdi) {
        startTransition(() => {
          setSelectedPortDecodes(null)
        })
        return
      }

      const featuredType = selectedPortDisplayConfig.preferredDecodeType
      const requestedTypes = Array.from(
        new Set([featuredType, ...getOverviewDecodeTypes(featuredType)]),
      )

      const previewEntries = await Promise.all(
        requestedTypes.map(async (dataType) => {
          const preview = await resolveConvertedPreview(
            selectedPdi.payload.registers,
            selectedPortDisplayConfig,
            dataType,
          )

          return [
            dataType,
            applyResolutionToPreview(
              preview,
              dataType,
              selectedPortDisplayConfig.resolutionFactor,
              selectedPortDisplayConfig.sentinelMappings,
            ),
          ] as const
        }),
      )

      if (cancelled || requestVersion !== selectedDecodeRequestVersionRef.current) {
        return
      }

      const previews = Object.fromEntries(previewEntries)
      startTransition(() => {
        setSelectedPortDecodes(buildPortDecodeCollection(featuredType, previews))
      })
    }

    void syncSelectedPortDecodes()

    return () => {
      cancelled = true
    }
  }, [selectedPortDisplayConfig, selectedPortSnapshot, resolveConvertedPreview])

  const communicationPresentation = useMemo(
    () => getCommunicationPresentation(dashboard),
    [dashboard],
  )

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

  const diagnosticsByPort = useMemo(() => {
    return PORT_NUMBERS.reduce<Record<number, PortDiagnostic>>((accumulator, portNumber) => {
      const snapshot =
        ports.find((portSnapshot) => portSnapshot.portNumber === portNumber) ??
        createEmptySnapshot(portNumber)
      const featuredPreview =
        featuredDecodesByPort[portNumber] ?? buildUnavailablePreview('Awaiting decode')

      accumulator[portNumber] = buildPortDiagnostic(
        snapshot,
        resolvedPortDisplayConfigs[portNumber],
        featuredPreview,
        trendSeriesByPort[portNumber] ?? createEmptyTrendSeries(),
        dashboard,
      )
      return accumulator
    }, {})
  }, [dashboard, featuredDecodesByPort, ports, resolvedPortDisplayConfigs, trendSeriesByPort])

  const selectedPortDiagnostic = useMemo(
    () => diagnosticsByPort[selectedPortNumber],
    [diagnosticsByPort, selectedPortNumber],
  )

  const diagnosticCounts = useMemo(
    () => countDiagnosticLevels(diagnosticsByPort),
    [diagnosticsByPort],
  )

  const connectionSummary = useMemo(() => {
    if (!dashboard?.connection) {
      return 'No backend target configured'
    }

    return `${dashboard.connection.mode} | ${dashboard.connection.host}:${dashboard.connection.port} | slave ${dashboard.connection.slave_id}`
  }, [dashboard?.connection])

  const connectionMeta = useMemo(() => buildConnectionMeta(dashboard), [dashboard])

  const backendModeLabel =
    dashboard?.backend_mode ?? DEFAULT_REAL_CONNECT_REQUEST.mode
  const lastUpdatedLabel = formatPollingTimestamp(
    dashboard?.polling.last_successful_poll_at ?? dashboard?.polling.updated_at ?? null,
  )
  const staleStateLabel = !dashboard?.polling.configured
    ? 'Idle'
    : dashboard.polling.is_stale
      ? 'Stale'
      : 'Fresh'
  const staleStateTone = !dashboard?.polling.configured
    ? 'neutral'
    : dashboard.polling.is_stale
      ? 'warning'
      : 'normal'

  const handleConnect = useCallback(async () => {
    const host = connectionDraft.host.trim()
    const port = Number(connectionDraft.port)
    const slaveId = Number(connectionDraft.slaveId)
    const timeout = Number(connectionDraft.timeout)
    const retries = Number(connectionDraft.retries)

    if (
      !host ||
      !Number.isInteger(port) ||
      port <= 0 ||
      !Number.isInteger(slaveId) ||
      slaveId < 0 ||
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      !Number.isInteger(retries) ||
      retries < 0
    ) {
      setBanner({
        tone: 'error',
        title: 'Connection details incomplete',
        body: 'Enter a mode, host, valid port, valid slave ID, positive timeout, and non-negative retries before connecting.',
      })
      return
    }

    setIsConnecting(true)

    try {
      const response = await connectTarget({
        mode: connectionDraft.mode,
        host,
        port,
        slave_id: slaveId,
        timeout,
        retries,
      })

      seedDraftRef.current = true
      setConnectionDraft(buildConnectionDraft(response.connection))
      await refreshDashboard({ force: true, includeHistory: true })

      setBanner({
        tone: 'success',
        title: 'Connection updated',
        body: `Connected in ${response.connection.mode} mode to ${response.connection.host}:${response.connection.port} with slave ${response.connection.slave_id}.`,
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
  }, [connectionDraft, refreshDashboard])

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true)

    try {
      const response = await disconnectTarget()

      if (response.connection) {
        seedDraftRef.current = true
        setConnectionDraft(buildConnectionDraft(response.connection))
      }

      await refreshDashboard({ force: true, includeHistory: true })
      setBanner({
        tone: 'info',
        title: 'Backend target disconnected',
        body: response.message,
      })
    } catch (error) {
      setBanner({
        tone: 'error',
        title: 'Disconnect failed',
        body: getErrorMessage(error),
      })
    } finally {
      setIsDisconnecting(false)
    }
  }, [refreshDashboard])

  const updatePortDisplayOverride = useCallback(
    (portNumber: number, override: PortDisplayOverride) => {
      setPortDisplayOverrides((previousOverrides) => {
        const normalized = normalizePortDisplayOverride(override)

        if (normalized === null) {
          if (!(portNumber in previousOverrides)) {
            return previousOverrides
          }

          const nextOverrides = { ...previousOverrides }
          delete nextOverrides[portNumber]
          return nextOverrides
        }

        const previousOverride = previousOverrides[portNumber]
        if (serializeValue(previousOverride) === serializeValue(normalized)) {
          return previousOverrides
        }

        return {
          ...previousOverrides,
          [portNumber]: normalized,
        }
      })
    },
    [],
  )

  const resetPortDisplay = useCallback((portNumber: number) => {
    setPortDisplayOverrides((previousOverrides) => {
      if (!(portNumber in previousOverrides)) {
        return previousOverrides
      }

      const nextOverrides = { ...previousOverrides }
      delete nextOverrides[portNumber]
      return nextOverrides
    })
  }, [])

  return useMemo(
    () => ({
      dashboard,
      historySnapshot,
      ports,
      historyByPort,
      trendSeriesByPort,
      featuredDecodesByPort,
      ioddProfiles,
      ioddProfilesById,
      processDataByPort,
      diagnosticsByPort,
      selectedPortDecodes,
      historyWindowMs,
      portDisplayOverrides,
      resolvedPortDisplayConfigs,
      selectedPortNumber,
      selectedPortSnapshot,
      selectedPortHistory,
      selectedPortTrendSeries,
      selectedPortIoddProfile,
      selectedPortProcessData,
      selectedPortOverride,
      selectedPortDisplayConfig,
      selectedPortDiagnostic,
      connectionDraft,
      hasLoadedOnce,
      isRefreshing,
      isConnecting,
      isDisconnecting,
      banner,
      communicationPresentation,
      severityCounts,
      diagnosticCounts,
      connectionSummary,
      connectionMeta,
      backendModeLabel,
      lastUpdatedLabel,
      staleStateLabel,
      staleStateTone,
      uiRefreshMs: UI_REFRESH_INTERVAL_MS,
      historyRefreshMs: HISTORY_REFRESH_INTERVAL_MS,
      setHistoryWindowMs,
      setSelectedPortNumber,
      setConnectionDraft,
      refreshDashboard,
      refreshIoddLibrary,
      handleConnect,
      handleDisconnect,
      updatePortDisplayOverride,
      resetPortDisplay,
    }),
    [
      backendModeLabel,
      banner,
      communicationPresentation,
      connectionDraft,
      connectionMeta,
      connectionSummary,
      dashboard,
      diagnosticCounts,
      diagnosticsByPort,
      featuredDecodesByPort,
      handleConnect,
      handleDisconnect,
      hasLoadedOnce,
      historyByPort,
      historySnapshot,
      historyWindowMs,
      ioddProfiles,
      ioddProfilesById,
      isConnecting,
      isDisconnecting,
      isRefreshing,
      lastUpdatedLabel,
      portDisplayOverrides,
      ports,
      processDataByPort,
      refreshDashboard,
      refreshIoddLibrary,
      resetPortDisplay,
      resolvedPortDisplayConfigs,
      selectedPortDecodes,
      selectedPortDiagnostic,
      selectedPortDisplayConfig,
      selectedPortHistory,
      selectedPortIoddProfile,
      selectedPortNumber,
      selectedPortOverride,
      selectedPortProcessData,
      selectedPortSnapshot,
      selectedPortTrendSeries,
      setConnectionDraft,
      setHistoryWindowMs,
      setSelectedPortNumber,
      severityCounts,
      staleStateLabel,
      staleStateTone,
      trendSeriesByPort,
      updatePortDisplayOverride,
    ],
  )
}
