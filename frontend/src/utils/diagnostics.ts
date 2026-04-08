import type {
  AllPortsPdiResponse,
  DecodedPreview,
  DiagnosticForecastDirection,
  DiagnosticLevel,
  DiagnosticReasonCode,
  PortDiagnostic,
  PortDiagnosticCause,
  PortDiagnosticEvidence,
  PortDiagnosticForecast,
  PortDiagnosticReason,
  PortDiagnosticSignalQuality,
  PortDisplayConfig,
  PortSnapshot,
} from '../api/types'
import { formatTrendDelta, type PortTrendSeries } from './history'
import { getPortDiagnosticSettings } from './portDisplay'

const LEVEL_RANK: Record<DiagnosticLevel, number> = {
  normal: 0,
  warning: 1,
  critical: 2,
}

const REASON_PRIORITY: Record<DiagnosticReasonCode, number> = {
  fault: 0,
  polling_error: 1,
  stale_data: 2,
  no_snapshot: 3,
  invalid_pdi: 4,
  sentinel_value: 5,
  event_code: 6,
  value_out_of_range: 7,
  drift: 8,
  spike: 9,
  flatline: 10,
}

interface LearnedSignalModel {
  sampleCount: number
  baselineValue: number
  baselineBandHalfWidth: number
  recoveryBandHalfWidth: number
  criticalBandHalfWidth: number
  latestDeviation: number
  latestAbsDeviation: number
  latestDelta: number | null
  spikeThreshold: number
  recentSpan: number
  stableRun: number
  driftRun: number
  criticalRun: number
  outsideBandCount: number
  warningDwellSamples: number
  recoveryDwellSamples: number
  signFlipRate: number
  slopePerMs: number
  direction: DiagnosticForecastDirection
  projectedChange: number
  persistentDrift: boolean
  severeDeviation: boolean
  settlingBackToBaseline: boolean
  suddenSpike: boolean
  flatlineLikely: boolean
  normalWithinBand: boolean
  dataQualityWeight: number
}

interface SpecialMeasurementState {
  label: string
  normalizedLabel: string
  level: DiagnosticLevel
  title: string
  detail: string
  summary: string
  interpretation: string
  suggestedAction: string
  forecastSummary: string
  expectedState: string
  probableCauseTitle: string
  probableCauseDetail: string
  evidenceLabel: string
  blocksTrendAnalysis: boolean
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function sortReasons(reasons: PortDiagnosticReason[]) {
  return [...reasons].sort((left, right) => {
    const levelDelta = LEVEL_RANK[right.level] - LEVEL_RANK[left.level]

    if (levelDelta !== 0) {
      return levelDelta
    }

    return REASON_PRIORITY[left.code] - REASON_PRIORITY[right.code]
  })
}

function createReason(
  code: DiagnosticReasonCode,
  level: DiagnosticLevel,
  title: string,
  detail: string,
): PortDiagnosticReason {
  return {
    code,
    level,
    title,
    detail,
  }
}

function normalizeSpecialMeasurementLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function detectSpecialMeasurementState(
  featuredPreview: DecodedPreview,
): SpecialMeasurementState | null {
  const mappedLabel = featuredPreview.sentinelLabel?.trim()

  if (!mappedLabel) {
    return null
  }

  const normalizedLabel = normalizeSpecialMeasurementLabel(mappedLabel)

  if (
    /\b(no measurement data|no measurement|measurement unavailable|measurement invalid|no data|no object|no target)\b/.test(
      normalizedLabel,
    )
  ) {
    return {
      label: mappedLabel,
      normalizedLabel,
      level: 'warning',
      title: 'No measurement data',
      detail: `Configured mapped text "${mappedLabel}" indicates that no valid measurement data is being reported. Stability analysis is suspended while this state persists.`,
      summary:
        'No measurement data is being reported continuously instead of a valid engineering measurement.',
      interpretation: `The port is currently reporting "${mappedLabel}" instead of a valid measurement. Stability analysis is suspended until normal measurement data returns.`,
      suggestedAction:
        'Check target presence, sensing conditions, and device readiness before relying on this port measurement.',
      forecastSummary:
        'Prediction is limited because the port is reporting no valid measurement data rather than a usable numeric signal.',
      expectedState:
        'Measurement remains unavailable until the sensing condition or device state returns to normal.',
      probableCauseTitle: 'Measurement unavailable at source',
      probableCauseDetail:
        'The device is explicitly reporting that a valid measurement is not available, so numeric trend reasoning is intentionally paused.',
      evidenceLabel: 'Measurement availability',
      blocksTrendAnalysis: true,
    }
  }

  if (/\bno echo\b/.test(normalizedLabel)) {
    return {
      label: mappedLabel,
      normalizedLabel,
      level: 'warning',
      title: 'No echo condition',
      detail: `Configured mapped text "${mappedLabel}" indicates that the sensor is not receiving a valid return signal. Stability analysis is suspended while this state persists.`,
      summary: 'No echo is being reported continuously instead of a valid engineering measurement.',
      interpretation: `The port is currently reporting "${mappedLabel}" rather than a valid process value. Stability analysis is suspended until a valid return signal is restored.`,
      suggestedAction:
        'Check target presence, sensing distance, alignment, and surface conditions before trusting this channel.',
      forecastSummary:
        'Prediction is limited because the sensor is reporting no echo instead of a valid numeric measurement.',
      expectedState:
        'Measurement remains unavailable until the sensing path produces a valid echo again.',
      probableCauseTitle: 'Sensor return signal unavailable',
      probableCauseDetail:
        'The sensing channel is reporting no echo, which usually points to missing target reflection, excessive distance, or alignment issues.',
      evidenceLabel: 'Echo state',
      blocksTrendAnalysis: true,
    }
  }

  if (
    /\b(out of range|over range|under range|outside range|range exceeded|range error)\b/.test(
      normalizedLabel,
    )
  ) {
    return {
      label: mappedLabel,
      normalizedLabel,
      level: 'warning',
      title: 'Out-of-range condition',
      detail: `Configured mapped text "${mappedLabel}" indicates that the measurement is outside the valid sensing range. Stability analysis is suspended while this condition persists.`,
      summary: 'Out-of-range condition persists instead of a valid engineering measurement.',
      interpretation: `The port is currently reporting "${mappedLabel}" instead of a valid in-range process value. Stability analysis is suspended until the measurement returns to the valid sensing band.`,
      suggestedAction:
        'Check sensor standoff, target position, and configured measuring range before using this reading operationally.',
      forecastSummary:
        'Prediction is limited because the current state represents an out-of-range measurement rather than a valid numeric signal.',
      expectedState:
        'The invalid range condition is likely to persist until the process re-enters the valid sensing region.',
      probableCauseTitle: 'Process outside valid sensing range',
      probableCauseDetail:
        'The device is explicitly reporting that the sensed condition is beyond the valid operating range for a normal measurement.',
      evidenceLabel: 'Range validity',
      blocksTrendAnalysis: true,
    }
  }

  if (/\b(fault|error|alarm)\b/.test(normalizedLabel)) {
    return {
      label: mappedLabel,
      normalizedLabel,
      level: 'critical',
      title: 'Measurement error state',
      detail: `Configured mapped text "${mappedLabel}" indicates an error-class measurement condition. Stability analysis is suspended while this state persists.`,
      summary:
        'An error-class measurement state is being reported instead of a valid engineering measurement.',
      interpretation: `The port is currently reporting "${mappedLabel}", which is being treated as an invalid error-state measurement. Stability analysis is suspended until a valid value returns.`,
      suggestedAction:
        'Inspect the device condition, sensing path, and measurement configuration before trusting this channel again.',
      forecastSummary:
        'Prediction is limited because the current state represents an error-class measurement condition rather than a valid numeric signal.',
      expectedState:
        'The invalid error state is likely to persist until the underlying sensing or device issue is corrected.',
      probableCauseTitle: 'Measurement path error condition',
      probableCauseDetail:
        'The mapped process state itself indicates an error-class condition, so normal trend interpretation is intentionally blocked.',
      evidenceLabel: 'Error-state mapping',
      blocksTrendAnalysis: true,
    }
  }

  if (/\b(unavailable|invalid|not available|not valid)\b/.test(normalizedLabel)) {
    return {
      label: mappedLabel,
      normalizedLabel,
      level: 'warning',
      title: 'Invalid measurement state',
      detail: `Configured mapped text "${mappedLabel}" indicates that the measurement is not currently valid. Stability analysis is suspended while this state persists.`,
      summary:
        'An invalid measurement state is being reported continuously instead of a valid engineering value.',
      interpretation: `The port is currently reporting "${mappedLabel}" rather than a valid numeric measurement. Stability analysis is suspended until the signal becomes valid again.`,
      suggestedAction:
        'Verify sensing conditions and channel validity before relying on this process value.',
      forecastSummary:
        'Prediction is limited because the current state represents an invalid or unavailable measurement rather than a valid numeric signal.',
      expectedState:
        'Measurement interpretation remains constrained until a valid signal resumes.',
      probableCauseTitle: 'Invalid measurement state at source',
      probableCauseDetail:
        'The mapped process text indicates that the device is not publishing a valid measurement, so numeric baseline analysis is intentionally paused.',
      evidenceLabel: 'Measurement validity',
      blocksTrendAnalysis: true,
    }
  }

  return null
}

function isOutsideRange(value: number, minimum: number, maximum: number) {
  return value < minimum || value > maximum
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0
  }

