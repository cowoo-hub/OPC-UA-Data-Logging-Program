import type {
  IoddIsduVariable,
  IsduOperationResponse,
  IsduRequestFrame,
} from '../api/types'

export type IsduWriteEncoding =
  | 'raw_hex'
  | 'utf8'
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'

export type IsduByteOrder = 'big' | 'little'
export type IsduReadDisplayType =
  | 'auto'
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'enum'
  | 'string'

type IsduResolvedDisplayType = Exclude<IsduReadDisplayType, 'auto'> | 'raw_hex'

export interface EncodedIsduWritePayload {
  dataHex: string
  byteCount: number
  summary: string
}

export interface ResolvedIsduDecodedValue {
  displayValue: string
  effectiveType: IsduResolvedDisplayType
  typeLabel: string
  secondaryValue: string | null
}

export function parseNumericInput(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return Number.parseInt(trimmed, 16)
  }

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10)
  }

  return null
}

function normalizeHexToken(token: string) {
  let normalized = token.trim()

  if (normalized.toLowerCase().startsWith('0x')) {
    normalized = normalized.slice(2)
  }

  if (!normalized) {
    throw new Error('Empty hex byte token')
  }

  if (normalized.length === 1) {
    normalized = `0${normalized}`
  }

  if (!/^[0-9a-f]{2}$/i.test(normalized)) {
    throw new Error(`Invalid hex byte '${token}'`)
  }

  return normalized.toUpperCase()
}

export function normalizeHexByteString(value: string) {
  const tokens = value
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) {
    throw new Error('Enter at least one byte for a write payload.')
  }

  return tokens.map(normalizeHexToken).join(' ')
}

