import type {
  ConvertRequest,
  DecodeSettings,
  DecodeType,
  DecodedPreview,
  PortDecodeCollection,
  PortDisplayConfig,
  ResolutionFactor,
  StatusBitState,
} from '../api/types'

const OVERVIEW_DECODE_TYPES: DecodeType[] = [
  'uint16',
  'int16',
  'float32',
  'uint32',
  'int32',
  'binary',
]

type ResolvedDecodeSettings = Pick<
  PortDisplayConfig,
  | 'preferredDecodeType'
  | 'wordOrder'
  | 'byteOrder'
  | 'sourceWordCount'
  | 'fieldMode'
  | 'bitOffset'
  | 'bitLength'
  | 'signed'
  | 'sentinelMappings'
  | 'statusBits'
>

function getRegistersNeeded(dataType: DecodeType): number {
  if (dataType === 'uint32' || dataType === 'int32' || dataType === 'float32') {
    return 2
  }

  if (dataType === 'binary') {
    return 2
  }

  return 1
}

function swapRegisterBytes(registerValue: number) {
  return ((registerValue & 0xff) << 8) | ((registerValue >> 8) & 0xff)
}

function normalizeRegisters(registers: number[]) {
  return registers.map((registerValue) => {
    if (!Number.isInteger(registerValue) || registerValue < 0 || registerValue > 0xffff) {
      throw new Error(`Register value out of range: ${registerValue}`)
    }

    return registerValue
  })
}

function groupBinaryValue(binaryValue: string) {
  return binaryValue.match(/.{1,8}/g)?.join(' ') ?? binaryValue
}

function buildStatusBitStates(
  aggregateValue: bigint,
  settings: ResolvedDecodeSettings,
): StatusBitState[] {
  return settings.statusBits.map((statusBit) => ({
    ...statusBit,
    active: ((aggregateValue >> BigInt(statusBit.bit)) & 1n) === 1n,
  }))
}

function applySignedInterpretation(value: bigint, bitLength: number, signed: boolean) {
  if (!signed || bitLength <= 0) {
    return Number(value)
  }

  const signMask = 1n << BigInt(bitLength - 1)
  const fullRange = 1n << BigInt(bitLength)

  return Number((value & signMask) !== 0n ? value - fullRange : value)
}

function normalizeScaledNumber(value: number) {
  return Number.parseFloat(value.toPrecision(12))
}

function normalizeComparableNumericValue(value: number) {
  return Number.parseFloat(value.toPrecision(12))
}

function formatNumericValue(value: number) {
  if (Number.isInteger(value)) {
    return value.toLocaleString()
  }

  return value.toFixed(3).replace(/\.?0+$/, '')
}

function resolveMappedTextLabel(
  value: number,
  mappings: ResolvedDecodeSettings['sentinelMappings'],
) {
  const normalizedValue = normalizeComparableNumericValue(value)
  const matchedMapping = mappings.find((mapping) => {
    if (!Number.isFinite(mapping.value)) {
      return false
    }

    const normalizedMappingValue = normalizeComparableNumericValue(mapping.value)

    if (Number.isInteger(normalizedValue) && Number.isInteger(normalizedMappingValue)) {
      return normalizedMappingValue === normalizedValue
    }

    const tolerance = Math.max(1e-9, Math.abs(normalizedValue) * 1e-9)
    return Math.abs(normalizedMappingValue - normalizedValue) <= tolerance
  })

  return matchedMapping?.label ?? null
}

function getOrderedRegistersFromSettings(
  registers: number[],
  settings: Pick<ResolvedDecodeSettings, 'wordOrder' | 'byteOrder'>,
) {
  const byteOrderedRegisters = registers.map((word) =>
    settings.byteOrder === 'little' ? swapRegisterBytes(word) : word,
  )

  return settings.wordOrder === 'little'
    ? [...byteOrderedRegisters].reverse()
    : byteOrderedRegisters
}

function registersToBytes(
  registers: number[],
  settings: Pick<ResolvedDecodeSettings, 'wordOrder' | 'byteOrder'>,
) {
  const orderedRegisters = getOrderedRegistersFromSettings(registers, settings)
  const bytes = new Uint8Array(orderedRegisters.length * 2)

  orderedRegisters.forEach((word, index) => {
    bytes[index * 2] = (word >> 8) & 0xff
    bytes[index * 2 + 1] = word & 0xff
  })

  return bytes
}

function getSourceRegisterCount(settings: ResolvedDecodeSettings, dataType: DecodeType) {
  return settings.fieldMode === 'bit_field'
    ? settings.sourceWordCount
    : getRegistersNeeded(dataType)
}

export function formatDecodedValue(value: number | string, dataType: DecodeType): string {
  if (typeof value === 'string') {
    return dataType === 'binary' ? groupBinaryValue(value) : value
  }

  return formatNumericValue(value)
}