  const sortedValues = [...values].sort((left, right) => left - right)
  const middleIndex = Math.floor(sortedValues.length / 2)

  if (sortedValues.length % 2 === 0) {
    return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2
  }

  return sortedValues[middleIndex]
}

function standardDeviation(values: number[], center: number) {
  if (values.length <= 1) {
    return 0
  }

  const variance =
    values.reduce((total, value) => total + (value - center) ** 2, 0) / values.length

  return Math.sqrt(Math.max(variance, 0))
}

function countEndingWhere(values: boolean[]) {
  let count = 0

  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (!values[index]) {
      break
    }

    count += 1
  }

  return count
}

function formatNumericValue(value: number, unit: string | null = null) {
  const absoluteValue = Math.abs(value)
  let formattedValue = ''

  if (absoluteValue >= 1000) {
    formattedValue = value.toFixed(0)
  } else if (absoluteValue >= 100) {
    formattedValue = value.toFixed(1)
  } else if (absoluteValue >= 10) {
    formattedValue = value.toFixed(2)
  } else if (absoluteValue >= 1) {
    formattedValue = value.toFixed(3)
  } else if (absoluteValue >= 0.01) {
    formattedValue = value.toFixed(4)
  } else {
    formattedValue = value.toPrecision(3)
  }

  const normalizedValue = formattedValue.replace(/\.?0+$/, '')
  return unit ? `${normalizedValue} ${unit}` : normalizedValue
}

function buildRangeDetail(
  value: number,
  minimum: number,
  maximum: number,
  unit: string | null,
) {
  const suffix = unit ? ` ${unit}` : ''
  return `Observed ${value.toFixed(3).replace(/\.?0+$/, '')}${suffix}, expected ${minimum}${suffix} to ${maximum}${suffix}.`
}

function buildBandDetail(
  model: LearnedSignalModel,
  displayConfig: PortDisplayConfig,
) {
  return `Learned baseline ${formatNumericValue(model.baselineValue, displayConfig.engineeringUnit)} with a normal band of +/-${formatNumericValue(model.baselineBandHalfWidth, displayConfig.engineeringUnit)}. Latest deviation is ${formatNumericValue(model.latestAbsDeviation, displayConfig.engineeringUnit)}.`
}

function getHistorySpanMs(trendSeries: PortTrendSeries) {
  if (trendSeries.points.length < 2) {
    return null
  }

  const firstTimestamp = Date.parse(trendSeries.points[0].timestamp)
  const lastTimestamp = Date.parse(trendSeries.points.at(-1)?.timestamp ?? '')

  if (
    Number.isNaN(firstTimestamp) ||
    Number.isNaN(lastTimestamp) ||
    lastTimestamp <= firstTimestamp
  ) {
    return null
  }

  return lastTimestamp - firstTimestamp
}

function formatForecastHorizon(horizonMs: number) {
  if (horizonMs < 60000) {
    return `${Math.round(horizonMs / 1000)} s`
  }

  const minutes = horizonMs / 60000
  return minutes % 1 === 0 ? `${minutes.toFixed(0)} min` : `${minutes.toFixed(1)} min`
}

function evaluateRangeLevel(
  value: number,
  displayConfig: PortDisplayConfig,
): DiagnosticLevel {
  const diagnosticSettings = getPortDiagnosticSettings(displayConfig.profileId)

  if (
    diagnosticSettings.criticalRange &&
    isOutsideRange(
      value,
      diagnosticSettings.criticalRange.min,
      diagnosticSettings.criticalRange.max,
    )
  ) {
    return 'critical'
  }

  if (
    diagnosticSettings.warningRange &&
    isOutsideRange(
      value,
      diagnosticSettings.warningRange.min,
      diagnosticSettings.warningRange.max,
    )
  ) {
    return 'warning'
  }

  return 'normal'
}

