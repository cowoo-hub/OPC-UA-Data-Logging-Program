import type {
  ByteOrder,
  DecodeType,
  FieldMode,
  PortDisplayConfig,
  PortDisplayOverride,
  PortDisplayOverrides,
  ProcessDataProfileId,
  ProcessDataProfileMode,
  PortProfileId,
  ResolutionFactor,
  SentinelMapping,
  StatusBitDefinition,
  WordOrder,
} from '../api/types'
import { getProcessDataProfile } from './processDataMaps'

const STORAGE_KEY = 'ice2-port-display-overrides:v3'
const PRESET_STORAGE_KEY = 'ice2-port-display-presets:v1'

interface PortProfileDefinition {
  id: PortProfileId
  label: string
  engineeringLabel: string
  engineeringUnit: string | null
  operatorHint: string
  defaultLabelPrefix: string
  defaultDecodeType: DecodeType
  defaultWordOrder: WordOrder
  defaultByteOrder: ByteOrder
  defaultResolutionFactor: ResolutionFactor
  defaultSourceWordCount: number
  defaultFieldMode: FieldMode
  defaultBitOffset: number
  defaultBitLength: number
  defaultSigned: boolean
  defaultSentinelMappings: SentinelMapping[]
  defaultStatusBits: StatusBitDefinition[]
  diagnostics: PortDiagnosticSettings
}

interface DiagnosticThresholdRange {
  min: number
  max: number
}

export interface PortDiagnosticSettings {
  warningRange: DiagnosticThresholdRange | null
  criticalRange: DiagnosticThresholdRange | null
  spikeFactor: number
  flatlineEpsilon: number | null
  flatlineMinSamples: number | null
}

export interface PortDisplayPresetConfig {
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
  engineeringUnit: string | null
  processDataMode: ProcessDataProfileMode
  processDataProfileId: ProcessDataProfileId | null
}

export interface PortDisplayPreset {
  id: string
  name: string
  origin: 'builtin' | 'custom'
  config: PortDisplayPresetConfig
}

export const RESOLUTION_FACTOR_OPTIONS: ResolutionFactor[] = [1, 0.1, 0.01, 0.001]

export const FIELD_MODE_OPTIONS: Array<{ value: FieldMode; label: string }> = [
  { value: 'full_word', label: 'Full word' },
  { value: 'bit_field', label: 'Bit field' },
]

const DEFAULT_SENTINEL_MAPPINGS: SentinelMapping[] = []
const DEFAULT_STATUS_BITS: StatusBitDefinition[] = []

function getDefaultSourceWordCountForDecodeType(decodeType: DecodeType) {
  if (decodeType === 'uint32' || decodeType === 'int32' || decodeType === 'float32') {
    return 2
  }

  return 1
}

export function formatResolutionFactor(value: ResolutionFactor) {
  return value.toString()
}