export function buildUnavailablePreview(message = 'Decode unavailable'): DecodedPreview {
  return {
    displayValue: 'Unavailable',
    rawValue: null,
    scaledValue: null,
    mappingComparisonValue: null,
    rawDisplayValue: null,
    sourceRegisters: [],
    error: message,
    sentinelLabel: null,
    statusBits: [],
  }
}

export function prepareRegistersForDecodeRequest(
  registers: number[],
  settings: DecodeSettings,
  dataType: DecodeType,
): {
  request: ConvertRequest
  sourceRegisters: number[]
  cacheKey: string
} {
  const registerCount = getRegistersNeeded(dataType)
  const normalized = normalizeRegisters(registers).slice(0, registerCount)

  if (normalized.length < registerCount) {
    throw new Error(`${dataType} conversion needs ${registerCount} register(s)`)
  }

  const sourceRegisters = normalized.map((word) =>
    settings.byteOrder === 'little' ? swapRegisterBytes(word) : word,
  )

  const request: ConvertRequest = {
    registers: sourceRegisters,
    data_type: dataType,
    word_order: settings.wordOrder,
  }

  if (dataType === 'binary') {
    request.word_length = sourceRegisters.length
  }

  return {
    request,
    sourceRegisters,
    cacheKey: JSON.stringify({
      mode: 'full_word',
      dataType,
      wordOrder: settings.wordOrder,
      byteOrder: settings.byteOrder,
      registers: sourceRegisters,
      wordLength: request.word_length ?? null,
    }),
  }
}

export function buildPreviewFromConvertedValue(
  dataType: DecodeType,
  sourceRegisters: number[],
  convertedValue: number | string,
): DecodedPreview {
  const rawDisplayValue = formatDecodedValue(convertedValue, dataType)

  return {
    displayValue: rawDisplayValue,
    rawValue: convertedValue,
    scaledValue: convertedValue,
    mappingComparisonValue:
      typeof convertedValue === 'number' && Number.isFinite(convertedValue)
        ? normalizeComparableNumericValue(convertedValue)
        : null,
    rawDisplayValue,
    sourceRegisters,
    error: null,
    sentinelLabel: null,
    statusBits: [],
  }
}

function buildBitFieldPreview(
  registers: number[],
  settings: ResolvedDecodeSettings,
  dataType: DecodeType,
): DecodedPreview {
  const registerCount = getSourceRegisterCount(settings, dataType)
  const normalized = normalizeRegisters(registers).slice(0, registerCount)

  if (normalized.length < registerCount) {
    throw new Error(`Bit-field decode needs ${registerCount} register(s)`)
  }

  const sourceRegisters = getOrderedRegistersFromSettings(normalized, settings)
  const aggregateValue = sourceRegisters.reduce(
    (accumulator, registerValue) => (accumulator << 16n) | BigInt(registerValue),
    0n,
  )
  const totalBitLength = sourceRegisters.length * 16

  if (settings.bitOffset < 0 || settings.bitOffset >= totalBitLength) {
    throw new Error('Bit offset is outside the available source register range')
  }

  if (settings.bitLength < 1 || settings.bitOffset + settings.bitLength > totalBitLength) {
    throw new Error('Bit length exceeds the available source register range')
  }

  const fieldMask = (1n << BigInt(settings.bitLength)) - 1n
  const fieldValue = (aggregateValue >> BigInt(settings.bitOffset)) & fieldMask
  const interpretedValue = applySignedInterpretation(
    fieldValue,
    settings.bitLength,
    settings.signed,
  )
  const statusBits = buildStatusBitStates(aggregateValue, settings)

  if (dataType === 'binary') {
    const binaryValue = fieldValue.toString(2).padStart(settings.bitLength, '0')

    return {
      displayValue: formatDecodedValue(binaryValue, dataType),
      rawValue: binaryValue,
      scaledValue: binaryValue,
      mappingComparisonValue: null,
      rawDisplayValue: binaryValue,
      sourceRegisters,
      error: null,
      sentinelLabel: null,
      statusBits,
    }
  }

  const rawDisplayValue = formatNumericValue(interpretedValue)

  return {
    displayValue: formatDecodedValue(interpretedValue, dataType),
    rawValue: interpretedValue,
    scaledValue: interpretedValue,
    mappingComparisonValue: normalizeComparableNumericValue(interpretedValue),
    rawDisplayValue,
    sourceRegisters,
    error: null,
    sentinelLabel: null,
    statusBits,
  }
}

export function buildDecodePreviewCacheKey(
  registers: number[],
  settings: ResolvedDecodeSettings,
  dataType: DecodeType,
) {
  if (settings.fieldMode === 'bit_field') {
    return JSON.stringify({
      mode: 'bit_field',
      dataType,
      registers: normalizeRegisters(registers).slice(0, settings.sourceWordCount),
      wordOrder: settings.wordOrder,
      byteOrder: settings.byteOrder,
      sourceWordCount: settings.sourceWordCount,
      bitOffset: settings.bitOffset,
      bitLength: settings.bitLength,
      signed: settings.signed,
      statusBits: settings.statusBits,
    })
  }

  const prepared = prepareRegistersForDecodeRequest(registers, {
    dataType,
    wordOrder: settings.wordOrder,
    byteOrder: settings.byteOrder,
  }, dataType)

  return prepared.cacheKey
}