function buildLearnedSignalModel(
  trendSeries: PortTrendSeries,
  displayConfig: PortDisplayConfig,
): LearnedSignalModel | null {
  if (trendSeries.points.length < 6 || trendSeries.latestValue === null) {
    return null
  }

  const diagnosticSettings = getPortDiagnosticSettings(displayConfig.profileId)
  const profileSensitivity = clamp(diagnosticSettings.spikeFactor, 0.18, 0.85)
  const points = trendSeries.points.slice(-Math.min(36, trendSeries.points.length))
  const values = points.map((point) => point.value)
  const latestValue = values.at(-1) ?? trendSeries.latestValue
  const tailSize = clamp(Math.round(points.length * 0.32), 4, 8)
  const baselineSource = values.slice(0, Math.max(values.length - tailSize, 1))
  const baselinePool = baselineSource.length >= 4 ? baselineSource : values
  const baselineValue = median(baselinePool)
  const absoluteDeviations = baselinePool.map((value) => Math.abs(value - baselineValue))
  const mad = median(absoluteDeviations)
  const standardDeviationValue = standardDeviation(baselinePool, baselineValue)
  const resolutionFloor = Math.max(displayConfig.resolutionFactor, 0.0001)
  const profileFloor = Math.max(diagnosticSettings.flatlineEpsilon ?? 0, resolutionFloor)
  const amplitudeFloor = Math.max(Math.abs(baselineValue) * 0.0012, resolutionFloor * 0.65)
  const learnedNoiseScale = Math.max(
    mad * 1.4826,
    standardDeviationValue,
    profileFloor,
    amplitudeFloor,
    0.0005,
  )
  const normalBandMultiplier = 3.8 + profileSensitivity * 1.2
  const recoveryBandMultiplier = 2.75 + profileSensitivity * 0.85
  const criticalBandMultiplier = 6.9 + profileSensitivity * 1.25
  const baselineBandHalfWidth = Math.max(
    learnedNoiseScale * normalBandMultiplier,
    resolutionFloor * 3.4,
    profileFloor * 2.6,
  )
  const recoveryBandHalfWidth = Math.max(
    learnedNoiseScale * recoveryBandMultiplier,
    resolutionFloor * 2.2,
    profileFloor * 1.75,
  )
  const criticalBandHalfWidth = Math.max(
    learnedNoiseScale * criticalBandMultiplier,
    baselineBandHalfWidth * 2.2,
  )
  const tailValues = values.slice(-tailSize)
  const tailDeviations = tailValues.map((value) => value - baselineValue)
  const tailDeviationFlags = tailDeviations.map(
    (deviation) => Math.abs(deviation) > baselineBandHalfWidth,
  )
  const tailCriticalFlags = tailDeviations.map(
    (deviation) => Math.abs(deviation) > criticalBandHalfWidth,
  )
  const tailRecoveryFlags = tailDeviations.map(
    (deviation) => Math.abs(deviation) <= recoveryBandHalfWidth,
  )
  const driftRun = countEndingWhere(tailDeviationFlags)
  const criticalRun = countEndingWhere(tailCriticalFlags)
  const stableRun = countEndingWhere(tailRecoveryFlags)
  const outsideBandCount = tailDeviationFlags.filter(Boolean).length
  const warningDwellSamples = clamp(Math.ceil(tailSize * 0.72), 4, tailSize)
  const recoveryDwellSamples = clamp(Math.ceil(tailSize * 0.5), 3, tailSize)
  const severeDeviation =
    criticalRun >= 2 ||
    tailCriticalFlags.filter(Boolean).length >= Math.ceil(tailSize * 0.5)
  const unsettledDeviation =
    outsideBandCount >= Math.max(3, Math.ceil(tailSize * 0.55)) &&
    stableRun > 0 &&
    stableRun < recoveryDwellSamples &&
    Math.abs(tailDeviations.at(-1) ?? 0) > recoveryBandHalfWidth * 0.9
  const persistentDrift =
    !severeDeviation &&
    (driftRun >= warningDwellSamples ||
      outsideBandCount >= Math.ceil(tailSize * 0.82) ||
      unsettledDeviation)
  const deltas = values.slice(1).map((value, index) => value - values[index])
  const absoluteDeltas = deltas.map((value) => Math.abs(value))
  const medianAbsoluteDelta = absoluteDeltas.length > 0 ? median(absoluteDeltas) : 0
  const deltaMad = absoluteDeltas.length > 0
    ? median(absoluteDeltas.map((value) => Math.abs(value - medianAbsoluteDelta)))
    : 0
  const deltaScale = Math.max(
    medianAbsoluteDelta,
    deltaMad * 1.4826,
    learnedNoiseScale * 0.65,
    resolutionFloor,
  )
  const latestDelta = trendSeries.delta
  const latestAbsDeviation = Math.abs(latestValue - baselineValue)
  const spikeThreshold = Math.max(
    deltaScale * (5.8 + profileSensitivity * 0.9),
    baselineBandHalfWidth * 1.08,
    resolutionFloor * 8,
  )
  const suddenSpike =
    latestDelta !== null &&
    Math.abs(latestDelta) >= spikeThreshold &&
    latestAbsDeviation >= baselineBandHalfWidth * 1.35
  const recentSpan = Math.max(...tailValues) - Math.min(...tailValues)
  const meaningfulDeltas = deltas.filter((delta) => Math.abs(delta) >= resolutionFloor * 0.75)
  let signFlipRate = 0

  if (meaningfulDeltas.length >= 3) {
    let signFlips = 0

    for (let index = 1; index < meaningfulDeltas.length; index += 1) {
      if (
        Math.sign(meaningfulDeltas[index]) !== 0 &&
        Math.sign(meaningfulDeltas[index]) !== Math.sign(meaningfulDeltas[index - 1])
      ) {
        signFlips += 1
      }
    }

    signFlipRate = signFlips / Math.max(1, meaningfulDeltas.length - 1)
  }

  const forecastWindow = points.slice(-Math.min(points.length, 8))
  const firstForecastPoint = forecastWindow[0]
  const lastForecastPoint = forecastWindow.at(-1) ?? firstForecastPoint
  const firstTimestamp = Date.parse(firstForecastPoint.timestamp)
  const lastTimestamp = Date.parse(lastForecastPoint.timestamp)
  const slopeDurationMs =
    Number.isNaN(firstTimestamp) || Number.isNaN(lastTimestamp) || lastTimestamp <= firstTimestamp
      ? 1
      : lastTimestamp - firstTimestamp
  const slopePerMs = (lastForecastPoint.value - firstForecastPoint.value) / slopeDurationMs
  const projectedChange = slopePerMs * 30000
  const direction =
    Math.abs(projectedChange) <= recoveryBandHalfWidth * 1.25
      ? 'stable'
      : projectedChange > 0
        ? 'rising'
        : 'falling'
  const flatlineWindowSize = clamp(
    Math.max(diagnosticSettings.flatlineMinSamples ?? 0, 10),
    6,
    values.length,
  )
  const flatlineValues = values.slice(-flatlineWindowSize)
  const flatlineSpan = Math.max(...flatlineValues) - Math.min(...flatlineValues)
  const earlierValues = values.slice(0, Math.max(0, values.length - flatlineWindowSize))
  const earlierSpan =
    earlierValues.length >= 4
      ? Math.max(...earlierValues) - Math.min(...earlierValues)
      : flatlineSpan
  const flatlineThreshold = Math.max(profileFloor * 1.2, resolutionFloor * 1.5)
  const flatlineLikely =
    diagnosticSettings.flatlineMinSamples !== null &&
    values.length >= diagnosticSettings.flatlineMinSamples &&
    earlierValues.length >= 4 &&
    earlierSpan >= flatlineThreshold * 3.5 &&
    flatlineSpan <= flatlineThreshold &&
    stableRun >= Math.min(6, tailSize)
  const dataQualityWeight = clamp(
    100 -
      signFlipRate * 18 -
      (suddenSpike ? 10 : 0) -
      clamp((recentSpan / Math.max(baselineBandHalfWidth, resolutionFloor)) * 3.2, 0, 14),
    24,
    98,
  )
  const settlingBackToBaseline =
    !severeDeviation &&
    !persistentDrift &&
    outsideBandCount >= Math.max(3, Math.ceil(tailSize * 0.5)) &&
    stableRun > 0 &&
    stableRun < recoveryDwellSamples

  return {
    sampleCount: values.length,
    baselineValue,
    baselineBandHalfWidth,
    recoveryBandHalfWidth,
    criticalBandHalfWidth,
    latestDeviation: latestValue - baselineValue,
    latestAbsDeviation,
    latestDelta,
    spikeThreshold,
    recentSpan,
    stableRun,
    driftRun,
    criticalRun,
    outsideBandCount,
    warningDwellSamples,
    recoveryDwellSamples,
    signFlipRate,
    slopePerMs,
    direction,
    projectedChange,
    persistentDrift,
    severeDeviation,
    settlingBackToBaseline,
    suddenSpike,
    flatlineLikely,
    normalWithinBand:
      latestAbsDeviation <= recoveryBandHalfWidth &&
      stableRun >= recoveryDwellSamples &&
      outsideBandCount <= Math.max(1, Math.floor(tailSize * 0.2)),
    dataQualityWeight,
  }
}