function encodeIntegerToHex(
  value: number,
  {
    signed,
    byteLength,
    byteOrder,
  }: {
    signed: boolean
    byteLength: number
    byteOrder: IsduByteOrder
  },
) {
  if (!Number.isInteger(value)) {
    throw new Error('Numeric write payloads must be whole integers.')
  }

  const bits = byteLength * 8
  const min = signed ? -(2 ** (bits - 1)) : 0
  const max = signed ? (2 ** (bits - 1)) - 1 : (2 ** bits) - 1

  if (value < min || value > max) {
    throw new Error(`Value must be between ${min} and ${max}.`)
  }

  const bytes = new Uint8Array(byteLength)
  const view = new DataView(bytes.buffer)

  if (byteLength === 2) {
    if (signed) {
      view.setInt16(0, value, byteOrder === 'little')
    } else {
      view.setUint16(0, value, byteOrder === 'little')
    }
  } else {
    if (signed) {
      view.setInt32(0, value, byteOrder === 'little')
    } else {
      view.setUint32(0, value, byteOrder === 'little')
    }
  }

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

export function encodeIsduWritePayload(
  value: string,
  encoding: IsduWriteEncoding,
  byteOrder: IsduByteOrder,
): EncodedIsduWritePayload {
  if (encoding === 'raw_hex') {
    const dataHex = normalizeHexByteString(value)
    return {
      dataHex,
      byteCount: dataHex.split(' ').length,
      summary: `Raw hex | ${dataHex.split(' ').length} byte(s)`,
    }
  }

  if (encoding === 'utf8') {
    if (!value) {
      throw new Error('Enter text to encode for the write payload.')
    }

    const dataHex = Array.from(new TextEncoder().encode(value))
      .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(' ')

    return {
      dataHex,
      byteCount: dataHex ? dataHex.split(' ').length : 0,
      summary: `UTF-8 | ${dataHex ? dataHex.split(' ').length : 0} byte(s)`,
    }
  }

  const parsedNumericValue = parseNumericInput(value)
  if (parsedNumericValue === null) {
    throw new Error('Enter a decimal or 0x-prefixed hex integer for this write payload.')
  }

  const dataHex =
    encoding === 'uint16'
      ? encodeIntegerToHex(parsedNumericValue, {
          signed: false,
          byteLength: 2,
          byteOrder,
        })
      : encoding === 'int16'
        ? encodeIntegerToHex(parsedNumericValue, {
            signed: true,
            byteLength: 2,
            byteOrder,
          })
        : encoding === 'uint32'
          ? encodeIntegerToHex(parsedNumericValue, {
              signed: false,
              byteLength: 4,
              byteOrder,
            })
          : encodeIntegerToHex(parsedNumericValue, {
              signed: true,
              byteLength: 4,
              byteOrder,
            })

  return {
    dataHex,
    byteCount: dataHex.split(' ').length,
    summary: `${encoding.toUpperCase()} ${byteOrder} | ${dataHex.split(' ').length} byte(s)`,
  }
}

function getDisplayTypeLabel(value: IsduResolvedDisplayType) {
  switch (value) {
    case 'uint16':
      return 'UINT16'
    case 'int16':
      return 'INT16'
    case 'uint32':
      return 'UINT32'
    case 'int32':
      return 'INT32'
    case 'enum':
      return 'ENUM'
    case 'string':
      return 'STRING'
    default:
      return 'HEX'
  }
}

function mapWriteEncodingToResolvedType(
  value: IsduWriteEncoding | null | undefined,
): IsduResolvedDisplayType {
  switch (value) {
    case 'utf8':
      return 'string'
    case 'uint16':
      return 'uint16'
    case 'int16':
      return 'int16'
    case 'uint32':
      return 'uint32'
    case 'int32':
      return 'int32'
    default:
      return 'raw_hex'
  }
}

function normalizeIoddDataType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function inferDisplayTypeFromVariable(
  variable: IoddIsduVariable | null | undefined,
): Exclude<IsduReadDisplayType, 'auto'> | null {
  if (!variable) {
    return null
  }

  const normalizedType = normalizeIoddDataType(variable.dataType)
  const bitLength = variable.bitLength ?? null
  const hasEnumMappings = variable.enumMappings.length > 0

  if (hasEnumMappings || normalizedType.includes('enum')) {
    return 'enum'
  }

  if (
    normalizedType.includes('string') ||
    normalizedType.includes('text') ||
    normalizedType.includes('char') ||
    normalizedType.includes('octet') ||
    normalizedType.includes('visible')
  ) {
    return 'string'
  }

  const looksSigned =
    normalizedType.includes('signed') ||
    (normalizedType.includes('int') &&
      !normalizedType.includes('uint') &&
      !normalizedType.includes('unsigned'))

  if (looksSigned) {
    return bitLength !== null && bitLength > 16 ? 'int32' : 'int16'
  }

  if (
    normalizedType.includes('uint') ||
    normalizedType.includes('unsigned') ||
    normalizedType.includes('integer') ||
    normalizedType.includes('number')
  ) {
    return bitLength !== null && bitLength > 16 ? 'uint32' : 'uint16'
  }

  if (bitLength !== null) {
    return bitLength > 16 ? 'uint32' : 'uint16'
  }

  return null
}

export function getSuggestedIsduReadDisplayType(
  matchedVariable: IoddIsduVariable | null | undefined,
): Exclude<IsduReadDisplayType, 'auto'> {
  return inferDisplayTypeFromVariable(matchedVariable) ?? 'uint16'
}

export function getIsduReadDisplayTypeLabel(
  value: IsduReadDisplayType | IsduResolvedDisplayType,
) {
  if (value === 'auto') {
    return 'Auto'
  }

  return getDisplayTypeLabel(value)
}

function pickNumericPreviewValue(
  preview: IsduOperationResponse['preview'],
  displayType: 'uint16' | 'int16' | 'uint32' | 'int32',
) {
  if (!preview) {
    return null
  }

  switch (displayType) {
    case 'uint16':
      return preview.uint16_be
    case 'int16':
      return preview.int16_be
    case 'uint32':
      return preview.uint32_be
    case 'int32':
      return preview.int32_be
  }
}

function inferDisplayTypeFromPreview(
  preview: IsduOperationResponse['preview'],
): Exclude<IsduReadDisplayType, 'auto'> {
  if (!preview) {
    return 'uint16'
  }

  if (preview.byte_count >= 4) {
    return 'uint32'
  }

  if (preview.byte_count >= 2) {
    return 'uint16'
  }

  if (preview.utf8 || preview.ascii) {
    return 'string'
  }

  return 'uint16'
}

function resolveDisplayType({
  result,
  readDisplayType,
  matchedVariable,
  writeEncoding,
}: {
  result: IsduOperationResponse
  readDisplayType: IsduReadDisplayType
  matchedVariable: IoddIsduVariable | null | undefined
  writeEncoding: IsduWriteEncoding | null | undefined
}): IsduResolvedDisplayType {
  if (result.request.operation === 'write') {
    return mapWriteEncodingToResolvedType(writeEncoding)
  }

  if (readDisplayType !== 'auto') {
    return readDisplayType
  }

  return (
    inferDisplayTypeFromVariable(matchedVariable) ??
    inferDisplayTypeFromPreview(result.preview)
  )
}

function getFallbackIsduDisplayValue(result: IsduOperationResponse | null) {
  if (!result) {
    return '--'
  }

  return (
    result.preview?.hex ??
    result.response.data_hex ??
    result.request.data_hex ??
    result.response.status
  )
}

export function resolveIsduDecodedValue({
  result,
  readDisplayType,
  matchedVariable,
  writeEncoding,
}: {
  result: IsduOperationResponse | null
  readDisplayType: IsduReadDisplayType
  matchedVariable?: IoddIsduVariable | null
  writeEncoding?: IsduWriteEncoding | null
}): ResolvedIsduDecodedValue {
  if (!result) {
    return {
      displayValue: '--',
      effectiveType: 'raw_hex',
      typeLabel: getDisplayTypeLabel('raw_hex'),
      secondaryValue: null,
    }
  }

  const effectiveType = resolveDisplayType({
    result,
    readDisplayType,
    matchedVariable,
    writeEncoding,
  })

  if (effectiveType === 'string') {
    const displayValue =
      result.preview?.utf8 ?? result.preview?.ascii ?? getFallbackIsduDisplayValue(result)

    return {
      displayValue,
      effectiveType,
      typeLabel: getDisplayTypeLabel(effectiveType),
      secondaryValue: result.preview?.hex ?? result.response.data_hex ?? result.request.data_hex,
    }
  }

  if (effectiveType === 'enum') {
    const numericType =
      matchedVariable?.bitLength !== null &&
      matchedVariable?.bitLength !== undefined &&
      matchedVariable.bitLength > 16
        ? 'uint32'
        : result.preview && result.preview.byte_count >= 4
          ? 'uint32'
          : 'uint16'

    const numericValue = pickNumericPreviewValue(result.preview, numericType)
    const mappedValue =
      numericValue !== null && matchedVariable
        ? matchedVariable.enumMappings.find((entry) => entry.value === numericValue)?.label ?? null
        : null

    return {
      displayValue:
        mappedValue ??
        (numericValue !== null ? String(numericValue) : getFallbackIsduDisplayValue(result)),
      effectiveType,
      typeLabel: getDisplayTypeLabel(effectiveType),
      secondaryValue: numericValue !== null ? String(numericValue) : null,
    }
  }

  if (effectiveType === 'raw_hex') {
    return {
      displayValue: getFallbackIsduDisplayValue(result),
      effectiveType,
      typeLabel: getDisplayTypeLabel(effectiveType),
      secondaryValue: null,
    }
  }

  const numericValue = pickNumericPreviewValue(result.preview, effectiveType)

  return {
    displayValue:
      numericValue !== null ? String(numericValue) : getFallbackIsduDisplayValue(result),
    effectiveType,
    typeLabel: getDisplayTypeLabel(effectiveType),
    secondaryValue: null,
  }
}

export function getPrimaryIsduValue(result: IsduOperationResponse | null) {
  return resolveIsduDecodedValue({
    result,
    readDisplayType: 'auto',
  }).displayValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function annotateIsduProtocolPayload(
  value: unknown,
  frame: Pick<IsduRequestFrame, 'port' | 'device_port'>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => annotateIsduProtocolPayload(entry, frame))
  }

  if (!isRecord(value)) {
    return value
  }

  const annotated: Record<string, unknown> = {}

  for (const [key, entryValue] of Object.entries(value)) {
    if (key === 'port' && typeof entryValue === 'number') {
      annotated.user_port = frame.port
      annotated.device_port_index_zero_based = entryValue
      continue
    }

    annotated[key] = annotateIsduProtocolPayload(entryValue, frame)
  }

  return annotated
}

