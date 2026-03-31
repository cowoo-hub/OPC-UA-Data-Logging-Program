export type DecodeType =
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'float32'
  | 'binary'

export type WordOrder = 'big' | 'little'
export type ByteOrder = 'big' | 'little'
export type PortSeverity = 'normal' | 'warning' | 'critical'

export interface ConnectionInfo {
  host: string
  port: number
  slave_id: number
  timeout: number
  retries: number
}

export interface HealthResponse {
  status: string
  phase: string
  backend_mode: string
}

export interface ConnectionStatusResponse {
  configured: boolean
  connection: ConnectionInfo | null
}

export interface ConnectRequest {
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

export interface ConnectionDraft {
  host: string
  port: string
  slaveId: string
}

export interface DecodedPreview {
  displayValue: string
  rawValue: number | string | null
  sourceRegisters: number[]
  error: string | null
}

export interface PortDecodeCollection {
  featured: DecodedPreview
  float32: DecodedPreview
  uint32: DecodedPreview
  int32: DecodedPreview
  binary: DecodedPreview
}

export interface PortSnapshot {
  portNumber: number
  severity: PortSeverity
  pdi: PdiResponse | null
  decodes: PortDecodeCollection | null
  error: string | null
}