const PORT_PROFILE_DEFINITIONS: Record<PortProfileId, PortProfileDefinition> = {
  generic: {
    id: 'generic',
    label: 'Generic',
    engineeringLabel: 'Process value',
    engineeringUnit: null,
    operatorHint: 'Use this profile when the payload meaning is still unknown or being commissioned.',
    defaultLabelPrefix: 'Port',
    defaultDecodeType: 'float32',
    defaultWordOrder: 'big',
    defaultByteOrder: 'big',
    defaultResolutionFactor: 1,
    defaultSourceWordCount: getDefaultSourceWordCountForDecodeType('float32'),
    defaultFieldMode: 'full_word',
    defaultBitOffset: 0,
    defaultBitLength: 16,
    defaultSigned: false,
    defaultSentinelMappings: DEFAULT_SENTINEL_MAPPINGS,
    defaultStatusBits: DEFAULT_STATUS_BITS,
    diagnostics: {
      warningRange: null,
      criticalRange: null,
      spikeFactor: 0.45,
      flatlineEpsilon: 0.001,
      flatlineMinSamples: 14,
    },
  },
  temperature: {
    id: 'temperature',
    label: 'Temperature',
    engineeringLabel: 'Temperature',
    engineeringUnit: 'deg C',
    operatorHint: 'Best for temperature probes and transmitters that expose a floating-point or scaled process value.',
    defaultLabelPrefix: 'Temperature',
    defaultDecodeType: 'float32',
    defaultWordOrder: 'big',
    defaultByteOrder: 'big',
    defaultResolutionFactor: 1,
    defaultSourceWordCount: getDefaultSourceWordCountForDecodeType('float32'),
    defaultFieldMode: 'full_word',
    defaultBitOffset: 0,
    defaultBitLength: 16,
    defaultSigned: false,
    defaultSentinelMappings: DEFAULT_SENTINEL_MAPPINGS,
    defaultStatusBits: DEFAULT_STATUS_BITS,
    diagnostics: {
      warningRange: { min: -5, max: 85 },
      criticalRange: { min: -20, max: 110 },
      spikeFactor: 0.24,
      flatlineEpsilon: 0.05,
      flatlineMinSamples: 12,
    },
  },
  pressure: {
    id: 'pressure',
    label: 'Pressure',
    engineeringLabel: 'Pressure',
    engineeringUnit: 'bar',
    operatorHint: 'Useful for pressure switches and transmitters where the first payload words represent the live process reading.',
    defaultLabelPrefix: 'Pressure',
    defaultDecodeType: 'float32',
    defaultWordOrder: 'big',
    defaultByteOrder: 'big',
    defaultResolutionFactor: 1,
    defaultSourceWordCount: getDefaultSourceWordCountForDecodeType('float32'),
    defaultFieldMode: 'full_word',
    defaultBitOffset: 0,
    defaultBitLength: 16,
    defaultSigned: false,
    defaultSentinelMappings: DEFAULT_SENTINEL_MAPPINGS,
    defaultStatusBits: DEFAULT_STATUS_BITS,
    diagnostics: {
      warningRange: { min: 0, max: 10 },
      criticalRange: { min: -0.5, max: 16 },
      spikeFactor: 0.2,
      flatlineEpsilon: 0.02,
      flatlineMinSamples: 12,
    },
  },
  flow: {
    id: 'flow',
    label: 'Flow',
    engineeringLabel: 'Flow',
    engineeringUnit: 'L/min',
    operatorHint: 'A clean fit for flow meters and dosing channels with continuously changing process values.',
    defaultLabelPrefix: 'Flow',
    defaultDecodeType: 'float32',
    defaultWordOrder: 'big',
    defaultByteOrder: 'big',
    defaultResolutionFactor: 1,
    defaultSourceWordCount: getDefaultSourceWordCountForDecodeType('float32'),
    defaultFieldMode: 'full_word',
    defaultBitOffset: 0,
    defaultBitLength: 16,
    defaultSigned: false,
    defaultSentinelMappings: DEFAULT_SENTINEL_MAPPINGS,
    defaultStatusBits: DEFAULT_STATUS_BITS,
    diagnostics: {
      warningRange: { min: 0, max: 80 },
      criticalRange: { min: -1, max: 120 },
      spikeFactor: 0.22,
      flatlineEpsilon: 0.04,
      flatlineMinSamples: 12,
    },
  },
  counter: {
    id: 'counter',
    label: 'Counter',
    engineeringLabel: 'Count',
    engineeringUnit: 'cts',
    operatorHint: 'Use for counters, accumulators, and cycle-tracking payloads where integer process values are more useful than floats.',
    defaultLabelPrefix: 'Counter',
    defaultDecodeType: 'uint32',
    defaultWordOrder: 'big',
    defaultByteOrder: 'big',
    defaultResolutionFactor: 1,
    defaultSourceWordCount: getDefaultSourceWordCountForDecodeType('uint32'),
    defaultFieldMode: 'full_word',
    defaultBitOffset: 0,
    defaultBitLength: 16,
    defaultSigned: false,
    defaultSentinelMappings: DEFAULT_SENTINEL_MAPPINGS,
    defaultStatusBits: DEFAULT_STATUS_BITS,
    diagnostics: {
      warningRange: null,
      criticalRange: null,
      spikeFactor: 0.65,
      flatlineEpsilon: null,
      flatlineMinSamples: null,
    },
  },
}