export function formatIsduUserPort(port: number) {
  return `Port ${port}`
}

export function formatIsduDevicePortDebug(devicePort: number) {
  return `Internal device index ${devicePort} (zero-based)`
}

export function formatIsduRequestFramePreview(
  frame: Pick<
    IsduRequestFrame,
    'operation' | 'port' | 'device_port' | 'index' | 'subindex' | 'data_hex' | 'payload'
  >,
) {
  return JSON.stringify(
    {
      operation: frame.operation,
      user_port: frame.port,
      device_port_index_zero_based: frame.device_port,
      index: frame.index,
      subindex: frame.subindex,
      data_hex: frame.data_hex,
      payload: annotateIsduProtocolPayload(frame.payload, frame),
    },
    null,
    2,
  )
}

export function formatIsduRawResponsePreview(
  result: Pick<IsduOperationResponse, 'request' | 'response'>,
) {
  const annotatedPayload = annotateIsduProtocolPayload(
    result.response.raw_json,
    result.request,
  )

  if (annotatedPayload === result.response.raw_json) {
    return result.response.raw_json_pretty
  }

  return JSON.stringify(annotatedPayload, null, 2)
}

export function formatIsduTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return '--'
  }

  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.valueOf())) {
    return timestamp
  }

  return parsed.toLocaleTimeString()
}