function buildSummary(
  reasons: PortDiagnosticReason[],
  displayConfig: PortDisplayConfig,
  learnedSignalModel: LearnedSignalModel | null,
  specialMeasurementState: SpecialMeasurementState | null,
) {
  if (reasons.length === 0) {
    if (learnedSignalModel) {
      return `${displayConfig.label} is stable within its learned signal band.`
    }

    return 'AI analysis sees a stable operating envelope with no material anomaly signals.'
  }

  const [topReason] = sortReasons(reasons)
  const suffix =
    reasons.length > 1
      ? ` ${reasons.length - 1} supporting indicator(s) also contributed.`
      : ''

  switch (topReason.code) {
    case 'fault':
      return `A confirmed port fault is driving the current diagnostic state.${suffix}`
    case 'polling_error':
      return `Communication failures are reducing the freshness of diagnostic evidence.${suffix}`
    case 'stale_data':
      return `The page is using stale cached evidence and confidence is reduced.${suffix}`
    case 'no_snapshot':
      return `No valid cached evidence exists yet for this port.${suffix}`
    case 'invalid_pdi':
      return `Process image validity is compromised, so the live reading is not fully trustworthy.${suffix}`
    case 'sentinel_value':
      return specialMeasurementState
        ? `${specialMeasurementState.summary}${suffix}`
        : `The device is reporting a configured mapped process state instead of a normal engineering value.${suffix}`
    case 'value_out_of_range':
      return `The process value is outside its configured operating envelope.${suffix}`
    case 'drift':
      if (topReason.title === 'Recovery not yet confirmed') {
        return `The signal is returning toward its learned baseline, but recovery dwell is not complete yet.${suffix}`
      }

      return topReason.level === 'critical'
        ? `The signal is sustaining a large deviation from its learned baseline.${suffix}`
        : `Mild drift is persisting beyond the learned signal band.${suffix}`
    case 'spike':
      return `A sudden change exceeded the learned change band for this signal.${suffix}`
    case 'flatline':
      return `The signal has become unusually static compared with its earlier behavior.${suffix}`
    case 'event_code':
      return `A device-side event is active and contributing to the diagnostic state.${suffix}`
    default:
      return `The intelligence layer found multiple signals that warrant review.${suffix}`
  }
}

function buildBaseSuggestedAction(
  reasons: PortDiagnosticReason[],
  specialMeasurementState: SpecialMeasurementState | null,
) {
  if (reasons.length === 0) {
    return 'Continue monitoring. Current history and live state support a healthy interpretation.'
  }

  const [topReason] = sortReasons(reasons)

  switch (topReason.code) {
    case 'fault':
      return 'Inspect the field device, wiring path, and port fault condition before returning the channel to normal service.'
    case 'polling_error':
      return 'Check ICE2 reachability, Modbus session health, and network quality while the cache worker retries.'
    case 'stale_data':
      return 'Treat the value as last known good data and verify communication stability before taking control action.'
    case 'no_snapshot':
      return 'Confirm the channel is connected and wait for at least one successful cached polling cycle before trusting the port.'
    case 'invalid_pdi':
      return 'Verify IO-Link cycle quality, device readiness, and payload configuration for this port.'
    case 'sentinel_value':
      return specialMeasurementState?.suggestedAction ??
        'Verify the device is seeing a valid target or measurement condition before using the process value operationally.'
    case 'value_out_of_range':
      return 'Review the process condition, scaling profile, and physical sensor condition for this channel.'
    case 'drift':
      if (topReason.title === 'Recovery not yet confirmed') {
        return 'The signal is moving back toward normal. Hold watch long enough to confirm recovery before clearing the condition.'
      }

      return topReason.level === 'critical'
        ? 'Check for process upset, sensor displacement, or configuration drift because the signal has moved well outside its learned band.'
        : 'Watch the process and confirm whether the observed drift matches expected operating change or a developing sensor issue.'
    case 'spike':
      return 'Check for abrupt process disturbance, unstable sensing, or an intermittent connection on the field side.'
    case 'flatline':
      return 'Confirm the signal should be static. If not, investigate for a frozen measurement or stalled device state.'
    case 'event_code':
      return 'Review the active event reported by the device and plan inspection or maintenance around that condition.'
    default:
      return 'Review the flagged indicators and confirm the channel before relying on this measurement.'
  }
}

function buildSignalQuality(
  snapshot: PortSnapshot,
  trendSeries: PortTrendSeries,
  dashboard: AllPortsPdiResponse | null,
  learnedSignalModel: LearnedSignalModel | null,
  specialMeasurementState: SpecialMeasurementState | null,
): PortDiagnosticSignalQuality {
  const polling = dashboard?.polling ?? null
  let score = 82

  if (!snapshot.pdi) {
    score -= 34
  }

  if (polling?.communication_state === 'polling_error') {
    score -= polling.has_snapshot ? 20 : 32
  }

  if (polling?.is_stale) {
    score -= 14
  }

  if (trendSeries.status === 'fallback') {
    score -= 6
  } else if (trendSeries.status === 'unavailable') {
    score -= 22
  }

  if (trendSeries.sampleCount < 4) {
    score -= 16
  } else if (trendSeries.sampleCount < 8) {
    score -= 7
  }

  if (!snapshot.pdi?.header.port_status.pdi_valid) {
    score -= 16
  }

  if (snapshot.pdi?.header.port_status.fault) {
    score -= 18
  }

  if (learnedSignalModel) {
    score += Math.round((learnedSignalModel.dataQualityWeight - 70) * 0.3)

    if (learnedSignalModel.signFlipRate >= 0.55) {
      score -= 10
    } else if (learnedSignalModel.signFlipRate >= 0.35) {
      score -= 4
    }

    if (learnedSignalModel.suddenSpike) {
      score -= 6
    }

    if (learnedSignalModel.normalWithinBand) {
      score += 4
    }
  }

  score = clamp(Math.round(score), 6, 98)

  if (specialMeasurementState?.blocksTrendAnalysis) {
    return {
      label: 'degraded',
      score: clamp(
        Math.min(score - 16, specialMeasurementState.level === 'critical' ? 34 : 46),
        8,
        58,
      ),
      summary:
        'The port is reporting an invalid or unavailable measurement state, so stability analysis is suspended until a valid numeric signal returns.',
    }
  }

  let label: PortDiagnosticSignalQuality['label']

  if (!snapshot.pdi || polling?.communication_state === 'polling_error' || !polling?.has_snapshot) {
    label = 'degraded'
  } else if (score >= 78) {
    label = 'stable'
  } else if (score >= 60) {
    label = 'watch'
  } else if (score >= 38) {
    label = 'volatile'
  } else {
    label = 'degraded'
  }

  const summaryByLabel: Record<PortDiagnosticSignalQuality['label'], string> = {
    stable: 'Recent evidence is coherent and the signal supports high-confidence interpretation.',
    watch: 'Evidence quality is usable, with mild uncertainty in recent behavior.',
    volatile: 'Recent signal behavior is noisy enough to require cautious interpretation.',
    degraded: 'Communication or measurement quality is materially limiting diagnostic confidence.',
  }

  return {
    label,
    score,
    summary: summaryByLabel[label],
  }
}

