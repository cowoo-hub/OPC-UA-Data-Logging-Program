export type DecodeType =
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'float32'
  | 'binary'
export type HistoryExportRange =
  | '30s'
  | '2min'
  | '10min'
  | '15min'
  | '30min'
  | '1h'
export type HistoryExportMode = 'preset' | 'custom'

export type BackendMode = 'real' | 'simulator'
export type WordOrder = 'big' | 'little'
export type ByteOrder = 'big' | 'little'
export type ResolutionFactor = 1 | 0.1 | 0.01 | 0.001
export type FieldMode = 'full_word' | 'bit_field'
export type PortSeverity = 'normal' | 'warning' | 'critical'
export type DiagnosticLevel = PortSeverity
export type PortProfileId =
  | 'generic'
  | 'temperature'
  | 'pressure'
  | 'flow'
  | 'counter'
export type CommunicationState =
  | 'healthy'
  | 'stale'
  | 'disconnected'
  | 'polling_error'
export type DeviceProfileSource = 'builtin' | 'iodd'

export interface ConnectionInfo {
  mode: BackendMode
  host: string
  port: number
  slave_id: number
  timeout: number
  retries: number
}

export interface HealthResponse {
  status: string
  phase: string
  backend_mode: BackendMode
  default_mode?: BackendMode
  poll_interval_ms?: number
  stale_after_ms?: number
  reconnect_base_ms?: number
  reconnect_max_ms?: number
  history_sample_interval_ms?: number
  cache_running?: boolean
  cache_updated_at?: string | null
  last_successful_poll_at?: string | null
  cache_is_stale?: boolean
  communication_state?: CommunicationState
  last_error?: string | null
  iodd_upload_enabled?: boolean
  dependencies?: {
    fastapi?: string
    uvicorn?: string
    pymodbus?: string
    python_multipart?: string
  }
  opcua?: OpcUaStatus | null
  display_sync_updated_at?: string | null
}

export interface PollingStatus {
  backend_mode: BackendMode
  interval_ms: number
  history_sample_interval_ms: number
  stale_after_ms: number
  payload_word_count: number
  block_mode: 'multiple' | 'specific'
  configured: boolean
  running: boolean
  updated_at: string | null
  last_successful_poll_at: string | null
  age_ms: number | null
  is_stale: boolean
  cycle_count: number
  last_error: string | null
  communication_state: CommunicationState
  has_snapshot: boolean
  last_failure_at: string | null
  consecutive_failures: number
  reconnect_attempts: number
  next_retry_at: string | null
  next_retry_in_ms: number | null
}

export interface ConnectionStatusResponse {
  configured: boolean
  connection: ConnectionInfo | null
  polling?: PollingStatus
}

export interface OpcUaStatus {
  enabled: boolean
  configured: boolean
  running: boolean
  endpoint: string
  namespace_uri: string
  server_name?: string
  namespace_index: number | null
  security_mode: 'none' | string
  anonymous: boolean
  writable: boolean
  last_error: string | null
  last_update_at: string | null
}

export interface OpcUaStatusResponse {
  opcua: OpcUaStatus | null
  connection: {
    configured: boolean
    connection: ConnectionInfo | null
    polling: PollingStatus
  }
  polling: PollingStatus
}

export interface OpcUaNodePreview {
  key: string
  browse_path: string
  value: string | number | boolean | Array<string | number | boolean | null> | null
  data_type: string
  updated_at: string | null
}

export interface OpcUaNodePreviewResponse {
  opcua: OpcUaStatus | null
  polling: PollingStatus
  count: number
  nodes: OpcUaNodePreview[]
}

export interface OpcUaPortCheckResponse {
  requested_host: string
  bind_host: string
  endpoint_host: string
  port: number
  host_valid: boolean
  available: boolean
  in_use_by_masterway: boolean
  message: string
}

export interface OpcUaConfigRequest {
  enabled: boolean
  host: string
  port: number
  path: string
  namespace_uri: string
  server_name: string
  security_mode: 'none'
  anonymous: boolean
  writable: boolean
}

export interface OpcUaConfigResponse {
  updated: boolean
  opcua: OpcUaStatus
}

export interface OpcUaDraft {
  enabled: boolean
  endpointUrl: string
  host: string
  port: string
  path: string
  namespaceUri: string
  serverName: string
  securityMode: 'none'
  anonymous: boolean
  writable: boolean
}

