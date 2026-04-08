import { useEffect, useRef, useState } from 'react'

import { UI_SMOOTHING_STEP_MS } from '../api/client'

interface UseSmoothedNumberOptions {
  durationMs?: number
  disabled?: boolean
  precision?: number
}

function roundToPrecision(value: number, precision: number) {
  return Number(value.toFixed(precision))
}

function easeOutCubic(progress: number) {
  return 1 - (1 - progress) ** 3
}

export function useSmoothedNumber(
  targetValue: number,
  {
    durationMs = 180,
    disabled = false,
    precision = 2,
  }: UseSmoothedNumberOptions = {},
) {
  const [displayValue, setDisplayValue] = useState(targetValue)
  const timeoutRef = useRef<number | null>(null)
  const currentValueRef = useRef(targetValue)

  useEffect(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (disabled || durationMs <= 0) {
      timeoutRef.current = window.setTimeout(() => {
        currentValueRef.current = targetValue
        setDisplayValue(targetValue)
        timeoutRef.current = null
      }, 0)
      return
    }

    const startValue = currentValueRef.current
    const delta = targetValue - startValue

    if (Math.abs(delta) < 0.01) {
      timeoutRef.current = window.setTimeout(() => {
        currentValueRef.current = targetValue
        setDisplayValue(targetValue)
        timeoutRef.current = null
      }, 0)
      return
    }

    const startedAt = performance.now()
    const stepIntervalMs = Math.max(16, Math.min(UI_SMOOTHING_STEP_MS, durationMs))

    const step = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs)
      const easedProgress = easeOutCubic(progress)
      const nextValue = roundToPrecision(startValue + delta * easedProgress, precision)

      currentValueRef.current = nextValue
      setDisplayValue(nextValue)

      if (progress < 1) {
        timeoutRef.current = window.setTimeout(step, stepIntervalMs)
        return
      }

      currentValueRef.current = targetValue
      setDisplayValue(targetValue)
      timeoutRef.current = null
    }

    timeoutRef.current = window.setTimeout(step, stepIntervalMs)

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [disabled, durationMs, precision, targetValue])

  return displayValue
}