function buildAnomalyScore(
  reasons: PortDiagnosticReason[],
  signalQuality: PortDiagnosticSignalQuality,
  specialMeasurementState: SpecialMeasurementState | null,
) {
  if (reasons.length === 0) {
    return signalQuality.label === 'stable' ? 3 : 8
  }

  let score = 0

  for (const reason of reasons) {
    switch (reason.code) {
      case 'fault':
        score += 58
        break
      case 'polling_error':
        score += 38
        break
      case 'stale_data':
        score += 18
        break
      case 'no_snapshot':
        score += 26
        break
      case 'invalid_pdi':
        score += 22
        break
      case 'sentinel_value':
        score += specialMeasurementState?.blocksTrendAnalysis
          ? reason.level === 'critical'
            ? 32
            : 24
          : 18
        break
      case 'value_out_of_range':
        score += reason.level === 'critical' ? 34 : 22
        break
      case 'drift':
        score += reason.level === 'critical' ? 28 : 12
        break
      case 'spike':
        score += reason.level === 'critical' ? 30 : 20
        break
      case 'flatline':
        score += 12
        break
      case 'event_code':
        score += 10
        break
      default:
        score += 10
        break
    }
  }

  score += Math.min(10, (reasons.length - 1) * 3)

  if (signalQuality.label === 'volatile') {
    score += 4
  }

  if (signalQuality.label === 'degraded') {
    score += 8
  }

  return clamp(Math.round(score), 0, 100)
}

function buildConfidenceScore(
  snapshot: PortSnapshot,
  signalQuality: PortDiagnosticSignalQuality,
  trendSeries: PortTrendSeries,
  dashboard: AllPortsPdiResponse | null,
  learnedSignalModel: LearnedSignalModel | null,
  specialMeasurementState: SpecialMeasurementState | null,
) {
  const polling = dashboard?.polling ?? null
  let score = 52

  if (snapshot.pdi?.header.port_status.operational) {
    score += 12
  }

  if (snapshot.pdi?.header.port_status.pdi_valid) {
    score += 10
  }

  if (trendSeries.status === 'ready') {
    score += 12
  } else if (trendSeries.status === 'fallback') {
    score += 5
  }

  if (trendSeries.sampleCount >= 12) {
    score += 10
  } else if (trendSeries.sampleCount >= 6) {
    score += 5
  }

  if (learnedSignalModel) {
    score += learnedSignalModel.normalWithinBand ? 5 : 0
    score += learnedSignalModel.persistentDrift && learnedSignalModel.signFlipRate <= 0.2 ? 4 : 0
    score -= learnedSignalModel.settlingBackToBaseline ? 2 : 0
    score -= learnedSignalModel.signFlipRate >= 0.55 ? 10 : 0
  }

  if (signalQuality.label === 'stable') {
    score += 8
  } else if (signalQuality.label === 'watch') {
    score += 2
  } else if (signalQuality.label === 'volatile') {
    score -= 8
  } else {
    score -= 18
  }

  if (polling?.is_stale) {
    score -= 10
  }

  if (polling?.communication_state === 'polling_error') {
    score -= 18
  }

  if (!snapshot.pdi) {
    score -= 16
  }

  if (specialMeasurementState?.blocksTrendAnalysis) {
    score -= specialMeasurementState.level === 'critical' ? 20 : 14
  }

  return clamp(Math.round(score), 8, 99)
}

function buildForecast(
  level: DiagnosticLevel,
  signalQuality: PortDiagnosticSignalQuality,
  trendSeries: PortTrendSeries,
  displayConfig: PortDisplayConfig,
  numericValue: number | null,
  learnedSignalModel: LearnedSignalModel | null,
  specialMeasurementState: SpecialMeasurementState | null,
): PortDiagnosticForecast {
  const historySpanMs = getHistorySpanMs(trendSeries)
  const horizonMs = clamp(Math.round((historySpanMs ?? 30000) * 0.35), 15000, 90000)
  const horizonLabel = `next ${formatForecastHorizon(horizonMs)}`

  if (specialMeasurementState?.blocksTrendAnalysis) {
    return {
      horizonLabel,
      direction: 'unknown',
      summary: specialMeasurementState.forecastSummary,
      projectedValue: null,
      worseningProbability: clamp(
        (specialMeasurementState.level === 'critical' ? 64 : 44) +
          (signalQuality.label === 'degraded' ? 8 : 0),
        12,
        88,
      ),
      expectedState: specialMeasurementState.expectedState,
      stability: signalQuality.label,
    }
  }

  if (
    trendSeries.status === 'unavailable' ||
    numericValue === null ||
    trendSeries.points.length < 2 ||
    learnedSignalModel === null
  ) {
    const worseningProbability = clamp(
      (level === 'critical' ? 74 : level === 'warning' ? 42 : 16) +
        (signalQuality.label === 'degraded' ? 12 : 0),
      8,
      92,
    )

    return {
      horizonLabel,
      direction: 'unknown',
      summary:
        'Short-horizon prediction is limited because recent numeric evidence is not strong enough for a confident projection.',
      projectedValue: null,
      worseningProbability,
      expectedState:
        level === 'critical'
          ? 'Critical state likely persists until the underlying fault clears.'
          : level === 'warning'
            ? 'Watch state likely persists until signal quality improves.'
            : 'Expected to remain stable unless a new anomaly signal appears.',
      stability: signalQuality.label,
    }
  }

  const projectedNumericValue =
    learnedSignalModel.direction === 'stable'
      ? numericValue
      : numericValue + learnedSignalModel.slopePerMs * horizonMs
  const projectedValue = formatNumericValue(projectedNumericValue, displayConfig.engineeringUnit)
  const projectedLevel = evaluateRangeLevel(projectedNumericValue, displayConfig)
  const worseningProbability = clamp(
    (level === 'critical' ? 56 : level === 'warning' ? 22 : 10) +
      (learnedSignalModel.severeDeviation ? 18 : 0) +
      (learnedSignalModel.persistentDrift ? 10 : 0) +
      (learnedSignalModel.settlingBackToBaseline ? -12 : 0) +
      (learnedSignalModel.suddenSpike ? 14 : 0) +
      (projectedLevel === 'critical' ? 18 : projectedLevel === 'warning' ? 8 : -6) +
      (learnedSignalModel.direction === 'rising' ? 8 : learnedSignalModel.direction === 'falling' ? -6 : -4) +
      (signalQuality.label === 'volatile' ? 8 : 0) +
      (signalQuality.label === 'degraded' ? 14 : 0),
    5,
    96,
  )

  const expectedState =
    projectedLevel === 'critical'
      ? 'Critical excursion is likely if the present trajectory continues.'
      : projectedLevel === 'warning'
        ? 'Warning envelope breach is plausible within the short forecast horizon.'
        : learnedSignalModel.settlingBackToBaseline
          ? 'Recovery toward the learned signal band is underway and risk is currently contained.'
        : learnedSignalModel.direction === 'stable'
          ? 'Expected to remain inside the learned operating envelope.'
          : 'Risk looks contained if the present trajectory continues.'

  let summary = ''

  if (learnedSignalModel.direction === 'stable') {
    summary =
      level === 'normal'
        ? `The learned baseline expects stable behavior over ${horizonLabel}.`
        : `Recent evidence is settling, but the current ${level} condition still needs confirmation over ${horizonLabel}.`
  } else if (learnedSignalModel.settlingBackToBaseline) {
    summary = `Recent deviation is easing back toward the learned baseline over ${horizonLabel}.`
  } else if (learnedSignalModel.direction === 'rising') {
    summary =
      projectedLevel === 'critical'
        ? `The learned trend suggests a critical escalation path over ${horizonLabel}.`
        : projectedLevel === 'warning'
          ? `The signal is drifting upward and may deepen its warning posture over ${horizonLabel}.`
          : `The signal is trending upward, but the model still keeps it inside the expected band over ${horizonLabel}.`
  } else {
    summary =
      projectedLevel === 'normal'
        ? `The signal is easing back toward its learned baseline over ${horizonLabel}.`
        : `The signal is moving lower, but elevated residual risk is still expected over ${horizonLabel}.`
  }

  return {
    horizonLabel,
    direction: learnedSignalModel.direction,
    summary,
    projectedValue,
    worseningProbability,
    expectedState,
    stability: signalQuality.label,
  }
}