export interface ConnectRequest {
  mode: BackendMode
  host: string
  port: number
  slave_id: number
  timeout: number
  retries: number
}

export interface ConnectResponse {
  connected: boolean
  message: string
  connection: ConnectionInfo
}

export interface DisconnectResponse {
  disconnected: boolean
  message: string
  connection: ConnectionInfo | null
}

export type IsduOperation = 'read' | 'write'
export type IsduPreviewSource = 'response' | 'request' | 'none'

export interface IsduReadRequest {
  port: number
  index: number
  subindex: number
}

export interface IsduWriteRequest {
  port: number
  index: number
  subindex: number
  data_hex: string
}

export interface IsduTransportInfo {
  mode: BackendMode
  protocol: 'rest-http' | 'simulator'
  endpoint_url: string
  timeout_seconds: number
  uses_basic_auth: boolean
}

export interface IsduRequestFrame {
  operation: IsduOperation
  port: number
  device_port: number
  index: number
  subindex: number
  data_hex: string | null
  payload: Array<Record<string, number | string>>
  payload_json: string
}

export interface IsduResponseEnvelope {
  ok: boolean
  timed_out: boolean
  acknowledged: boolean
  status: string
  code: number | null
  data_hex: string | null
  raw_json: unknown
  raw_json_pretty: string
}

export interface IsduDecodedPreview {
  byte_count: number
  hex: string
  bytes: number[]
  uint16_be: number | null
  uint16_le: number | null
  int16_be: number | null
  int16_le: number | null
  uint32_be: number | null
  uint32_le: number | null
  int32_be: number | null
  int32_le: number | null
  utf8: string | null
  ascii: string | null
}

export interface IsduOperationResponse {
  connection: ConnectionInfo
  transport: IsduTransportInfo
  request: IsduRequestFrame
  response: IsduResponseEnvelope
  preview: IsduDecodedPreview | null
  preview_source: IsduPreviewSource
  error: string | null
  duration_ms: number
}

export type IsduReadResponse = IsduOperationResponse
export type IsduWriteResponse = IsduOperationResponse

export interface PdiBlockMetadata {
  mode: 'multiple' | 'specific'
  base1_address: number
  base0_address: number
  header_word_count: number
  payload_word_count: number
  total_word_count: number
}

export interface PortStatus {
  raw: number
  hex: string
  initialization_active: boolean
  operational: boolean
  pdi_valid: boolean
  fault: boolean
  fault_severity: 'minor' | 'major' | null
  reserved_bits: number
}

export interface AuxiliaryInput {
  raw: number
  hex: string
  active: boolean
  reserved_bits: number
}

export interface EventCode {
  raw: number
  hex: string
  active: boolean
}

export interface PdiHeader {
  port_status: PortStatus
  auxiliary_input: AuxiliaryInput
  event_code: EventCode
}

export interface PdiPayload {
  registers: number[]
  hex: string
}

export interface PdiResponse {
  connection: ConnectionInfo
  port: number
  pdi_block: PdiBlockMetadata
  header: PdiHeader
  payload: PdiPayload
}

export interface AllPortsPdiResponse {
  backend_mode: BackendMode
  connection: ConnectionInfo | null
  polling: PollingStatus
  ports: PdiResponse[]
}

export interface HistorySample {
  timestamp: string
  registers: number[]
  hex: string
}

export interface PortHistorySeries {
  port: number
  samples: HistorySample[]
}

export interface AllPortsHistoryResponse {
  backend_mode: BackendMode
  connection: ConnectionInfo | null
  polling: PollingStatus
  history_window_ms: number
  history_retention_ms: number
  history_max_points: number
  history_source_register_count: number
  ports: PortHistorySeries[]
}

export interface PortHistoryResponse {
  backend_mode: BackendMode
  connection: ConnectionInfo | null
  polling: PollingStatus
  history_window_ms: number
  history_retention_ms: number
  history_max_points: number
  history_source_register_count: number
  port: number
  samples: HistorySample[]
}

export interface ConvertRequest {
  registers: number[]
  data_type: DecodeType
  word_offset?: number
  word_length?: number
  word_order: WordOrder
}

export interface ConvertResponse {
  data_type: DecodeType
  word_offset: number
  word_length: number | null
  word_order: WordOrder
  registers: number[]
  hex: string
  value: number | string
}

export interface DecodeSettings {
  dataType: DecodeType
  wordOrder: WordOrder
  byteOrder: ByteOrder
}

