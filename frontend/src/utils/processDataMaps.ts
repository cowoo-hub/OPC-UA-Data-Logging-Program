import type {
  ByteOrder,
  DecodedPreview,
  ParsedProcessDataField,
  ParsedProcessDataProfile,
  ProcessDataDeviceHint,
  ProcessDataEnumMapping,
  ProcessDataProfileDefinition,
  ProcessDataProfileId,
  ProcessDataProfileMode,
  ProcessDataProfileSummary,
  ProcessDataResolutionSource,
  StatusBitState,
  WordOrder,
} from '../api/types'

interface ProcessDataParseOptions {
  registers: number[]
  profile: ProcessDataProfileDefinition
  wordOrder: WordOrder
  byteOrder: ByteOrder
  resolutionSource: ProcessDataResolutionSource
}

interface ResolvedProcessDataProfile {
  profile: ProcessDataProfileDefinition | null
  source: ProcessDataResolutionSource
}

const PROCESS_DATA_PROFILE_DEFINITIONS: Record<
  ProcessDataProfileId,
  ProcessDataProfileDefinition
> = {
  omt550_distance_record: {
    id: 'omt550_distance_record',
    name: 'OMT550 Distance Record',
    description:
      'Structured 16-bit process record with two switching outputs and one 14-bit distance field.',
    deviceKey: 'OMT550',
    vendorId: null,
    deviceId: null,
    totalBitLength: 16,
    sourceWordCount: 1,
    primaryFieldName: 'distance',
    fields: [
      {
        name: 'switching_signal_1',
        label: 'Switching signal 1',
        bitOffset: 0,
        bitLength: 1,
        type: 'bool',
        role: 'status',
        description: 'Discrete switching channel 1.',
      },
      {
        name: 'switching_signal_2',
        label: 'Switching signal 2',
        bitOffset: 1,
        bitLength: 1,
        type: 'bool',
        role: 'status',
        description: 'Discrete switching channel 2.',
      },
      {
        name: 'distance',
        label: 'Distance',
        bitOffset: 2,
        bitLength: 14,
        type: 'uint',
        role: 'primary_value',
        unit: 'mm',
        description: 'Primary 14-bit measured distance value.',
        enumMappings: [{ value: 16383, label: 'No Echo' }],
      },
    ],
  },
}

let runtimeProcessDataProfileDefinitions: Record<
  ProcessDataProfileId,
  ProcessDataProfileDefinition
> = {}

function getMergedProcessDataProfileDefinitions() {
  return {
    ...PROCESS_DATA_PROFILE_DEFINITIONS,
    ...runtimeProcessDataProfileDefinitions,
  }
}