function buildCurrentRiskScore(
  level: DiagnosticLevel,
  anomalyScore: number,
  signalQuality: PortDiagnosticSignalQuality,
) {
  return clamp(
    Math.round(
      anomalyScore +
        (level === 'critical' ? 10 : level === 'warning' ? 4 : -3) +
        (signalQuality.label === 'volatile' ? 4 : 0) +
        (signalQuality.label === 'degraded' ? 8 : 0),
    ),
    0,
    100,
  )
}

function buildProjectedRiskScore(
  currentRiskScore: number,
  forecast: PortDiagnosticForecast,
) {
  const directionAdjustment =
    forecast.direction === 'rising' ? 10 : forecast.direction === 'falling' ? -6 : -2
  const stabilityAdjustment =
    forecast.stability === 'degraded'
      ? 10
      : forecast.stability === 'volatile'
        ? 6
        : forecast.stability === 'watch'
          ? 2
          : -4

  return clamp(
    Math.round(
      currentRiskScore +
        directionAdjustment +
        stabilityAdjustment +
        (forecast.worseningProbability - 50) * 0.3,
    ),
    0,
    100,
  )
}

function buildProbableCauses(
  reasons: PortDiagnosticReason[],
  forecast: PortDiagnosticForecast,
  specialMeasurementState: SpecialMeasurementState | null,
): PortDiagnosticCause[] {
  const causeMap = new Map<string, PortDiagnosticCause>()

  function upsertCause(cause: PortDiagnosticCause) {
    const existingCause = causeMap.get(cause.title)

    if (!existingCause || existingCause.weight < cause.weight) {
      causeMap.set(cause.title, cause)
    }
  }

  for (const reason of reasons) {
    switch (reason.code) {
      case 'fault':
        upsertCause({
          title: 'Field device or channel fault',
          detail:
            'The master is explicitly reporting a port fault, which strongly suggests a device, wiring, or power-path issue.',
          weight: 96,
        })
        break
      case 'polling_error':
        upsertCause({
          title: 'Communication path instability',
          detail:
            'Polling failures are reducing the freshness of the cached evidence and can mask the true live process condition.',
          weight: 88,
        })
        break
      case 'stale_data':
        upsertCause({
          title: 'Stale cached evidence',
          detail:
            'The intelligence layer is leaning on a last known good snapshot because the refresh cadence has degraded.',
          weight: 74,
        })
        break
      case 'no_snapshot':
        upsertCause({
          title: 'No valid live evidence yet',
          detail:
            'The selected port has not produced a trustworthy cached sample, so diagnostics remain inference-limited.',
          weight: 76,
        })
        break
      case 'invalid_pdi':
        upsertCause({
          title: 'IO-Link process image integrity issue',
          detail:
            'The master does not currently trust the process image, which points to a communication or device-state problem.',
          weight: 82,
        })
        break
      case 'sentinel_value':
        upsertCause({
          title:
            specialMeasurementState?.probableCauseTitle ?? 'Device-reported mapped state',
          detail:
            specialMeasurementState?.probableCauseDetail ??
            'The decoded process field resolved to a configured mapped value rather than a normal engineering measurement.',
          weight: specialMeasurementState?.level === 'critical' ? 82 : 72,
        })
        break
      case 'value_out_of_range':
        upsertCause({
          title: 'Process excursion beyond configured envelope',
          detail:
            'The decoded engineering value is outside the expected operating range for the current port profile.',
          weight: reason.level === 'critical' ? 82 : 68,
        })
        break
      case 'drift':
        upsertCause({
          title: 'Sustained drift from learned baseline',
          detail:
            'Recent samples are persistently outside the learned signal band, which suggests a real process shift or sensor drift rather than normal fine movement.',
          weight: reason.level === 'critical' ? 78 : 62,
        })
        break
      case 'spike':
        upsertCause({
          title: 'Abrupt process disturbance or unstable sensing',
          detail:
            'Recent history shows a fast value excursion that is inconsistent with the learned change band for this signal.',
          weight: reason.level === 'critical' ? 76 : 64,
        })
        break
      case 'flatline':
        upsertCause({
          title: 'Frozen measurement or stalled process',
          detail:
            'The signal has stopped meaningfully changing after showing earlier motion in the same observation window.',
          weight: 58,
        })
        break
      case 'event_code':
        upsertCause({
          title: 'Device-reported event condition',
          detail:
            'The connected device is exposing an active event code that may indicate warning, maintenance, or internal limit behavior.',
          weight: 54,
        })
        break
      default:
        break
    }
  }

  if (forecast.direction === 'rising' && forecast.worseningProbability >= 55) {
    upsertCause({
      title: 'Escalating short-horizon trajectory',
      detail:
        'The short-term forecast indicates the signal is moving toward a higher-risk condition if the present slope continues.',
      weight: 52,
    })
  }

  if (reasons.length === 0) {
    upsertCause({
      title: 'No dominant anomaly driver',
      detail:
        'Current evidence shows the process behaving inside the expected envelope without a strong anomaly signature.',
      weight: 24,
    })
  }

  return [...causeMap.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 4)
}