const PORT_DEFAULT_OVERRIDES: Partial<Record<number, PortDisplayOverride>> = {
  6: {
    processDataMode: 'profile',
    processDataProfileId: 'omt550_distance_record',
    preferredDecodeType: 'uint16',
    sourceWordCount: 1,
    fieldMode: 'bit_field',
    bitOffset: 2,
    bitLength: 14,
    signed: false,
    sentinelMappings: [{ value: 16383, label: 'No Echo' }],
    statusBits: [
      { bit: 0, label: 'Switching signal 1' },
      { bit: 1, label: 'Switching signal 2' },
    ],
  },
}

const BUILT_IN_PROFILE_PRESETS: PortDisplayPreset[] = [
  {
    id: 'builtin-generic-uint16',
    name: 'Generic UINT16',
    origin: 'builtin',
    config: {
      preferredDecodeType: 'uint16',
      wordOrder: 'big',
      byteOrder: 'big',
      resolutionFactor: 1,
      sourceWordCount: 1,
      fieldMode: 'full_word',
      bitOffset: 0,
      bitLength: 16,
      signed: false,
      sentinelMappings: [],
      statusBits: [],
      engineeringUnit: null,
      processDataMode: 'manual',
      processDataProfileId: null,
    },
  },
  {
    id: 'builtin-distance-14-bit',
    name: 'Distance 14-bit with switching bits',
    origin: 'builtin',
    config: {
      preferredDecodeType: 'uint16',
      wordOrder: 'big',
      byteOrder: 'big',
      resolutionFactor: 1,
      sourceWordCount: 1,
      fieldMode: 'bit_field',
      bitOffset: 2,
      bitLength: 14,
      signed: false,
      sentinelMappings: [{ value: 16383, label: 'No Echo' }],
      statusBits: [
        { bit: 0, label: 'Switching signal 1' },
        { bit: 1, label: 'Switching signal 2' },
      ],
      engineeringUnit: 'mm',
      processDataMode: 'profile',
      processDataProfileId: 'omt550_distance_record',
    },
  },
  {
    id: 'builtin-float32-value',
    name: 'Float32 value',
    origin: 'builtin',
    config: {
      preferredDecodeType: 'float32',
      wordOrder: 'big',
      byteOrder: 'big',
      resolutionFactor: 1,
      sourceWordCount: 2,
      fieldMode: 'full_word',
      bitOffset: 0,
      bitLength: 32,
      signed: false,
      sentinelMappings: [],
      statusBits: [],
      engineeringUnit: null,
      processDataMode: 'manual',
      processDataProfileId: null,
    },
  },
  {
    id: 'builtin-signed-int16',
    name: 'Signed INT16',
    origin: 'builtin',
    config: {
      preferredDecodeType: 'int16',
      wordOrder: 'big',
      byteOrder: 'big',
      resolutionFactor: 1,
      sourceWordCount: 1,
      fieldMode: 'full_word',
      bitOffset: 0,
      bitLength: 16,
      signed: true,
      sentinelMappings: [],
      statusBits: [],
      engineeringUnit: null,
      processDataMode: 'manual',
      processDataProfileId: null,
    },
  },
]

export const PORT_PROFILE_OPTIONS = Object.values(PORT_PROFILE_DEFINITIONS)

function isPortProfileId(value: unknown): value is PortProfileId {
  return typeof value === 'string' && value in PORT_PROFILE_DEFINITIONS
}

function isProcessDataProfileId(value: unknown): value is ProcessDataProfileId {
  return typeof value === 'string' && value.trim().length > 0
}

