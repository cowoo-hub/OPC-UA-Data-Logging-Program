import type {
  AllPortsHistoryResponse,
  AllPortsPdiResponse,
  ByteOrder,
  ConnectRequest,
  ConnectResponse,
  ConnectionStatusResponse,
  ConvertRequest,
  ConvertResponse,
  DisplaySyncRequest,
  DisplaySyncResponse,
  FieldMode,
  DisconnectResponse,
  HealthResponse,
  HistoryExportMode,
  HistoryExportRange,
  IoddLibraryResponse,
  IoddUploadResponse,
  IsduReadRequest,
  IsduReadResponse,
  IsduWriteRequest,
  IsduWriteResponse,
  OpcUaConfigRequest,
  OpcUaConfigResponse,
  OpcUaNodePreviewResponse,
  OpcUaStatusResponse,
  PortDisplayConfig,
  PortSeverity,
  DiagnosticLevel,
  IoddDeleteResponse,
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '/api'

function detectDesktopRuntime() {
  if (typeof window === 'undefined') {
    return false
  }

  if (document.documentElement.dataset.runtime === 'desktop') {
    return true
  }

  const runtimeSearchParams = new URLSearchParams(window.location.search)
  return runtimeSearchParams.get('desktop') === '1'
}

export const IS_DESKTOP_RUNTIME = detectDesktopRuntime()

function readRefreshInterval() {
  const rawValue =
    import.meta.env.VITE_UI_REFRESH_MS ??
    import.meta.env.VITE_UI_REFRESH_INTERVAL_MS ??
    (IS_DESKTOP_RUNTIME ? '120' : '50')

  const parsedValue = Number(rawValue)

  if (!Number.isFinite(parsedValue) || parsedValue < 20) {
    return IS_DESKTOP_RUNTIME ? 120 : 50
  }

  return Math.round(parsedValue)
}

function readHistoryRefreshInterval() {
  const rawValue =
    import.meta.env.VITE_HISTORY_REFRESH_MS ??
    import.meta.env.VITE_HISTORY_REFRESH_INTERVAL_MS ??
    (IS_DESKTOP_RUNTIME ? '900' : '400')

  const parsedValue = Number(rawValue)

  if (!Number.isFinite(parsedValue) || parsedValue < 100) {
    return IS_DESKTOP_RUNTIME ? 900 : 400
  }

  return Math.round(parsedValue)
}

export const UI_REFRESH_INTERVAL_MS = readRefreshInterval()
export const HISTORY_REFRESH_INTERVAL_MS = readHistoryRefreshInterval()
export const UI_INTERPOLATION_INTERVAL_MS = IS_DESKTOP_RUNTIME ? 160 : 90
export const UI_SMOOTHING_STEP_MS = IS_DESKTOP_RUNTIME ? 72 : 42
export const HISTORY_CHART_MAX_POINTS = 120
export const PERF_OVERLAY_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_PERF_OVERLAY === 'true'
export const HISTORY_EXPORT_RANGES: Array<{
  value: HistoryExportRange
  label: string
  windowMs: number
}> = [
  { value: '30s', label: '30 s', windowMs: 30_000 },
  { value: '2min', label: '2 min', windowMs: 120_000 },
  { value: '10min', label: '10 min', windowMs: 600_000 },
  { value: '15min', label: '15 min', windowMs: 900_000 },
  { value: '30min', label: '30 min', windowMs: 1_800_000 },
  { value: '1h', label: '1 h', windowMs: 3_600_000 },
]

export function getHistoryExportRangeByValue(value: HistoryExportRange) {
  return HISTORY_EXPORT_RANGES.find((rangeOption) => rangeOption.value === value) ?? null
}

export function getHistoryExportRangeByWindowMs(windowMs: number) {
  return (
    HISTORY_EXPORT_RANGES.find((rangeOption) => rangeOption.windowMs === windowMs) ??
    null
  )
}

export const DEFAULT_REAL_CONNECT_REQUEST: ConnectRequest = {
  mode: 'real',
  host: '192.168.1.108',
  port: 502,
  slave_id: 1,
  timeout: 3,
  retries: 1,
}

export const DEFAULT_SIMULATOR_CONNECT_REQUEST: ConnectRequest = {
  mode: 'simulator',
  host: 'ice2-simulator',
  port: 502,
  slave_id: 1,
  timeout: 1,
  retries: 0,
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const rawBody = await response.text()
  const body = rawBody ? (JSON.parse(rawBody) as unknown) : null

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'detail' in body &&
      typeof body.detail === 'string'
        ? body.detail
        : `${response.status} ${response.statusText}`

    throw new Error(message)
  }

  return body as T
}

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}