export function applyResolutionToPreview(
  preview: DecodedPreview,
  dataType: DecodeType,
  resolutionFactor: ResolutionFactor,
  mappings: ResolvedDecodeSettings['sentinelMappings'] = [],
): DecodedPreview {
  if (preview.error || preview.rawValue === null) {
    return preview
  }

  const rawDisplayValue =
    preview.rawDisplayValue ?? formatDecodedValue(preview.rawValue, dataType)

  if (preview.sentinelLabel) {
    return {
      ...preview,
      rawDisplayValue,
      scaledValue: preview.sentinelLabel,
      displayValue: preview.sentinelLabel,
    }
  }

  if (typeof preview.rawValue !== 'number') {
    return {
      ...preview,
      rawDisplayValue,
      scaledValue: preview.rawValue,
      mappingComparisonValue: null,
      displayValue: rawDisplayValue,
      sentinelLabel: null,
    }
  }

  const scaledValue = normalizeScaledNumber(preview.rawValue * resolutionFactor)
  const mappingComparisonValue = normalizeComparableNumericValue(scaledValue)
  const mappedTextLabel = resolveMappedTextLabel(mappingComparisonValue, mappings)

  return {
    ...preview,
    rawDisplayValue,
    scaledValue,
    mappingComparisonValue,
    displayValue: mappedTextLabel ?? formatDecodedValue(scaledValue, dataType),
    sentinelLabel: mappedTextLabel,
  }
}

export function decodeRegistersPreview(
  registers: number[],
  settings: ResolvedDecodeSettings,
  dataType: DecodeType,
): DecodedPreview {
  try {
    if (settings.fieldMode === 'bit_field') {
      return buildBitFieldPreview(registers, settings, dataType)
    }

    const registerCount = getSourceRegisterCount(settings, dataType)
    const sourceRegisters = normalizeRegisters(registers).slice(0, registerCount)

    if (sourceRegisters.length < registerCount) {
      throw new Error(`${dataType} conversion needs ${registerCount} register(s)`)
    }

    if (dataType === 'binary') {
      const binaryValue = Array.from(registersToBytes(sourceRegisters, settings))
        .map((byteValue) => byteValue.toString(2).padStart(8, '0'))
        .join('')

      return {
        ...buildPreviewFromConvertedValue(dataType, sourceRegisters, binaryValue),
        statusBits: buildStatusBitStates(
          getOrderedRegistersFromSettings(sourceRegisters, settings).reduce(
            (accumulator, registerValue) => (accumulator << 16n) | BigInt(registerValue),
            0n,
          ),
          settings,
        ),
      }
    }

    const bytes = registersToBytes(sourceRegisters, settings)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let value: number

    switch (dataType) {
      case 'uint16':
        value = view.getUint16(0, false)
        break
      case 'int16':
        value = view.getInt16(0, false)
        break
      case 'uint32':
        value = view.getUint32(0, false)
        break
      case 'int32':
        value = view.getInt32(0, false)
        break
      case 'float32':
        value = view.getFloat32(0, false)
        break
      default:
        throw new Error(`Unsupported decode type: ${dataType}`)
    }

    return {
      ...buildPreviewFromConvertedValue(
        dataType,
        sourceRegisters,
        value,
      ),
      statusBits: buildStatusBitStates(
        getOrderedRegistersFromSettings(sourceRegisters, settings).reduce(
          (accumulator, registerValue) => (accumulator << 16n) | BigInt(registerValue),
          0n,
        ),
        settings,
      ),
    }
  } catch (error) {
    return buildUnavailablePreview(
      error instanceof Error ? error.message : 'Decode unavailable',
    )
  }
}

export function buildPortDecodeCollection(
  featuredType: DecodeType,
  previews: Partial<Record<DecodeType, DecodedPreview>>,
): PortDecodeCollection {
  return {
    featured: previews[featuredType] ?? buildUnavailablePreview(),
    uint16: previews.uint16 ?? buildUnavailablePreview(),
    int16: previews.int16 ?? buildUnavailablePreview(),
    float32: previews.float32 ?? buildUnavailablePreview(),
    uint32: previews.uint32 ?? buildUnavailablePreview(),
    int32: previews.int32 ?? buildUnavailablePreview(),
    binary: previews.binary ?? buildUnavailablePreview(),
  }
}

export function getOverviewDecodeTypes(featuredType: DecodeType): DecodeType[] {
  return Array.from(new Set([featuredType, ...OVERVIEW_DECODE_TYPES]))
}