function sanitizeSentinelMappings(value: unknown): SentinelMapping[] {
  if (!Array.isArray(value)) {
    return []
  }

  const mappings = value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }

    const candidate = entry as Record<string, unknown>
    const numericValue = Number(candidate.value)
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''

    if (!Number.isFinite(numericValue) || !label) {
      return []
    }

    return [{ value: numericValue, label }]
  })

  return mappings
    .sort((left, right) => left.value - right.value)
    .filter(
      (mapping, index, allMappings) =>
        index === allMappings.findIndex((candidate) => candidate.value === mapping.value),
    )
}

function sanitizeStatusBits(value: unknown): StatusBitDefinition[] {
  if (!Array.isArray(value)) {
    return []
  }

  const statusBits = value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }

    const candidate = entry as Record<string, unknown>
    const bit = Number(candidate.bit)
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''

    if (!Number.isInteger(bit) || bit < 0 || bit > 31 || !label) {
      return []
    }

    return [{ bit, label }]
  })

  return statusBits
    .sort((left, right) => left.bit - right.bit)
    .filter(
      (bit, index, allBits) =>
        index === allBits.findIndex((candidate) => candidate.bit === bit.bit),
    )
}

function sanitizeOverride(value: unknown): PortDisplayOverride | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const override: PortDisplayOverride = {}

  if (typeof candidate.label === 'string') {
    const trimmedLabel = candidate.label.trim()
    if (trimmedLabel) {
      override.label = trimmedLabel
    }
  }

  if (isPortProfileId(candidate.profileId) && candidate.profileId !== 'generic') {
    override.profileId = candidate.profileId
  }

  if (candidate.engineeringUnit === null) {
    override.engineeringUnit = null
  } else if (typeof candidate.engineeringUnit === 'string') {
    override.engineeringUnit = candidate.engineeringUnit.trim() || null
  }

  if (
    candidate.preferredDecodeType === 'float32' ||
    candidate.preferredDecodeType === 'uint16' ||
    candidate.preferredDecodeType === 'int16' ||
    candidate.preferredDecodeType === 'uint32' ||
    candidate.preferredDecodeType === 'int32' ||
    candidate.preferredDecodeType === 'binary'
  ) {
    override.preferredDecodeType = candidate.preferredDecodeType
  }

  if (candidate.wordOrder === 'big' || candidate.wordOrder === 'little') {
    override.wordOrder = candidate.wordOrder
  }

  if (candidate.byteOrder === 'big' || candidate.byteOrder === 'little') {
    override.byteOrder = candidate.byteOrder
  }

  if (
    candidate.resolutionFactor === 1 ||
    candidate.resolutionFactor === 0.1 ||
    candidate.resolutionFactor === 0.01 ||
    candidate.resolutionFactor === 0.001
  ) {
    override.resolutionFactor = candidate.resolutionFactor
  }

  const sourceWordCount = Number(candidate.sourceWordCount)
  if (Number.isInteger(sourceWordCount) && sourceWordCount >= 1) {
    override.sourceWordCount = sourceWordCount
  }

  if (candidate.fieldMode === 'full_word' || candidate.fieldMode === 'bit_field') {
    override.fieldMode = candidate.fieldMode
  }

  const bitOffset = Number(candidate.bitOffset)
  if (Number.isInteger(bitOffset) && bitOffset >= 0) {
    override.bitOffset = bitOffset
  }

  const bitLength = Number(candidate.bitLength)
  if (Number.isInteger(bitLength) && bitLength >= 1 && bitLength <= 32) {
    override.bitLength = bitLength
  }

  if (typeof candidate.signed === 'boolean') {
    override.signed = candidate.signed
  }

  if (
    candidate.processDataMode === 'manual' ||
    candidate.processDataMode === 'profile' ||
    candidate.processDataMode === 'auto'
  ) {
    override.processDataMode = candidate.processDataMode
  }

  if ('processDataProfileId' in candidate) {
    if (candidate.processDataProfileId === null) {
      override.processDataProfileId = null
    } else if (isProcessDataProfileId(candidate.processDataProfileId)) {
      override.processDataProfileId = candidate.processDataProfileId
    }
  }

  if ('sentinelMappings' in candidate) {
    override.sentinelMappings = sanitizeSentinelMappings(candidate.sentinelMappings)
  }

  if ('statusBits' in candidate) {
    override.statusBits = sanitizeStatusBits(candidate.statusBits)
  }

  return Object.keys(override).length > 0 ? override : null
}