function buildEvidence(
  snapshot: PortSnapshot,
  displayConfig: PortDisplayConfig,
  featuredPreview: DecodedPreview,
  trendSeries: PortTrendSeries,
  dashboard: AllPortsPdiResponse | null,
  reasons: PortDiagnosticReason[],
  signalQuality: PortDiagnosticSignalQuality,
  numericValue: number | null,
  learnedSignalModel: LearnedSignalModel | null,
  specialMeasurementState: SpecialMeasurementState | null,
): PortDiagnosticEvidence[] {
  const evidence: PortDiagnosticEvidence[] = []
  const polling = dashboard?.polling ?? null

  if (featuredPreview.displayValue) {
    evidence.push({
      label: 'Current decoded reading',
        detail:
        featuredPreview.sentinelLabel !== null
          ? `${displayConfig.label} is currently in the configured mapped state "${featuredPreview.sentinelLabel}".`
          : `Live engineering value is ${featuredPreview.displayValue}${displayConfig.engineeringUnit ? ` ${displayConfig.engineeringUnit}` : ''}.`,
    })
  }

  if (specialMeasurementState?.blocksTrendAnalysis) {
    evidence.push({
      label: specialMeasurementState.evidenceLabel,
      detail: specialMeasurementState.detail,
    })

    evidence.push({
      label: 'Stability analysis status',
      detail:
        'Normal learned-band stability analysis is currently suspended because the live mapped value does not represent a valid measurement.',
    })
  } else if (learnedSignalModel) {
    evidence.push({
      label: 'Learned baseline',
      detail: buildBandDetail(learnedSignalModel, displayConfig),
    })

    evidence.push({
      label: 'Adaptive dwell logic',
      detail: `Warning dwell ${learnedSignalModel.warningDwellSamples} samples, recovery dwell ${learnedSignalModel.recoveryDwellSamples} samples. Fine movement inside the learned band is treated as normal sensor behavior.`,
    })
  }

  if (trendSeries.sampleCount > 1) {
    evidence.push({
      label: 'Recent history support',
      detail: `Using ${trendSeries.sampleCount} cached samples with delta ${formatTrendDelta(trendSeries.delta)} and ${signalQuality.label} signal quality.`,
    })
  } else {
    evidence.push({
      label: 'History coverage',
      detail: 'Recent numeric history is limited, so anomaly confidence is being held back.',
    })
  }

  if (polling) {
    evidence.push({
      label: 'Cache freshness',
      detail:
        polling.is_stale || polling.communication_state === 'polling_error'
          ? `The cached telemetry path is ${polling.communication_state.replace('_', ' ')} with age ${polling.age_ms ?? 'unknown'} ms.`
          : `The cached telemetry path is healthy at ${polling.interval_ms} ms cadence.`,
    })
  }

  if (!specialMeasurementState?.blocksTrendAnalysis && numericValue !== null) {
    const diagnosticSettings = getPortDiagnosticSettings(displayConfig.profileId)
    const activeRange = diagnosticSettings.criticalRange ?? diagnosticSettings.warningRange

    if (activeRange) {
      evidence.push({
        label: 'Envelope comparison',
        detail: buildRangeDetail(
          numericValue,
          activeRange.min,
          activeRange.max,
          displayConfig.engineeringUnit,
        ),
      })
    }
  }

  if (snapshot.pdi?.header.event_code.active) {
    evidence.push({
      label: 'Device event evidence',
      detail: `Active event code ${snapshot.pdi.header.event_code.hex} is being reported by the connected device.`,
    })
  }

  const sentinelReason = reasons.find((reason) => reason.code === 'sentinel_value')
  if (sentinelReason) {
    evidence.push({
      label: 'Customizing Map interpretation',
      detail: specialMeasurementState?.detail ?? sentinelReason.detail,
    })
  }

  return evidence.slice(0, 5)
}

function buildCurrentInterpretation(
  displayConfig: PortDisplayConfig,
  reasons: PortDiagnosticReason[],
  signalQuality: PortDiagnosticSignalQuality,
  forecast: PortDiagnosticForecast,
  currentRiskScore: number,
  projectedRiskScore: number,
  learnedSignalModel: LearnedSignalModel | null,
  specialMeasurementState: SpecialMeasurementState | null,
): string {
  if (specialMeasurementState?.blocksTrendAnalysis) {
    return specialMeasurementState.interpretation
  }

  if (reasons.length === 0) {
    if (learnedSignalModel) {
      return `${displayConfig.label} is stable within its learned band around ${formatNumericValue(learnedSignalModel.baselineValue, displayConfig.engineeringUnit)}. Normal fine movement is still being treated as stable.`
    }

    return `${displayConfig.label} is behaving inside its expected operating envelope with ${signalQuality.label} signal quality.`
  }

  const [topReason] = reasons
  const riskTrend =
    projectedRiskScore >= currentRiskScore + 8
      ? 'rising'
      : projectedRiskScore <= currentRiskScore - 8
        ? 'easing'
        : 'holding'

  switch (topReason.code) {
    case 'drift':
      if (topReason.title === 'Recovery not yet confirmed') {
        return `${displayConfig.label} is moving back inside its learned band, but the model is holding a short recovery dwell so the state does not clear too quickly. Signal quality is ${signalQuality.label}, and short-horizon risk is ${riskTrend}.`
      }

      return `${displayConfig.label} is persistently outside its learned band rather than just showing fine resolution noise. Signal quality is ${signalQuality.label}, and short-horizon risk is ${riskTrend} with a ${forecast.direction} forecast posture.`
    case 'spike':
      return `${displayConfig.label} has produced a step change beyond its learned change band. Signal quality is ${signalQuality.label}, and short-horizon risk is ${riskTrend}.`
    case 'flatline':
      return `${displayConfig.label} has become unusually static relative to its earlier behavior. Signal quality is ${signalQuality.label}, and short-horizon risk is ${riskTrend}.`
    default:
      return `${displayConfig.label} is currently dominated by ${topReason.title.toLowerCase()}. Signal quality is ${signalQuality.label}, and short-horizon risk is ${riskTrend} with a ${forecast.direction} forecast posture.`
  }
}

function buildSuggestedAction(
  reasons: PortDiagnosticReason[],
  forecast: PortDiagnosticForecast,
  signalQuality: PortDiagnosticSignalQuality,
  specialMeasurementState: SpecialMeasurementState | null,
) {
  const baseAction = buildBaseSuggestedAction(reasons, specialMeasurementState)

  if (specialMeasurementState?.blocksTrendAnalysis) {
    return baseAction
  }

  if (forecast.worseningProbability >= 70) {
    return `${baseAction} Prepare for escalation over ${forecast.horizonLabel} if the present trajectory holds.`
  }

  if (signalQuality.label === 'degraded') {
    return `${baseAction} Verify communication quality before making any control decision from this reading.`
  }

  return baseAction
}