export interface SentinelMapping {
  value: number
  label: string
}

export interface StatusBitDefinition {
  bit: number
  label: string
}

export interface StatusBitState extends StatusBitDefinition {
  active: boolean
}

export type ProcessDataProfileMode = 'manual' | 'profile' | 'auto'
export type ProcessDataProfileId = string
export type ProcessDataFieldType =
  | 'bool'
  | 'uint'
  | 'int'
  | 'enum'
  | 'binary'
  | 'float32'
export type ProcessDataFieldRole =
  | 'primary_value'
  | 'scale'
  | 'status'
  | 'quality'
  | 'diagnostic'
  | 'meta'

export interface ProcessDataDeviceHint {
  deviceKey?: string | null
  vendorId?: number | null
  deviceId?: number | null
}

export interface ProcessDataEnumMapping {
  value: number
  label: string
}

export interface ProcessDataFieldDefinition {
  name: string
  label: string
  bitOffset: number
  bitLength: number
  type: ProcessDataFieldType
  role?: ProcessDataFieldRole
  signed?: boolean
  scaleFactor?: number
  unit?: string | null
  description?: string | null
  enumMappings?: ProcessDataEnumMapping[]
}

export interface ProcessDataProfileSummary extends ProcessDataDeviceHint {
  id: ProcessDataProfileId
  name: string
  description: string
  totalBitLength: number
  sourceWordCount: number
}

export interface ProcessDataProfileDefinition extends ProcessDataProfileSummary {
  fields: ProcessDataFieldDefinition[]
  primaryFieldName?: string | null
}

export type ProcessDataResolutionSource =
  | 'manual_disabled'
  | 'manual_selection'
  | 'device_identity'
  | 'device_key'
  | 'unresolved'

export interface ParsedProcessDataField {
  name: string
  label: string
  type: ProcessDataFieldType
  role: ProcessDataFieldRole | null
  bitOffset: number
  bitLength: number
  bitRangeLabel: string
  rawValue: number | string | boolean | null
  rawDisplayValue: string
  scaledValue: number | string | boolean | null
  displayValue: string
  unit: string | null
  description: string | null
  active: boolean | null
  isMapped: boolean
}

export interface ParsedProcessDataProfile extends ProcessDataProfileSummary {
  resolutionSource: ProcessDataResolutionSource
  sourceRegisters: number[]
  rawHex: string
  primaryField: ParsedProcessDataField | null
  fields: ParsedProcessDataField[]
  statusFields: ParsedProcessDataField[]
  qualityFields: ParsedProcessDataField[]
  error: string | null
}

export interface IoddIsduVariable {
  key: string
  name: string
  index: number
  subindex: number
  accessRights: string | null
  dataType: string | null
  bitLength: number | null
  unit: string | null
  description: string | null
  enumMappings: ProcessDataEnumMapping[]
}

export interface IoddDeviceProfile {
  profileId: string
  source: Exclude<DeviceProfileSource, 'builtin'>
  fileName: string
  uploadedAtUtc: string
  vendorId: number | null
  vendorName: string | null
  deviceId: number | null
  deviceName: string
  deviceFamily: string | null
  productId: string | null
  processDataInBitLength: number | null
  processDataOutBitLength: number | null
  processDataProfile: ProcessDataProfileDefinition | null
  isduVariables: IoddIsduVariable[]
}

export interface IoddLibraryResponse {
  count: number
  profiles: IoddDeviceProfile[]
}

export interface IoddUploadResponse {
  uploaded: boolean
  profile: IoddDeviceProfile
  count: number
}

export interface IoddDeleteResponse {
  deleted: boolean
  profileId: string
  profile: IoddDeviceProfile | null
  message: string
  count: number
}

export interface PortDisplayOverride {
  label?: string
  profileId?: PortProfileId
  engineeringUnit?: string | null
  preferredDecodeType?: DecodeType
  wordOrder?: WordOrder
  byteOrder?: ByteOrder
  resolutionFactor?: ResolutionFactor
  sourceWordCount?: number
  fieldMode?: FieldMode
  bitOffset?: number
  bitLength?: number
  signed?: boolean
  sentinelMappings?: SentinelMapping[]
  statusBits?: StatusBitDefinition[]
  processDataMode?: ProcessDataProfileMode
  processDataProfileId?: ProcessDataProfileId | null
}

export type PortDisplayOverrides = Partial<Record<number, PortDisplayOverride>>

