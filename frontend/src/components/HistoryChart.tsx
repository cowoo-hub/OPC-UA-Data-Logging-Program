import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { PortSeverity } from '../api/types'
import { UI_INTERPOLATION_INTERVAL_MS } from '../api/client'
import type { PortTrendSeries } from '../utils/history'
import {
  formatHistoryAxisTime,
  formatHistoryWindow,
  formatTrendDelta,
} from '../utils/history'
import StatusBadge from './StatusBadge'

interface HistoryChartProps {
  series: PortTrendSeries
  severity: PortSeverity
  windowMs: number
}

const VIEWBOX_WIDTH = 560
const VIEWBOX_HEIGHT = 196
const TOP_PADDING = 10
const BOTTOM_PADDING = 12
const MARKER_RADIUS = 3.6
const TICK_RATIOS = [0, 1 / 3, 2 / 3, 1]

interface ChartPoint {
  x: number
  y: number
}

function buildSmoothPath(points: ChartPoint[]) {
  if (points.length === 0) {
    return ''
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }

  let path = `M ${points[0].x} ${points[0].y}`

  for (let index = 0; index < points.length - 1; index += 1) {
    const previousPoint = points[index - 1] ?? points[index]
    const currentPoint = points[index]
    const nextPoint = points[index + 1]
    const upcomingPoint = points[index + 2] ?? nextPoint
    const controlPoint1X = currentPoint.x + (nextPoint.x - previousPoint.x) / 6
    const controlPoint1Y = currentPoint.y + (nextPoint.y - previousPoint.y) / 6
    const controlPoint2X = nextPoint.x - (upcomingPoint.x - currentPoint.x) / 6
    const controlPoint2Y = nextPoint.y - (upcomingPoint.y - currentPoint.y) / 6

    path += ` C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${nextPoint.x} ${nextPoint.y}`
  }

  return path
}

function formatValue(value: number | null) {
  if (value === null) {
    return '--'
  }

  return value.toFixed(3).replace(/\.?0+$/, '')
}