function slugifyPresetName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sanitizePresetConfig(value: unknown): PortDisplayPresetConfig | null {
  const sanitizedOverride = sanitizeOverride(value)

  if (!sanitizedOverride?.preferredDecodeType) {
    return null
  }

  return {
    preferredDecodeType: sanitizedOverride.preferredDecodeType,
    wordOrder: sanitizedOverride.wordOrder ?? 'big',
    byteOrder: sanitizedOverride.byteOrder ?? 'big',
    resolutionFactor: sanitizedOverride.resolutionFactor ?? 1,
    sourceWordCount: sanitizedOverride.sourceWordCount ?? 1,
    fieldMode: sanitizedOverride.fieldMode ?? 'full_word',
    bitOffset: sanitizedOverride.bitOffset ?? 0,
    bitLength: sanitizedOverride.bitLength ?? 16,
    signed: sanitizedOverride.signed ?? false,
    sentinelMappings: sanitizedOverride.sentinelMappings ?? [],
    statusBits: sanitizedOverride.statusBits ?? [],
    engineeringUnit:
      sanitizedOverride.engineeringUnit !== undefined
        ? sanitizedOverride.engineeringUnit ?? null
        : null,
    processDataMode: sanitizedOverride.processDataMode ?? 'manual',
    processDataProfileId: sanitizedOverride.processDataProfileId ?? null,
  }
}

function sanitizeCustomPreset(value: unknown): PortDisplayPreset | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const config = sanitizePresetConfig(candidate.config)

  if (!name || !id || !config) {
    return null
  }

  return {
    id,
    name,
    origin: 'custom',
    config,
  }
}

function mergePortOverrides(
  baseOverride: PortDisplayOverride | undefined,
  userOverride: PortDisplayOverride | null | undefined,
): PortDisplayOverride | null {
  if (!baseOverride && !userOverride) {
    return null
  }

  return {
    ...(baseOverride ?? {}),
    ...(userOverride ?? {}),
  }
}

export function formatSentinelMappings(mappings: SentinelMapping[]) {
  return mappings.map((mapping) => `${mapping.value}=${mapping.label}`).join(', ')
}

export function formatCustomizingMappings(mappings: SentinelMapping[]) {
  return formatSentinelMappings(mappings)
}

export function parseSentinelMappingsInput(input: string): SentinelMapping[] {
  return sanitizeSentinelMappings(
    input
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const separatorIndex = token.indexOf('=')

        if (separatorIndex < 0) {
          return null
        }

        return {
          value: Number(token.slice(0, separatorIndex).trim()),
          label: token.slice(separatorIndex + 1).trim(),
        }
      })
      .filter((entry) => entry !== null),
  )
}

export function parseCustomizingMappingsInput(input: string): SentinelMapping[] {
  return parseSentinelMappingsInput(input)
}

export function formatStatusBits(statusBits: StatusBitDefinition[]) {
  return statusBits.map((statusBit) => `${statusBit.bit}=${statusBit.label}`).join(', ')
}

export function parseStatusBitsInput(input: string): StatusBitDefinition[] {
  return sanitizeStatusBits(
    input
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const separatorIndex = token.indexOf('=')

        if (separatorIndex < 0) {
          return null
        }

        return {
          bit: Number(token.slice(0, separatorIndex).trim()),
          label: token.slice(separatorIndex + 1).trim(),
        }
      })
      .filter((entry) => entry !== null),
  )
}

export function getBuiltInProfilePresets() {
  return BUILT_IN_PROFILE_PRESETS
}

export function loadCustomProfilePresets(): PortDisplayPreset[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const rawValue = window.localStorage.getItem(PRESET_STORAGE_KEY)

    if (!rawValue) {
      return []
    }

    const parsedValue = JSON.parse(rawValue)

    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue
      .map((entry) => sanitizeCustomPreset(entry))
      .filter((preset): preset is PortDisplayPreset => preset !== null)
  } catch {
    return []
  }
}