export function setRuntimeProcessDataProfiles(
  profiles: ProcessDataProfileDefinition[],
) {
  runtimeProcessDataProfileDefinitions = profiles.reduce<
    Record<ProcessDataProfileId, ProcessDataProfileDefinition>
  >((accumulator, profile) => {
    accumulator[profile.id] = profile
    return accumulator
  }, {})
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

function getOrderedRegisters(
  registers: number[],
  {
    wordOrder,
    byteOrder,
  }: {
    wordOrder: WordOrder
    byteOrder: ByteOrder
  },
) {
  const byteOrderedRegisters = normalizeRegisters(registers).map((registerValue) =>
    byteOrder === 'little' ? swapRegisterBytes(registerValue) : registerValue,
  )

  return wordOrder === 'little'
    ? [...byteOrderedRegisters].reverse()
    : byteOrderedRegisters
}

function registersToBytes(
  registers: number[],
  {
    wordOrder,
    byteOrder,
  }: {
    wordOrder: WordOrder
    byteOrder: ByteOrder
  },
) {
  const orderedRegisters = getOrderedRegisters(registers, { wordOrder, byteOrder })
  const bytes = new Uint8Array(orderedRegisters.length * 2)

  orderedRegisters.forEach((registerValue, index) => {
    bytes[index * 2] = (registerValue >> 8) & 0xff
    bytes[index * 2 + 1] = registerValue & 0xff
  })

  return bytes
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

function formatFieldBitRange(bitOffset: number, bitLength: number) {
  return bitLength <= 1
    ? `bit ${bitOffset}`
    : `bits ${bitOffset}-${bitOffset + bitLength - 1}`
}

function groupBinaryValue(binaryValue: string) {
  return binaryValue.match(/.{1,8}/g)?.join(' ') ?? binaryValue
}

function applySignedInterpretation(value: bigint, bitLength: number, signed: boolean) {
  if (!signed || bitLength <= 0) {
    return Number(value)
  }

  const signMask = 1n << BigInt(bitLength - 1)
  const fullRange = 1n << BigInt(bitLength)

  return Number((value & signMask) !== 0n ? value - fullRange : value)
}

function matchEnumLabel(value: number, mappings: ProcessDataEnumMapping[] | undefined) {
  if (!mappings || mappings.length === 0 || !Number.isFinite(value)) {
    return null
  }

  const normalizedValue = normalizeComparableNumericValue(value)

  const matchedMapping = mappings.find((mapping) => {
    const normalizedMappingValue = normalizeComparableNumericValue(mapping.value)

    if (Number.isInteger(normalizedValue) && Number.isInteger(normalizedMappingValue)) {
      return normalizedValue === normalizedMappingValue
    }

    const tolerance = Math.max(1e-9, Math.abs(normalizedValue) * 1e-9)
    return Math.abs(normalizedValue - normalizedMappingValue) <= tolerance
  })

  return matchedMapping?.label ?? null
}

function buildEmptyProcessDataResult(
  profile: ProcessDataProfileDefinition,
  resolutionSource: ProcessDataResolutionSource,
  error: string,
): ParsedProcessDataProfile {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    deviceKey: profile.deviceKey ?? null,
    vendorId: profile.vendorId ?? null,
    deviceId: profile.deviceId ?? null,
    totalBitLength: profile.totalBitLength,
    sourceWordCount: profile.sourceWordCount,
    resolutionSource,
    sourceRegisters: [],
    rawHex: '',
    primaryField: null,
    fields: [],
    statusFields: [],
    qualityFields: [],
    error,
  }
}

function parseFieldValue(
  aggregateValue: bigint,
  field: ProcessDataProfileDefinition['fields'][number],
): ParsedProcessDataField {
  const fieldMask = (1n << BigInt(field.bitLength)) - 1n
  const extractedValue = (aggregateValue >> BigInt(field.bitOffset)) & fieldMask
  const bitRangeLabel = formatFieldBitRange(field.bitOffset, field.bitLength)
  const role = field.role ?? null
  const description = field.description ?? null

  if (field.type === 'bool') {
    const active = extractedValue === 1n

    return {
      name: field.name,
      label: field.label,
      type: field.type,
      role,
      bitOffset: field.bitOffset,
      bitLength: field.bitLength,
      bitRangeLabel,
      rawValue: active,
      rawDisplayValue: active ? '1' : '0',
      scaledValue: active,
      displayValue: active ? 'ON' : 'OFF',
      unit: field.unit ?? null,
      description,
      active,
      isMapped: false,
    }
  }

  if (field.type === 'binary') {
    const binaryValue = extractedValue.toString(2).padStart(field.bitLength, '0')

    return {
      name: field.name,
      label: field.label,
      type: field.type,
      role,
      bitOffset: field.bitOffset,
      bitLength: field.bitLength,
      bitRangeLabel,
      rawValue: binaryValue,
      rawDisplayValue: binaryValue,
      scaledValue: binaryValue,
      displayValue: groupBinaryValue(binaryValue),
      unit: field.unit ?? null,
      description,
      active: null,
      isMapped: false,
    }
  }

  let rawNumericValue: number

  if (field.type === 'float32') {
    const buffer = new ArrayBuffer(4)
    const view = new DataView(buffer)

    view.setUint32(0, Number(extractedValue & 0xffffffffn), false)
    rawNumericValue = view.getFloat32(0, false)
  } else {
    rawNumericValue =
      field.type === 'int'
        ? applySignedInterpretation(extractedValue, field.bitLength, true)
        : applySignedInterpretation(extractedValue, field.bitLength, field.signed ?? false)
  }

  const mappedLabel = matchEnumLabel(rawNumericValue, field.enumMappings)
  const scaledNumericValue =
    mappedLabel === null && typeof field.scaleFactor === 'number'
      ? normalizeComparableNumericValue(rawNumericValue * field.scaleFactor)
      : rawNumericValue
  const displayValue =
    mappedLabel ?? formatNumericValue(Number(scaledNumericValue))

  return {
    name: field.name,
    label: field.label,
    type: field.type,
    role,
    bitOffset: field.bitOffset,
    bitLength: field.bitLength,
    bitRangeLabel,
    rawValue: rawNumericValue,
    rawDisplayValue: formatNumericValue(rawNumericValue),
    scaledValue: scaledNumericValue,
    displayValue,
    unit: field.unit ?? null,
    description,
    active: null,
    isMapped: mappedLabel !== null,
  }
}

function buildStatusBitsFromFields(fields: ParsedProcessDataField[]): StatusBitState[] {
  return fields.flatMap((field) => {
    if (field.role !== 'status' || field.active === null) {
      return []
    }

    return [
      {
        bit: field.bitOffset,
        label: field.label,
        active: field.active,
      },
    ]
  })
}

export function getProcessDataProfileOptions(): ProcessDataProfileSummary[] {
  return Object.values(getMergedProcessDataProfileDefinitions()).map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    deviceKey: profile.deviceKey ?? null,
    vendorId: profile.vendorId ?? null,
    deviceId: profile.deviceId ?? null,
    totalBitLength: profile.totalBitLength,
    sourceWordCount: profile.sourceWordCount,
  }))
}