function useStreamingCursorMs(latestTimestampMs: number | null) {
  const [cursorState, setCursorState] = useState(() => ({
    anchorMs: latestTimestampMs ?? 0,
    elapsedMs: 0,
  }))
  const anchorRef = useRef({
    sourceTimestampMs: latestTimestampMs ?? 0,
    startedAtMs: 0,
  })

  useEffect(() => {
    if (latestTimestampMs === null) {
      anchorRef.current = {
        sourceTimestampMs: 0,
        startedAtMs: 0,
      }
      return
    }

    const initialTimestampMs = latestTimestampMs ?? Date.now()
    anchorRef.current = {
      sourceTimestampMs: initialTimestampMs,
      startedAtMs: performance.now(),
    }

    const step = () => {
      const elapsedMs = performance.now() - anchorRef.current.startedAtMs
      setCursorState({
        anchorMs: anchorRef.current.sourceTimestampMs,
        elapsedMs,
      })
    }

    const intervalId = window.setInterval(step, UI_INTERPOLATION_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [latestTimestampMs])

  if (latestTimestampMs === null) {
    return 0
  }

  if (cursorState.anchorMs !== latestTimestampMs) {
    return latestTimestampMs
  }

  return cursorState.anchorMs + cursorState.elapsedMs
}

function buildChartGeometry(
  series: PortTrendSeries,
  windowMs: number,
  cursorMs: number,
) {
  if (series.points.length === 0) {
    return {
      areaPath: '',
      linePath: '',
      latestX: VIEWBOX_WIDTH / 2,
      latestY: VIEWBOX_HEIGHT / 2,
      tickPositions: TICK_RATIOS.map((ratio) => ratio * VIEWBOX_WIDTH),
      axisLabels: TICK_RATIOS.map(() => '--:--:--'),
    }
  }

  const domainEndMs = Math.max(cursorMs, series.latestTimestampMs ?? cursorMs)
  const domainStartMs = domainEndMs - windowMs
  const minimumValue = series.minimumValue ?? 0
  const maximumValue = series.maximumValue ?? minimumValue
  const valueRange = maximumValue - minimumValue || 1
  const drawableHeight = VIEWBOX_HEIGHT - TOP_PADDING - BOTTOM_PADDING
  const filteredPoints = series.points.filter(
    (point) => point.timestampMs >= domainStartMs && point.timestampMs <= domainEndMs,
  )

  if (filteredPoints.length === 0) {
    return {
      areaPath: '',
      linePath: '',
      latestX: VIEWBOX_WIDTH / 2,
      latestY: VIEWBOX_HEIGHT / 2,
      tickPositions: TICK_RATIOS.map((ratio) => ratio * VIEWBOX_WIDTH),
      axisLabels: TICK_RATIOS.map((ratio) =>
        formatHistoryAxisTime(domainStartMs + windowMs * ratio),
      ),
    }
  }

  const plotPoints = filteredPoints.map((point) => {
    const x =
      ((point.timestampMs - domainStartMs) / windowMs) * VIEWBOX_WIDTH
    const clampedX = Math.max(0, Math.min(VIEWBOX_WIDTH, x))
    const y =
      TOP_PADDING +
      drawableHeight -
      ((point.value - minimumValue) / valueRange) * drawableHeight

    return {
      x: clampedX,
      y,
    }
  })

  const linePath = buildSmoothPath(plotPoints)
  const lastPoint = plotPoints.at(-1)
  const firstPoint = plotPoints[0]
  const baselineY = VIEWBOX_HEIGHT - BOTTOM_PADDING
  const areaPath =
    linePath && lastPoint && firstPoint
      ? [linePath, `L ${lastPoint.x} ${baselineY}`, `L ${firstPoint.x} ${baselineY}`, 'Z'].join(
          ' ',
        )
      : ''

  return {
    areaPath,
    linePath,
    latestX: lastPoint?.x ?? VIEWBOX_WIDTH / 2,
    latestY: lastPoint?.y ?? VIEWBOX_HEIGHT / 2,
    tickPositions: TICK_RATIOS.map((ratio) => ratio * VIEWBOX_WIDTH),
    axisLabels: TICK_RATIOS.map((ratio) =>
      formatHistoryAxisTime(domainStartMs + windowMs * ratio),
    ),
  }
}

function HistoryChart({ series, severity, windowMs }: HistoryChartProps) {
  const gradientId = useId()
  const cursorMs = useStreamingCursorMs(series.latestTimestampMs)
  const geometry = useMemo(
    () => buildChartGeometry(series, windowMs, cursorMs),
    [cursorMs, series, windowMs],
  )
  const tone =
    series.status === 'unavailable'
      ? 'neutral'
      : series.status === 'fallback'
        ? 'warning'
        : severity
  const trendLabel =
    series.status === 'unavailable'
      ? 'No numeric trend'
      : series.status === 'fallback'
        ? `Fallback ${series.decodeType}`
        : `${series.decodeType} live`

  return (
    <section className={`history-chart history-chart--${severity}`}>
      <div className="history-chart__header">
        <div>
          <p className="section-kicker">Recent history</p>
          <h4 className="section-title">Window {formatHistoryWindow(windowMs)}</h4>
        </div>
        <StatusBadge label={trendLabel} tone={tone} />
      </div>

      <div className="history-chart__stats">
        <div className="history-chart__stat">
          <span>Latest</span>
          <strong>{formatValue(series.latestValue)}</strong>
        </div>
        <div className="history-chart__stat">
          <span>Delta</span>
          <strong>{formatTrendDelta(series.delta)}</strong>
        </div>
        <div className="history-chart__stat">
          <span>Range</span>
          <strong>
            {formatValue(series.minimumValue)} to {formatValue(series.maximumValue)}
          </strong>
        </div>
        <div className="history-chart__stat">
          <span>Samples</span>
          <strong>{series.sampleCount}</strong>
        </div>
      </div>

      <div className="history-chart__canvas">
        <div className="history-chart__viewport">
          <svg
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            shapeRendering="geometricPrecision"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {geometry.tickPositions.map((x, index) => (
              <line
                key={`v-${x}-${index}`}
                x1={x}
                x2={x}
                y1={TOP_PADDING}
                y2={VIEWBOX_HEIGHT - BOTTOM_PADDING}
                className="history-chart__grid-line history-chart__grid-line--vertical"
              />
            ))}

            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <line
                key={`h-${ratio}`}
                x1={0}
                x2={VIEWBOX_WIDTH}
                y1={TOP_PADDING + (VIEWBOX_HEIGHT - TOP_PADDING - BOTTOM_PADDING) * ratio}
                y2={TOP_PADDING + (VIEWBOX_HEIGHT - TOP_PADDING - BOTTOM_PADDING) * ratio}
                className="history-chart__grid-line"
              />
            ))}

            <line
              x1={0}
              x2={VIEWBOX_WIDTH}
              y1={VIEWBOX_HEIGHT - BOTTOM_PADDING}
              y2={VIEWBOX_HEIGHT - BOTTOM_PADDING}
              className="history-chart__baseline"
            />

            {geometry.areaPath ? (
              <path d={geometry.areaPath} fill={`url(#${gradientId})`} className="history-chart__area" />
            ) : null}

            {geometry.linePath ? (
              <>
                <path d={geometry.linePath} className="history-chart__line" />
                <circle
                  cx={geometry.latestX}
                  cy={geometry.latestY}
                  r={MARKER_RADIUS}
                  className="history-chart__marker"
                />
              </>
            ) : (
              <line
                x1={0}
                x2={VIEWBOX_WIDTH}
                y1={VIEWBOX_HEIGHT / 2}
                y2={VIEWBOX_HEIGHT / 2}
                className="history-chart__line history-chart__line--placeholder"
              />
            )}
          </svg>
        </div>
      </div>

      <div className="history-chart__axis" aria-hidden="true">
        {geometry.axisLabels.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className={`history-chart__axis-label history-chart__axis-label--${index}`}
            title={label}
          >
            {label}
          </span>
        ))}
      </div>
    </section>
  )
}

export default memo(HistoryChart)
