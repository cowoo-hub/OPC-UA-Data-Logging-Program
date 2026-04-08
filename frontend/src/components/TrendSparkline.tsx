import { memo, useId, useMemo } from 'react'

import type { PortSeverity } from '../api/types'
import type { PortTrendSeries } from '../utils/history'
import { formatTrendDelta } from '../utils/history'
import StatusBadge from './StatusBadge'

interface TrendSparklineProps {
  series: PortTrendSeries
  severity: PortSeverity
  windowLabel: string
  variant?: 'default' | 'compact' | 'card'
}

const VIEWBOX_WIDTH = 180
const VIEWBOX_HEIGHT = 64
const CHART_PADDING_X = 0.75
const CHART_PADDING_Y = 8
const SMOOTHING_WEIGHTS = [1, 2, 3, 2, 1] as const
const SMOOTHING_BLEND = 0.68

interface TrendPoint {
  x: number
  y: number
}

function smoothTrendValues(series: PortTrendSeries) {
  if (series.points.length < 4) {
    return series.points
  }

  return series.points.map((point, index, points) => {
    if (index === points.length - 1) {
      return point
    }

    let weightedTotal = 0
    let totalWeight = 0

    for (let offset = -2; offset <= 2; offset += 1) {
      const candidate = points[index + offset]

      if (!candidate) {
        continue
      }

      const weight = SMOOTHING_WEIGHTS[offset + 2]
      weightedTotal += candidate.value * weight
      totalWeight += weight
    }

    if (totalWeight === 0) {
      return point
    }

    const averagedValue = weightedTotal / totalWeight

    return {
      ...point,
      value: point.value * (1 - SMOOTHING_BLEND) + averagedValue * SMOOTHING_BLEND,
    }
  })
}

function buildSmoothPath(points: TrendPoint[]) {
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

function buildTrendPath(
  series: PortTrendSeries,
  {
    paddingX,
    paddingY,
  }: {
    paddingX: number
    paddingY: number
  },
) {
  if (series.points.length === 0) {
    return {
      linePath: '',
      areaPath: '',
    }
  }

  const smoothedSeriesPoints = smoothTrendValues(series)
  const smoothedValues = smoothedSeriesPoints.map((point) => point.value)
  const minValue = smoothedValues.length > 0 ? Math.min(...smoothedValues) : series.minimumValue ?? 0
  const maxValue =
    smoothedValues.length > 0 ? Math.max(...smoothedValues) : series.maximumValue ?? minValue
  const rawValueRange = maxValue - minValue
  const valuePadding =
    rawValueRange === 0
      ? Math.max(Math.abs(maxValue) * 0.08, 1)
      : rawValueRange * 0.12
  const domainMin = minValue - valuePadding
  const domainMax = maxValue + valuePadding
  const valueRange = domainMax - domainMin || 1
  const drawableWidth = VIEWBOX_WIDTH - paddingX * 2
  const drawableHeight = VIEWBOX_HEIGHT - paddingY * 2
  const oldestTimestampMs = series.oldestTimestampMs ?? series.points[0]?.timestampMs ?? 0
  const latestTimestampMs =
    series.latestTimestampMs ?? series.points.at(-1)?.timestampMs ?? oldestTimestampMs
  const timeRange = latestTimestampMs - oldestTimestampMs || 1

  const chartPoints = smoothedSeriesPoints.map((point) => {
    const x =
      paddingX +
      (smoothedSeriesPoints.length === 1
        ? drawableWidth
        : ((point.timestampMs - oldestTimestampMs) / timeRange) * drawableWidth)
    const y =
      paddingY +
      drawableHeight -
      ((point.value - domainMin) / valueRange) * drawableHeight

    return {
      x,
      y,
    }
  })

  const linePath = buildSmoothPath(chartPoints)

  const areaPath = [
    linePath,
    `L ${chartPoints.at(-1)?.x ?? paddingX} ${VIEWBOX_HEIGHT - paddingY}`,
    `L ${chartPoints[0]?.x ?? paddingX} ${VIEWBOX_HEIGHT - paddingY}`,
    'Z',
  ].join(' ')

  return {
    linePath,
    areaPath,
  }
}

function TrendSparkline({
  series,
  severity,
  windowLabel,
  variant = 'default',
}: TrendSparklineProps) {
  const isCard = variant === 'card'
  const chartPaddingX = isCard ? 0 : CHART_PADDING_X
  const chartPaddingY = CHART_PADDING_Y
  const gradientId = useId()
  const chartPaths = useMemo(
    () =>
      buildTrendPath(series, {
        paddingX: chartPaddingX,
        paddingY: chartPaddingY,
      }),
    [chartPaddingX, chartPaddingY, series],
  )
  const trendTone =
    series.status === 'unavailable'
      ? 'neutral'
      : series.status === 'fallback'
        ? 'warning'
        : 'normal'
  const trendLabel =
    series.status === 'unavailable'
      ? 'No trend'
      : series.status === 'fallback'
        ? `${series.decodeType}`
        : `${series.decodeType}`

  return (
    <section
      className={`trend-sparkline trend-sparkline--${severity} trend-sparkline--${variant}`}
    >
      {!isCard ? (
        <div className="trend-sparkline__header">
          <div>
            <p className="trend-sparkline__label">Trend</p>
            <p className="trend-sparkline__meta">
              {windowLabel} | {series.sampleCount} pts
            </p>
          </div>
          <StatusBadge label={trendLabel} tone={trendTone} />
        </div>
      ) : null}

      <div className="trend-sparkline__canvas">
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
          shapeRendering="geometricPrecision"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1={chartPaddingX}
              x2={VIEWBOX_WIDTH - chartPaddingX}
              y1={chartPaddingY + (VIEWBOX_HEIGHT - chartPaddingY * 2) * ratio}
              y2={chartPaddingY + (VIEWBOX_HEIGHT - chartPaddingY * 2) * ratio}
              className="trend-sparkline__grid-line"
            />
          ))}

          {chartPaths.areaPath ? (
            <path d={chartPaths.areaPath} fill={`url(#${gradientId})`} className="trend-sparkline__area" />
          ) : null}

          {chartPaths.linePath ? (
            <>
              <path d={chartPaths.linePath} className="trend-sparkline__line-glow" />
              <path d={chartPaths.linePath} className="trend-sparkline__line" />
            </>
          ) : (
            <line
              x1={chartPaddingX}
              x2={VIEWBOX_WIDTH - chartPaddingX}
              y1={VIEWBOX_HEIGHT / 2}
              y2={VIEWBOX_HEIGHT / 2}
              className="trend-sparkline__line trend-sparkline__line--placeholder"
            />
          )}
        </svg>
      </div>

      {!isCard ? (
        <div className="trend-sparkline__footer">
          <span className="trend-sparkline__stat">
            Latest {series.latestValue === null ? '--' : series.latestValue.toFixed(3).replace(/\.?0+$/, '')}
          </span>
          <span className="trend-sparkline__stat">
            Delta {formatTrendDelta(series.delta)}
          </span>
        </div>
      ) : null}
    </section>
  )
}

export default memo(TrendSparkline)