function saveCustomProfilePresets(presets: PortDisplayPreset[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets))
}

export function saveCustomProfilePreset(
  name: string,
  config: PortDisplayPresetConfig,
): PortDisplayPreset[] {
  const trimmedName = name.trim()

  if (!trimmedName) {
    return loadCustomProfilePresets()
  }

  const presetId = `custom-${slugifyPresetName(trimmedName) || 'preset'}`
  const nextPreset: PortDisplayPreset = {
    id: presetId,
    name: trimmedName,
    origin: 'custom',
    config,
  }
  const existingPresets = loadCustomProfilePresets()
  const nextPresets = [
    ...existingPresets.filter((preset) => preset.id !== presetId),
    nextPreset,
  ].sort((left, right) => left.name.localeCompare(right.name))

  saveCustomProfilePresets(nextPresets)
  return nextPresets
}

export function getAllProfilePresets() {
  return [...BUILT_IN_PROFILE_PRESETS, ...loadCustomProfilePresets()]
}

export function buildPresetConfigFromDisplayConfig(
  displayConfig: PortDisplayConfig,
): PortDisplayPresetConfig {
  return {
    preferredDecodeType: displayConfig.preferredDecodeType,
    wordOrder: displayConfig.wordOrder,
    byteOrder: displayConfig.byteOrder,
    resolutionFactor: displayConfig.resolutionFactor,
    sourceWordCount: displayConfig.sourceWordCount,
    fieldMode: displayConfig.fieldMode,
    bitOffset: displayConfig.bitOffset,
    bitLength: displayConfig.bitLength,
    signed: displayConfig.signed,
    sentinelMappings: displayConfig.sentinelMappings,
    statusBits: displayConfig.statusBits,
    engineeringUnit: displayConfig.engineeringUnit,
    processDataMode: displayConfig.processDataMode,
    processDataProfileId: displayConfig.processDataProfileId,
  }
}

export function buildOverrideFromPreset(
  presetConfig: PortDisplayPresetConfig,
  previousOverride: PortDisplayOverride | null,
): PortDisplayOverride {
  return {
    ...(previousOverride?.label ? { label: previousOverride.label } : {}),
    ...(previousOverride?.profileId ? { profileId: previousOverride.profileId } : {}),
    preferredDecodeType: presetConfig.preferredDecodeType,
    wordOrder: presetConfig.wordOrder,
    byteOrder: presetConfig.byteOrder,
    resolutionFactor: presetConfig.resolutionFactor,
    sourceWordCount: presetConfig.sourceWordCount,
    fieldMode: presetConfig.fieldMode,
    bitOffset: presetConfig.bitOffset,
    bitLength: presetConfig.bitLength,
    signed: presetConfig.signed,
    sentinelMappings: presetConfig.sentinelMappings,
    statusBits: presetConfig.statusBits,
    engineeringUnit: presetConfig.engineeringUnit,
    processDataMode: presetConfig.processDataMode,
    processDataProfileId: presetConfig.processDataProfileId,
  }
}

export function getPortProfile(profileId: PortProfileId) {
  return PORT_PROFILE_DEFINITIONS[profileId]
}

export function getPortDiagnosticSettings(profileId: PortProfileId): PortDiagnosticSettings {
  return PORT_PROFILE_DEFINITIONS[profileId].diagnostics
}

export function loadPortDisplayOverrides(): PortDisplayOverrides {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY)

    if (!rawValue) {
      return {}
    }

    const parsedValue = JSON.parse(rawValue) as Record<string, unknown>
    const overrides: PortDisplayOverrides = {}

    for (const [portKey, rawOverride] of Object.entries(parsedValue)) {
      const portNumber = Number(portKey)
      const sanitized = sanitizeOverride(rawOverride)

      if (Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 8 && sanitized) {
        overrides[portNumber] = sanitized
      }
    }

    return overrides
  } catch {
    return {}
  }
}