export interface PortDisplayConfig {
  portNumber: number
  label: string
  profileId: PortProfileId
  profileLabel: string
  engineeringLabel: string
  engineeringUnit: string | null
  operatorHint: string
  preferredDecodeType: DecodeType
  wordOrder: WordOrder
  byteOrder: ByteOrder
  resolutionFactor: ResolutionFactor
  sourceWordCount: number
  fieldMode: FieldMode
  bitOffset: number
  bitLength: number
  signed: boolean
  sentinelMappings: SentinelMapping[]
  statusBits: StatusBitDefinition[]
  processDataMode: ProcessDataProfileMode
  processDataProfileId: ProcessDataProfileId | null
  usesProfileDefaults: boolean
  isCustomized: boolean
}

export interface DisplaySyncPortPayload {
  config: PortDisplayConfig
  processDataProfile: ProcessDataProfileDefinition | null
}

export interface DisplaySyncRequest {
  ports: Record<number, DisplaySyncPortPayload>
}

export interface DisplaySyncResponse {
  updated: boolean
  count: number
  updatedAt: string | null
}

export interface ConnectionDraft {
  mode: BackendMode
  host: string
  port: string
  slaveId: string
  timeout: string
  retries: string
}

export interface DecodedPreview {
  displayValue: string
  rawValue: number | string | null
  scaledValue: number | string | null
  mappingComparisonValue: number | null
  rawDisplayValue: string | null
  sourceRegisters: number[]
  error: string | null
  sentinelLabel: string | null
  statusBits: StatusBitState[]
}

export interface PortDecodeCollection {
  featured: DecodedPreview
  uint16: DecodedPreview
  int16: DecodedPreview
  float32: DecodedPreview
  uint32: DecodedPreview
  int32: DecodedPreview
  binary: DecodedPreview
}

export interface PortSnapshot {
  portNumber: number
  severity: PortSeverity
  pdi: PdiResponse | null
  error: string | null
}

export type DiagnosticReasonCode =
  | 'fault'
  | 'invalid_pdi'
  | 'stale_data'
  | 'event_code'
  | 'sentinel_value'
  | 'value_out_of_range'
  | 'drift'
  | 'spike'
  | 'flatline'
  | 'polling_error'
  | 'no_snapshot'

export interface PortDiagnosticReason {
  code: DiagnosticReasonCode
  level: DiagnosticLevel
  title: string
  detail: string
}

export type DiagnosticForecastDirection =
  | 'rising'
  | 'falling'
  | 'stable'
  | 'unknown'

export type DiagnosticSignalQualityLabel =
  | 'stable'
  | 'watch'
  | 'volatile'
  | 'degraded'

export interface PortDiagnosticCause {
  title: string
  detail: string
  weight: number
}

export interface PortDiagnosticEvidence {
  label: string
  detail: string
}

export interface PortDiagnosticForecast {
  horizonLabel: string
  direction: DiagnosticForecastDirection
  summary: string
  projectedValue: string | null
  worseningProbability: number
  expectedState: string
  stability: DiagnosticSignalQualityLabel
}

export interface PortDiagnosticSignalQuality {
  label: DiagnosticSignalQualityLabel
  score: number
  summary: string
}

export type AiLearningStatus = 'not_started' | 'learning' | 'trained' | 'insufficient_data'

export interface AiLearningModel {
  status: AiLearningStatus
  startedAtMs: number | null
  targetEndAtMs: number | null
  completedAtMs: number | null
  durationMs: number
  sampleCount: number
  baselineValue: number | null
  minimumValue: number | null
  maximumValue: number | null
  standardDeviation: number | null
  mad: number | null
  bandHalfWidth: number | null
  label: string
  unit: string
  message: string
}

export interface PortDiagnostic {
  portNumber: number
  level: DiagnosticLevel
  anomalyScore: number
  confidenceScore: number
  currentRiskScore: number
  projectedRiskScore: number
  summary: string
  currentInterpretation: string
  suggestedAction: string
  reasons: PortDiagnosticReason[]
  probableCauses: PortDiagnosticCause[]
  evidence: PortDiagnosticEvidence[]
  forecast: PortDiagnosticForecast
  signalQuality: PortDiagnosticSignalQuality
  learning: AiLearningModel
  liveValue: string | null
  liveNumericValue: number | null
  trendStatus: 'ready' | 'fallback' | 'unavailable'
  trendDelta: string | null
}