export async function fetchConnectionStatus(): Promise<ConnectionStatusResponse> {
  return request<ConnectionStatusResponse>('/connection')
}

export async function fetchOpcUaStatus(): Promise<OpcUaStatusResponse> {
  return request<OpcUaStatusResponse>('/opcua/status')
}

export async function fetchOpcUaNodes(): Promise<OpcUaNodePreviewResponse> {
  return request<OpcUaNodePreviewResponse>('/opcua/nodes')
}

export async function updateOpcUaConfig(
  payload: OpcUaConfigRequest,
): Promise<OpcUaConfigResponse> {
  return request<OpcUaConfigResponse>('/opcua/config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function syncDisplayConfigs(
  payload: DisplaySyncRequest,
): Promise<DisplaySyncResponse> {
  return request<DisplaySyncResponse>('/display-configs', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function fetchIoddLibrary(): Promise<IoddLibraryResponse> {
  return request<IoddLibraryResponse>('/iodd/library')
}

export async function uploadIoddFile(file: File): Promise<IoddUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/iodd/library/upload`, {
    method: 'POST',
    body: formData,
  })

  const rawBody = await response.text()
  const body = rawBody ? (JSON.parse(rawBody) as unknown) : null

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'detail' in body &&
      typeof body.detail === 'string'
        ? body.detail
        : `${response.status} ${response.statusText}`

    throw new Error(message)
  }

  return body as IoddUploadResponse
}

export async function deleteIoddProfile(
  profileId: string,
): Promise<IoddDeleteResponse> {
  const encodedProfileId = encodeURIComponent(profileId)

  try {
    return await request<IoddDeleteResponse>(`/iodd/library/${encodedProfileId}`, {
      method: 'DELETE',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    const shouldRetryWithPost =
      message.includes('405') || message.includes('method not allowed')

    if (!shouldRetryWithPost) {
      throw error
    }

    return request<IoddDeleteResponse>(`/iodd/library/${encodedProfileId}/delete`, {
      method: 'POST',
    })
  }
}

export async function connectTarget(
  payload: ConnectRequest,
): Promise<ConnectResponse> {
  return request<ConnectResponse>('/connect', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function disconnectTarget(): Promise<DisconnectResponse> {
  return request<DisconnectResponse>('/disconnect', {
    method: 'POST',
  })
}

export async function fetchAllPortsPdi(): Promise<AllPortsPdiResponse> {
  return request<AllPortsPdiResponse>('/ports/all/pdi')
}

export async function fetchAllPortsHistory(
  windowMs: number,
  maxPoints = HISTORY_CHART_MAX_POINTS,
): Promise<AllPortsHistoryResponse> {
  const searchParams = new URLSearchParams({
    window_ms: String(windowMs),
    max_points: String(maxPoints),
  })

  return request<AllPortsHistoryResponse>(`/ports/all/history?${searchParams.toString()}`)
}

export async function convertRegisters(
  payload: ConvertRequest,
): Promise<ConvertResponse> {
  return request<ConvertResponse>('/convert', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function readIsduParameter(
  payload: IsduReadRequest,
): Promise<IsduReadResponse> {
  return request<IsduReadResponse>('/isdu/read', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function writeIsduParameter(
  payload: IsduWriteRequest,
): Promise<IsduWriteResponse> {
  return request<IsduWriteResponse>('/isdu/write', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

function normalizeExportByteOrder(
  byteOrder: ByteOrder,
): 'big' | 'little' {
  return byteOrder
}

function normalizeExportFieldMode(
  fieldMode: FieldMode,
): 'full_word' | 'bit_field' {
  return fieldMode
}

function readDownloadFilename(contentDisposition: string | null) {
  if (!contentDisposition) {
    return null
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const simpleMatch = contentDisposition.match(/filename="?([^"]+)"?/i)
  return simpleMatch?.[1] ?? null
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const blobUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = blobUrl
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(blobUrl)
}

async function saveBlobWithDesktopDialog(blob: Blob, filename: string) {
  if (typeof window === 'undefined') {
    return false
  }

  const desktopSaveApi = window.pywebview?.api?.save_csv_file

  if (!desktopSaveApi) {
    return false
  }

  const csvContent = await blob.text()
  const saveResult = await desktopSaveApi(filename, csvContent)

  if (saveResult.saved) {
    return true
  }

  if (saveResult.cancelled) {
    return true
  }

  throw new Error(saveResult.error ?? 'CSV save dialog failed.')
}

function getBrowserTimeZoneMetadata() {
  const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return {
    timeZone: resolvedTimeZone?.trim() ? resolvedTimeZone : null,
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  }
}

export async function downloadPortHistoryCsv(params: {
  portNumber: number
  exportMode: HistoryExportMode
  range?: HistoryExportRange
  customRange?: {
    start: string
    end: string
  }
  displayConfig: PortDisplayConfig
  status?: PortSeverity | null
  eventCode?: string | null
  anomalyState?: DiagnosticLevel | null
}): Promise<void> {
  const timeZoneMetadata = getBrowserTimeZoneMetadata()
  const searchParams = new URLSearchParams({
    data_type: params.displayConfig.preferredDecodeType,
    word_order: params.displayConfig.wordOrder,
    byte_order: normalizeExportByteOrder(params.displayConfig.byteOrder),
    resolution_factor: String(params.displayConfig.resolutionFactor),
    source_word_count: String(params.displayConfig.sourceWordCount),
    field_mode: normalizeExportFieldMode(params.displayConfig.fieldMode),
    bit_offset: String(params.displayConfig.bitOffset),
    bit_length: String(params.displayConfig.bitLength),
    signed: String(params.displayConfig.signed),
    local_utc_offset_minutes: String(timeZoneMetadata.utcOffsetMinutes),
  })

  if (timeZoneMetadata.timeZone) {
    searchParams.set('time_zone', timeZoneMetadata.timeZone)
  }

  if (params.exportMode === 'custom') {
    if (!params.customRange?.start || !params.customRange.end) {
      throw new Error('Choose both custom export start and end times.')
    }

    searchParams.set('start', params.customRange.start)
    searchParams.set('end', params.customRange.end)
  } else {
    searchParams.set('range', params.range ?? '30s')
  }

  if (params.displayConfig.engineeringUnit) {
    searchParams.set('engineering_unit', params.displayConfig.engineeringUnit)
  }

  if (params.status) {
    searchParams.set('status', params.status)
  }

  if (params.eventCode) {
    searchParams.set('event_code', params.eventCode)
  }

  if (params.anomalyState) {
    searchParams.set('anomaly_state', params.anomalyState)
  }

  for (const mapping of params.displayConfig.sentinelMappings) {
    searchParams.append('sentinel_mapping', `${mapping.value}=${mapping.label}`)
  }

  const response = await fetch(
    `${API_BASE_URL}/ports/${params.portNumber}/history/export?${searchParams.toString()}`,
    {
      method: 'GET',
    },
  )

  if (!response.ok) {
    const rawBody = await response.text()
    let message = rawBody || `${response.status} ${response.statusText}`

    try {
      const parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : null
      message =
        typeof parsedBody === 'object' &&
        parsedBody !== null &&
        'detail' in parsedBody &&
        typeof parsedBody.detail === 'string'
          ? parsedBody.detail
          : `${response.status} ${response.statusText}`
    } catch {
      message = rawBody || `${response.status} ${response.statusText}`
    }

    throw new Error(message)
  }

  const filename =
    readDownloadFilename(response.headers.get('Content-Disposition')) ??
    `port${params.portNumber}_pdi_history_${params.exportMode === 'custom' ? 'custom' : (params.range ?? '30s')}.csv`
  const blob = await response.blob()

  if (IS_DESKTOP_RUNTIME) {
    const handledByDesktopDialog = await saveBlobWithDesktopDialog(blob, filename)

    if (handledByDesktopDialog) {
      return
    }
  }

  triggerBlobDownload(blob, filename)
}