export function savePortDisplayOverrides(overrides: PortDisplayOverrides) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

export function resolvePortDisplayConfig(
  portNumber: number,
  override: PortDisplayOverride | null | undefined,
): PortDisplayConfig {
  const baseOverride = PORT_DEFAULT_OVERRIDES[portNumber]
  const effectiveOverride = mergePortOverrides(baseOverride, override)
  const profile = getPortProfile(effectiveOverride?.profileId ?? 'generic')
  const label =
    effectiveOverride?.label?.trim() || `${profile.defaultLabelPrefix} ${portNumber}`
  const preferredDecodeType =
    effectiveOverride?.preferredDecodeType ?? profile.defaultDecodeType
  const wordOrder = effectiveOverride?.wordOrder ?? profile.defaultWordOrder
  const byteOrder = effectiveOverride?.byteOrder ?? profile.defaultByteOrder
  const resolutionFactor =
    effectiveOverride?.resolutionFactor ?? profile.defaultResolutionFactor
  const sourceWordCount =
    effectiveOverride?.sourceWordCount ?? profile.defaultSourceWordCount
  const fieldMode = effectiveOverride?.fieldMode ?? profile.defaultFieldMode
  const bitOffset = effectiveOverride?.bitOffset ?? profile.defaultBitOffset
  const bitLength = effectiveOverride?.bitLength ?? profile.defaultBitLength
  const signed = effectiveOverride?.signed ?? profile.defaultSigned
  const processDataMode = effectiveOverride?.processDataMode ?? 'manual'
  const processDataProfileId = effectiveOverride?.processDataProfileId ?? null
  const activeProcessDataProfile =
    processDataMode === 'profile' && processDataProfileId
      ? getProcessDataProfile(processDataProfileId)
      : null
  const primaryProcessDataField =
    activeProcessDataProfile?.fields.find(
      (field) =>
        field.name === activeProcessDataProfile.primaryFieldName ||
        field.role === 'primary_value',
    ) ?? null
  const sentinelMappings =
    effectiveOverride?.sentinelMappings ?? profile.defaultSentinelMappings
  const statusBits = effectiveOverride?.statusBits ?? profile.defaultStatusBits
  const engineeringUnit =
    effectiveOverride?.engineeringUnit !== undefined
      ? effectiveOverride.engineeringUnit
      : primaryProcessDataField?.unit ?? profile.engineeringUnit
  const engineeringLabel = primaryProcessDataField?.label ?? profile.engineeringLabel
  const operatorHint =
    processDataMode !== 'manual' && activeProcessDataProfile
      ? `${activeProcessDataProfile.name}: ${activeProcessDataProfile.description}`
      : profile.operatorHint
  const usesProfileDefaults =
    effectiveOverride?.preferredDecodeType === undefined &&
    effectiveOverride?.wordOrder === undefined &&
    effectiveOverride?.byteOrder === undefined &&
    effectiveOverride?.resolutionFactor === undefined &&
    effectiveOverride?.sourceWordCount === undefined &&
    effectiveOverride?.fieldMode === undefined &&
    effectiveOverride?.bitOffset === undefined &&
    effectiveOverride?.bitLength === undefined &&
    effectiveOverride?.signed === undefined &&
    effectiveOverride?.processDataMode === undefined &&
    effectiveOverride?.processDataProfileId === undefined &&
    effectiveOverride?.sentinelMappings === undefined &&
    effectiveOverride?.statusBits === undefined &&
    effectiveOverride?.engineeringUnit === undefined

  return {
    portNumber,
    label,
    profileId: profile.id,
    profileLabel: profile.label,
    engineeringLabel,
    engineeringUnit,
    operatorHint,
    preferredDecodeType,
    wordOrder,
    byteOrder,
    resolutionFactor,
    sourceWordCount,
    fieldMode,
    bitOffset,
    bitLength,
    signed,
    sentinelMappings,
    statusBits,
    processDataMode,
    processDataProfileId,
    usesProfileDefaults,
    isCustomized: Boolean(override && Object.keys(override).length > 0),
  }
}
