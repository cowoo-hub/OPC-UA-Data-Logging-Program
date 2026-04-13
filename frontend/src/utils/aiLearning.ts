import type {
  AiLearningModel,
  PortDisplayConfig,
} from '../api/types'
import type { PortTrendSeries } from './history'

const AI_LEARNING_STORAGE_KEY = 'masterway.aiLearningModels.v1'
const MIN_LEARNING_SAMPLES = 6

export const AI_LEARNING_DURATION_OPTIONS = [
  { label: '10 s', value: 10_000 },
  { label: '30 s', value: 30_000 },
  { label: '1 min', value: 60_000 },
  { label: '2 min', value: 120_000 },
  { label: '5 min', value: 300_000 },
]

function median(values: number[]) {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middleIndex = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
    : sorted[middleIndex]
}

function standardDeviation(values: number[], center: number) {
  if (values.length < 2) {
    return 0
  }

  const variance =
    values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
    Math.max(1, values.length - 1)

  return Math.sqrt(variance)
}

export function createEmptyAiLearningModel(): AiLearningModel {
  return {
    status: 'not_started',
    startedAtMs: null,
    targetEndAtMs: null,
    completedAtMs: null,
    durationMs: AI_LEARNING_DURATION_OPTIONS[1].value,
    sampleCount: 0,
    baselineValue: null,
    minimumValue: null,
    maximumValue: null,
    standardDeviation: null,
    mad: null,
    bandHalfWidth: null,
    label: '',
    unit: '',
    message: 'No learned model yet. Use Start Learning while the sensor is in a normal condition.',
  }
}

export function createInitialAiLearningModels(portNumbers: number[]) {
  return portNumbers.reduce<Record<number, AiLearningModel>>((accumulator, portNumber) => {
    accumulator[portNumber] = createEmptyAiLearningModel()
    return accumulator
  }, {})
}

function normalizeModels(raw: unknown, portNumbers: number[]) {
  const fallback = createInitialAiLearningModels(portNumbers)

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const candidate = raw as Record<string, Partial<AiLearningModel>>

  for (const portNumber of portNumbers) {
    const model = candidate[String(portNumber)]

    if (!model || typeof model !== 'object') {
      continue
    }

    fallback[portNumber] = {
      ...fallback[portNumber],
      ...model,
      status:
        model.status === 'learning' ||
        model.status === 'trained' ||
        model.status === 'insufficient_data'
          ? model.status
          : 'not_started',
    }
  }

  return fallback
}

export function loadAiLearningModels(portNumbers: number[]) {
  try {
    const raw = window.localStorage.getItem(AI_LEARNING_STORAGE_KEY)
    return normalizeModels(raw ? JSON.parse(raw) : null, portNumbers)
  } catch {
    return createInitialAiLearningModels(portNumbers)
  }
}

export function saveAiLearningModels(models: Record<number, AiLearningModel>) {
  try {
    window.localStorage.setItem(AI_LEARNING_STORAGE_KEY, JSON.stringify(models))
  } catch {
    // Local storage is an operator convenience, not a critical telemetry path.
  }
}

export function startAiLearningModel(
  previous: AiLearningModel,
  durationMs: number,
  nowMs = Date.now(),
): AiLearningModel {
  return {
    ...createEmptyAiLearningModel(),
    durationMs,
    status: 'learning',
    startedAtMs: nowMs,
    targetEndAtMs: nowMs + durationMs,
    message: `Learning normal signal behavior for ${Math.round(durationMs / 1000)} seconds.`,
    label: previous.label,
    unit: previous.unit,
  }
}

export function resetAiLearningModel(): AiLearningModel {
  return createEmptyAiLearningModel()
}

function completeAiLearningModel(
  model: AiLearningModel,
  trendSeries: PortTrendSeries,
  displayConfig: PortDisplayConfig,
  nowMs = Date.now(),
): AiLearningModel {
  if (
    model.status !== 'learning' ||
    model.startedAtMs === null ||
    model.targetEndAtMs === null ||
    nowMs < model.targetEndAtMs
  ) {
    return model
  }

  const learningPoints = trendSeries.points.filter(
    (point) =>
      point.timestampMs >= model.startedAtMs! &&
      point.timestampMs <= model.targetEndAtMs!,
  )
  const values = learningPoints
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value))

  if (values.length < MIN_LEARNING_SAMPLES) {
    return {
      ...model,
      status: 'insufficient_data',
      completedAtMs: nowMs,
      sampleCount: values.length,
      message: `Learning finished, but only ${values.length} valid samples were captured. Keep polling active and run Start Learning again.`,
    }
  }

  const baselineValue = median(values)
  const deviations = values.map((value) => Math.abs(value - baselineValue))
  const mad = median(deviations)
  const standardDeviationValue = standardDeviation(values, baselineValue)
  const minimumValue = Math.min(...values)
  const maximumValue = Math.max(...values)
  const span = maximumValue - minimumValue
  const resolutionFloor = Math.max(displayConfig.resolutionFactor, 0.0001)
  const bandHalfWidth = Math.max(
    mad * 1.4826 * 4.2,
    standardDeviationValue * 4.2,
    span * 0.55,
    Math.abs(baselineValue) * 0.002,
    resolutionFloor * 4,
    0.0005,
  )

  return {
    ...model,
    status: 'trained',
    completedAtMs: nowMs,
    sampleCount: values.length,
    baselineValue,
    minimumValue,
    maximumValue,
    standardDeviation: standardDeviationValue,
    mad,
    bandHalfWidth,
    label: displayConfig.label,
    unit: displayConfig.engineeringUnit ?? '',
    message: `Signal model trained from ${values.length} samples. Future diagnostics compare this port against its learned normal behavior.`,
  }
}

export function updateCompletedAiLearningModels(
  models: Record<number, AiLearningModel>,
  trendSeriesByPort: Record<number, PortTrendSeries>,
  displayConfigsByPort: Record<number, PortDisplayConfig>,
) {
  let changed = false
  const nextModels = { ...models }
  const nowMs = Date.now()

  for (const [portKey, model] of Object.entries(models)) {
    const portNumber = Number(portKey)
    const trendSeries = trendSeriesByPort[portNumber]
    const displayConfig = displayConfigsByPort[portNumber]

    if (!trendSeries || !displayConfig) {
      continue
    }

    const nextModel = completeAiLearningModel(model, trendSeries, displayConfig, nowMs)

    if (nextModel !== model) {
      nextModels[portNumber] = nextModel
      changed = true
    }
  }

  return changed ? nextModels : models
}