export function buildPortDiagnostic(
  snapshot: PortSnapshot,
  displayConfig: PortDisplayConfig,
  featuredPreview: DecodedPreview,
  trendSeries: PortTrendSeries,
  dashboard: AllPortsPdiResponse | null,
): PortDiagnostic {
  const reasons: PortDiagnosticReason[] = []
  const polling = dashboard?.polling ?? null
  const pdi = snapshot.pdi
  const numericValue =
    typeof featuredPreview.scaledValue === 'number' && Number.isFinite(featuredPreview.scaledValue)
      ? featuredPreview.scaledValue
      : null
  const diagnosticSettings = getPortDiagnosticSettings(displayConfig.profileId)
  const specialMeasurementState = detectSpecialMeasurementState(featuredPreview)
  const learnedSignalModel =
    specialMeasurementState?.blocksTrendAnalysis
      ? null
      : buildLearnedSignalModel(trendSeries, displayConfig)

  if (polling?.communication_state === 'polling_error') {
    reasons.push(
      createReason(
        'polling_error',
        polling.has_snapshot ? 'warning' : 'critical',
        'Polling error',
        polling.last_error ??
          'The backend cache worker reported a polling failure while refreshing this snapshot.',
      ),
    )
  }

  if (polling?.is_stale) {
    reasons.push(
      createReason(
        'stale_data',
        'warning',
        'Stale cache',
        polling.age_ms === null
          ? 'The cached telemetry is past its freshness target.'
          : `The cache age is ${polling.age_ms} ms, which is beyond the configured stale threshold.`,
      ),
    )
  }

  if (!pdi) {
    reasons.push(
      createReason(
        'no_snapshot',
        'warning',
        'No snapshot',
        snapshot.error ??
          'The backend has not produced a valid cached snapshot for this port yet.',
      ),
    )
  } else {
    if (pdi.header.port_status.fault) {
      reasons.push(
        createReason(
          'fault',
          'critical',
          'Port fault',
          `The ICE2 reports a ${pdi.header.port_status.fault_severity ?? 'port'} fault on this channel.`,
        ),
      )
    }

    if (!pdi.header.port_status.pdi_valid) {
      reasons.push(
        createReason(
          'invalid_pdi',
          'warning',
          'Invalid PDI',
          'The process data image is not currently marked valid by the master.',
        ),
      )
    }

    if (pdi.header.event_code.active) {
      reasons.push(
        createReason(
          'event_code',
          'warning',
          'Active event code',
          `Device event ${pdi.header.event_code.hex} is active on this port.`,
        ),
      )
    }
  }

  if (featuredPreview.sentinelLabel) {
    reasons.push(
      createReason(
        'sentinel_value',
        specialMeasurementState?.level ?? 'warning',
        specialMeasurementState?.title ?? 'Customizing Map state',
        specialMeasurementState?.detail ??
          `Decoded field resolved to configured mapped text "${featuredPreview.sentinelLabel}" instead of a normal engineering value.`,
      ),
    )
  }

  if (
    !specialMeasurementState?.blocksTrendAnalysis &&
    numericValue !== null &&
    diagnosticSettings.criticalRange &&
    isOutsideRange(
      numericValue,
      diagnosticSettings.criticalRange.min,
      diagnosticSettings.criticalRange.max,
    )
  ) {
    reasons.push(
      createReason(
        'value_out_of_range',
        'critical',
        'Value outside critical range',
        buildRangeDetail(
          numericValue,
          diagnosticSettings.criticalRange.min,
          diagnosticSettings.criticalRange.max,
          displayConfig.engineeringUnit,
        ),
      ),
    )
  } else if (
    !specialMeasurementState?.blocksTrendAnalysis &&
    numericValue !== null &&
    diagnosticSettings.warningRange &&
    isOutsideRange(
      numericValue,
      diagnosticSettings.warningRange.min,
      diagnosticSettings.warningRange.max,
    )
  ) {
    reasons.push(
      createReason(
        'value_out_of_range',
        'warning',
        'Value outside warning range',
        buildRangeDetail(
          numericValue,
          diagnosticSettings.warningRange.min,
          diagnosticSettings.warningRange.max,
          displayConfig.engineeringUnit,
        ),
      ),
    )
  }

  if (learnedSignalModel) {
    if (learnedSignalModel.suddenSpike) {
      reasons.push(
        createReason(
          'spike',
          learnedSignalModel.severeDeviation ? 'critical' : 'warning',
          'Sudden spike beyond expected behavior',
          `Recent step ${formatTrendDelta(learnedSignalModel.latestDelta)} exceeded the learned change band of ${formatNumericValue(learnedSignalModel.spikeThreshold, displayConfig.engineeringUnit)}.`,
        ),
      )
    } else if (
      learnedSignalModel.severeDeviation ||
      learnedSignalModel.persistentDrift ||
      learnedSignalModel.settlingBackToBaseline
    ) {
      reasons.push(
        createReason(
          'drift',
          learnedSignalModel.severeDeviation ? 'critical' : 'warning',
          learnedSignalModel.severeDeviation
            ? 'Significant deviation from learned baseline'
            : learnedSignalModel.settlingBackToBaseline
              ? 'Recovery not yet confirmed'
            : 'Mild drift detected',
          learnedSignalModel.settlingBackToBaseline
            ? `The signal is moving back toward the learned band, but only ${learnedSignalModel.stableRun} of ${learnedSignalModel.recoveryDwellSamples} recovery samples have been observed so far.`
            : buildBandDetail(learnedSignalModel, displayConfig),
        ),
      )
    }

    if (
      pdi &&
      pdi.header.port_status.operational &&
      pdi.header.port_status.pdi_valid &&
      !pdi.header.port_status.fault &&
      learnedSignalModel.flatlineLikely
    ) {
      reasons.push(
        createReason(
          'flatline',
          'warning',
          'Unexpected flatline',
          `Recent variation stayed inside ${formatNumericValue(learnedSignalModel.recoveryBandHalfWidth, displayConfig.engineeringUnit)} after showing earlier motion in the same observation window.`,
        ),
      )
    }
  }

  const orderedReasons = sortReasons(reasons)
  const level = orderedReasons[0]?.level ?? 'normal'
  const signalQuality = buildSignalQuality(
    snapshot,
    trendSeries,
    dashboard,
    learnedSignalModel,
    specialMeasurementState,
  )
  const anomalyScore = buildAnomalyScore(
    orderedReasons,
    signalQuality,
    specialMeasurementState,
  )
  const confidenceScore = buildConfidenceScore(
    snapshot,
    signalQuality,
    trendSeries,
    dashboard,
    learnedSignalModel,
    specialMeasurementState,
  )
  const currentRiskScore = buildCurrentRiskScore(level, anomalyScore, signalQuality)
  const forecast = buildForecast(
    level,
    signalQuality,
    trendSeries,
    displayConfig,
    numericValue,
    learnedSignalModel,
    specialMeasurementState,
  )
  const projectedRiskScore = buildProjectedRiskScore(currentRiskScore, forecast)

  return {
    portNumber: snapshot.portNumber,
    level,
    anomalyScore,
    confidenceScore,
    currentRiskScore,
    projectedRiskScore,
    summary: buildSummary(
      orderedReasons,
      displayConfig,
      learnedSignalModel,
      specialMeasurementState,
    ),
    currentInterpretation: buildCurrentInterpretation(
      displayConfig,
      orderedReasons,
      signalQuality,
      forecast,
      currentRiskScore,
      projectedRiskScore,
      learnedSignalModel,
      specialMeasurementState,
    ),
    suggestedAction: buildSuggestedAction(
      orderedReasons,
      forecast,
      signalQuality,
      specialMeasurementState,
    ),
    reasons: orderedReasons,
    probableCauses: buildProbableCauses(
      orderedReasons,
      forecast,
      specialMeasurementState,
    ),
    evidence: buildEvidence(
      snapshot,
      displayConfig,
      featuredPreview,
      trendSeries,
      dashboard,
      orderedReasons,
      signalQuality,
      numericValue,
      learnedSignalModel,
      specialMeasurementState,
    ),
    forecast,
    signalQuality,
    liveValue: featuredPreview.error ? null : featuredPreview.displayValue,
    liveNumericValue: specialMeasurementState?.blocksTrendAnalysis ? null : numericValue,
    trendStatus: trendSeries.status,
    trendDelta:
      specialMeasurementState?.blocksTrendAnalysis || trendSeries.delta === null
        ? null
        : formatTrendDelta(trendSeries.delta),
  }
}

export function countDiagnosticLevels(
  diagnosticsByPort: Record<number, PortDiagnostic>,
): Record<DiagnosticLevel, number> {
  return Object.values(diagnosticsByPort).reduce(
    (counts, diagnostic) => {
      counts[diagnostic.level] += 1
      return counts
    },
    {
      normal: 0,
      warning: 0,
      critical: 0,
    },
  )
}
