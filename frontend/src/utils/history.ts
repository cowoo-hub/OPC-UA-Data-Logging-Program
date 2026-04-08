import type {
  DecodeType,
  HistorySample,
  PortDisplayConfig,
} from '../api/types'
import { applyResolutionToPreview, decodeRegistersPreview } from './decode'

export interface PortTrendPoint {
  timestamp: string
  timestampMs: number
  value: number
}

export interface PortTrendSeries {
  points: PortTrendPoint[]
  latestValue: number | null
  previousValue: number | null
  delta: number | null
  minimumValue: number | null
  maximumValue: number | null
  sampleCount: number
  decodeType: DecodeType | null
  status: 'ready' | 'fallback' | 'unavailable'
  oldestTimestampMs: number | null
  latestTimestampMs: number | null
}

const NUMERIC_FALLBACK_DECODE_TYPES: DecodeType[] = [
  'float32',
  'int32',
  'uint32',
  'int16',
  'uint16',
]
const HISTORY_AXIS_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function coerceTimestampDate(value: string | number | Date) {
  const timestamp =
    value instanceof Date
      ? new Date(value.valueOf())
      : typeof value === 'number'
        ? new Date(value)
        : new Date(value)

  if (Number.isNaN(timestamp.valueOf())) {
    return null
  }

  return timestamp
}

function padDateTimePart(value: number) {
  return String(value).padStart(2, '0')
}

function getNumericValue(
  sample: HistorySample,
  displayConfig: PortDisplayConfig,
  dataType: DecodeType,
) {
  const preview = applyResolutionToPreview(
    decodeRegistersPreview(sample.registers, displayConfig, dataType),
    dataType,
    displayConfig.resolutionFactor,
  )

  if (typeof preview.scaledValue !== 'number' || !Number.isFinite(preview.scaledValue)) {
    return null
  }

  return Number.parseFloat(preview.scaledValue.toPrecision(12))
}

function parseHistoryTimestampMs(timestamp: string) {
  const parsedTimestamp = Date.parse(timestamp)

  if (Number.isNaN(parsedTimestamp)) {
    return null
  }

  return parsedTimestamp
}

function buildTrendPoints(
  samples: HistorySample[],
  displayConfig: PortDisplayConfig,
  dataType: DecodeType,
): PortTrendPoint[] {
  const points = samples.flatMap((sample) => {
    const numericValue = getNumericValue(sample, displayConfig, dataType)
    const timestampMs = parseHistoryTimestampMs(sample.timestamp)

    if (numericValue === null || timestampMs === null) {
      return []
    }

    return [
      {
        timestamp: sample.timestamp,
        timestampMs,
        value: numericValue,
      },
    ]
  })

  points.sort((left, right) => left.timestampMs - right.timestampMs)

  return points.filter(
    (point, index) =>
      index === 0 || point.timestampMs !== points[index - 1].timestampMs,
  )
}

export function buildPortTrendSeries(
  samples: HistorySample[],
  displayConfig: PortDisplayConfig,
): PortTrendSeries {
  const preferredPoints = buildTrendPoints(
    samples,
    displayConfig,
    displayConfig.preferredDecodeType,
  )

  if (preferredPoints.length > 0) {
    return finalizeTrendSeries(
      preferredPoints,
      displayConfig.preferredDecodeType,
      'ready',
    )
  }

  for (const fallbackDecodeType of NUMERIC_FALLBACK_DECODE_TYPES) {
    if (fallbackDecodeType === displayConfig.preferredDecodeType) {
      continue
    }

    const fallbackPoints = buildTrendPoints(samples, displayConfig, fallbackDecodeType)

    if (fallbackPoints.length > 0) {
      return finalizeTrendSeries(fallbackPoints, fallbackDecodeType, 'fallback')
    }
  }

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

function finalizeTrendSeries(
  points: PortTrendPoint[],
  decodeType: DecodeType,
  status: PortTrendSeries['status'],
): PortTrendSeries {
  const latestValue = points.at(-1)?.value ?? null
  const previousValue = points.length > 1 ? points.at(-2)?.value ?? null : null
  const values = points.map((point) => point.value)

  return {
    points,
    latestValue,
    previousValue,
    delta:
      latestValue !== null && previousValue !== null
        ? latestValue - previousValue
        : null,
    minimumValue: values.length > 0 ? Math.min(...values) : null,
    maximumValue: values.length > 0 ? Math.max(...values) : null,
    sampleCount: points.length,
    decodeType,
    status,
    oldestTimestampMs: points[0]?.timestampMs ?? null,
    latestTimestampMs: points.at(-1)?.timestampMs ?? null,
  }
}

export function formatTrendDelta(delta: number | null) {
  if (delta === null) {
    return '--'
  }

  const signPrefix = delta > 0 ? '+' : ''
  const isIntegerLike = Number.isInteger(delta)

  return isIntegerLike
    ? `${signPrefix}${delta.toLocaleString()}`
    : `${signPrefix}${delta.toFixed(3).replace(/\.?0+$/, '')}`
}

export function formatHistoryWindow(windowMs: number) {
  if (windowMs < 60000) {
    return `${Math.round(windowMs / 1000)} s`
  }

  const minutes = windowMs / 60000
  return `${minutes % 1 === 0 ? minutes.toFixed(0) : minutes.toFixed(1)} min`
}

export function formatHistoryAxisTime(timestampMs: number) {
  const timestamp = coerceTimestampDate(timestampMs)

  if (!timestamp) {
    return '--:--:--'
  }

  return HISTORY_AXIS_TIME_FORMATTER.format(timestamp)
}

export function formatLocalDateTimeDisplay(value: string | number | Date) {
  const timestamp = coerceTimestampDate(value)

  if (!timestamp) {
    return '--'
  }

  const year = String(timestamp.getFullYear())
  const month = padDateTimePart(timestamp.getMonth() + 1)
  const day = padDateTimePart(timestamp.getDate())
  const hour = padDateTimePart(timestamp.getHours())
  const minute = padDateTimePart(timestamp.getMinutes())
  const second = padDateTimePart(timestamp.getSeconds())

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

export function formatLocalTimeDisplay(value: string | number | Date) {
  const timestamp = coerceTimestampDate(value)

  if (!timestamp) {
    return '--:--:--'
  }

  return HISTORY_AXIS_TIME_FORMATTER.format(timestamp)
}

export function formatDateTimeLocalInputValue(timestampMs: number) {
  const timestamp = coerceTimestampDate(timestampMs)

  if (!timestamp) {
    return ''
  }

  const year = String(timestamp.getFullYear())
  const month = padDateTimePart(timestamp.getMonth() + 1)
  const day = padDateTimePart(timestamp.getDate())
  const hour = padDateTimePart(timestamp.getHours())
  const minute = padDateTimePart(timestamp.getMinutes())
  const second = padDateTimePart(timestamp.getSeconds())

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

export function parseDateTimeLocalInputToUtcIso(value: string) {
  if (!value.trim()) {
    return null
  }

  const parsedTimestamp = new Date(value)

  if (Number.isNaN(parsedTimestamp.valueOf())) {
    return null
  }

  return parsedTimestamp.toISOString()
}