export function getProcessDataProfile(
  profileId: ProcessDataProfileId | null | undefined,
): ProcessDataProfileDefinition | null {
  if (!profileId) {
    return null
  }

  return getMergedProcessDataProfileDefinitions()[profileId] ?? null
}

export function resolveProcessDataProfile({
  mode,
  requestedProfileId,
  deviceKey,
  vendorId,
  deviceId,
}: {
  mode: ProcessDataProfileMode
  requestedProfileId: ProcessDataProfileId | null
} & ProcessDataDeviceHint): ResolvedProcessDataProfile {
  if (mode === 'manual') {
    return {
      profile: null,
      source: 'manual_disabled',
    }
  }

  if (mode === 'profile') {
    return {
      profile: getProcessDataProfile(requestedProfileId),
      source: requestedProfileId ? 'manual_selection' : 'unresolved',
    }
  }

  const profiles = Object.values(getMergedProcessDataProfileDefinitions())

  if (vendorId !== null && vendorId !== undefined && deviceId !== null && deviceId !== undefined) {
    const matchedProfile = profiles.find(
      (profile) => profile.vendorId === vendorId && profile.deviceId === deviceId,
    )

    if (matchedProfile) {
      return {
        profile: matchedProfile,
        source: 'device_identity',
      }
    }
  }

  if (deviceKey) {
    const normalizedDeviceKey = deviceKey.trim().toLowerCase()
    const matchedProfile = profiles.find(
      (profile) => profile.deviceKey?.trim().toLowerCase() === normalizedDeviceKey,
    )

    if (matchedProfile) {
      return {
        profile: matchedProfile,
        source: 'device_key',
      }
    }
  }

  return {
    profile: null,
    source: 'unresolved',
  }
}

export function parseProcessDataPayload({
  registers,
  profile,
  wordOrder,
  byteOrder,
  resolutionSource,
}: ProcessDataParseOptions): ParsedProcessDataProfile {
  try {
    const sourceRegisters = getOrderedRegisters(
      registers.slice(0, profile.sourceWordCount),
      {
        wordOrder,
        byteOrder,
      },
    )

    if (sourceRegisters.length < profile.sourceWordCount) {
      return buildEmptyProcessDataResult(
        profile,
        resolutionSource,
        `Profile needs ${profile.sourceWordCount} source word(s).`,
      )
    }

    const aggregateValue = sourceRegisters.reduce(
      (accumulator, registerValue) => (accumulator << 16n) | BigInt(registerValue),
      0n,
    )

    if (profile.totalBitLength > sourceRegisters.length * 16) {
      return buildEmptyProcessDataResult(
        profile,
        resolutionSource,
        'Profile bit length exceeds the available source register window.',
      )
    }

    const fields = profile.fields.map((field) => parseFieldValue(aggregateValue, field))
    const primaryField =
      (profile.primaryFieldName
        ? fields.find((field) => field.name === profile.primaryFieldName)
        : null) ??
      fields.find((field) => field.role === 'primary_value') ??
      null

    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      deviceKey: profile.deviceKey ?? null,
      vendorId: profile.vendorId ?? null,
      deviceId: profile.deviceId ?? null,
      totalBitLength: profile.totalBitLength,
      sourceWordCount: profile.sourceWordCount,
      resolutionSource,
      sourceRegisters,
      rawHex: Array.from(registersToBytes(sourceRegisters, { wordOrder: 'big', byteOrder: 'big' }))
        .map((byteValue) => byteValue.toString(16).padStart(2, '0').toUpperCase())
        .join(' '),
      primaryField,
      fields,
      statusFields: fields.filter((field) => field.role === 'status'),
      qualityFields: fields.filter((field) => field.role === 'quality'),
      error: null,
    }
  } catch (error) {
    return buildEmptyProcessDataResult(
      profile,
      resolutionSource,
      error instanceof Error ? error.message : 'Structured process-data parsing failed.',
    )
  }
}

export function buildDecodedPreviewFromProcessData(
  parsedProfile: ParsedProcessDataProfile,
): DecodedPreview | null {
  const primaryField = parsedProfile.primaryField

  if (!primaryField) {
    return null
  }

  const previewRawValue =
    typeof primaryField.rawValue === 'boolean'
      ? primaryField.rawDisplayValue
      : primaryField.rawValue
  const previewScaledValue =
    typeof primaryField.scaledValue === 'boolean'
      ? primaryField.displayValue
      : primaryField.scaledValue

  return {
    displayValue: primaryField.displayValue,
    rawValue: previewRawValue,
    scaledValue: previewScaledValue,
    mappingComparisonValue:
      typeof primaryField.scaledValue === 'number'
        ? normalizeComparableNumericValue(primaryField.scaledValue)
        : null,
    rawDisplayValue: primaryField.rawDisplayValue,
    sourceRegisters: parsedProfile.sourceRegisters,
    error: null,
    sentinelLabel: primaryField.isMapped ? primaryField.displayValue : null,
    statusBits: buildStatusBitsFromFields(parsedProfile.statusFields),
  }
}
