import { memo, useId, useMemo } from 'react'

import type { DiagnosticLevel } from '../api/types'
import type { PortTrendSeries } from '../utils/history'

interface AIWaveFieldProps {
  series: PortTrendSeries
  level: DiagnosticLevel
}

interface WavePoint {
  x: number
  y: number
}

const VIEWBOX_WIDTH = 920
const VIEWBOX_HEIGHT = 276
const CENTER_Y = VIEWBOX_HEIGHT / 2
const SAMPLE_TARGET = 54
const CENTER_GAP_RADIUS = 116

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function buildSmoothPath(points: WavePoint[]) {
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

function getSampledValues(series: PortTrendSeries) {
  if (series.points.length === 0) {
    return Array.from({ length: SAMPLE_TARGET }, (_, index) => {
      const ratio = index / Math.max(1, SAMPLE_TARGET - 1)
      return 0.48 + Math.sin(ratio * Math.PI * 2.6) * 0.16
    })
  }

  const minimumValue = series.minimumValue ?? 0
  const maximumValue = series.maximumValue ?? minimumValue
  const valueRange = maximumValue - minimumValue || 1

  return Array.from({ length: SAMPLE_TARGET }, (_, index) => {
    const sourceIndex = Math.round((index / (SAMPLE_TARGET - 1)) * (series.points.length - 1))
    const point = series.points[sourceIndex]
    const normalized = point ? (point.value - minimumValue) / valueRange : 0.5
    return clamp(normalized, 0, 1)
  })
}

function buildWaveGeometry(series: PortTrendSeries) {
  const sampledValues = getSampledValues(series)
  const centerline: WavePoint[] = []
  const upperRibbon: WavePoint[] = []
  const lowerRibbon: WavePoint[] = []
  const accentRibbon: WavePoint[] = []

  for (let index = 0; index < SAMPLE_TARGET; index += 1) {
    const ratio = index / (SAMPLE_TARGET - 1)
    const x = ratio * VIEWBOX_WIDTH
    const sample = sampledValues[index] ?? 0.5
    const harmonicOffset =
      Math.sin(ratio * Math.PI * 3.2) * 10 +
      Math.cos(ratio * Math.PI * 1.6) * 6
    const signalOffset = (sample - 0.5) * 34
    const centerlineY = CENTER_Y + harmonicOffset + signalOffset
    const distanceFromCenter = Math.abs(x - VIEWBOX_WIDTH / 2)
    const flattenFactor = clamp(distanceFromCenter / CENTER_GAP_RADIUS, 0.08, 1)
    const refinedCenterlineY = CENTER_Y + (centerlineY - CENTER_Y) * flattenFactor
    const ribbonHalfThickness =
      (20 + sample * 14 + Math.sin(ratio * Math.PI * 1.8) * 3) * flattenFactor

    centerline.push({
      x,
      y: clamp(refinedCenterlineY, 52, VIEWBOX_HEIGHT - 52),
    })
    upperRibbon.push({
      x,
      y: clamp(refinedCenterlineY - ribbonHalfThickness, 36, VIEWBOX_HEIGHT - 72),
    })
    lowerRibbon.push({
      x,
      y: clamp(refinedCenterlineY + ribbonHalfThickness, 72, VIEWBOX_HEIGHT - 36),
    })
    accentRibbon.push({
      x,
      y: clamp(refinedCenterlineY - 7 * flattenFactor, 44, VIEWBOX_HEIGHT - 44),
    })
  }

  const upperPath = buildSmoothPath(upperRibbon)
  const lowerPath = buildSmoothPath(lowerRibbon)
  const fillPath = `${upperPath} ${lowerPath.replace(/^M/, 'L')} Z`

  return {
    fillPath,
    centerlinePath: buildSmoothPath(centerline),
    accentPath: buildSmoothPath(accentRibbon),
  }
}

function AIWaveField({ series, level }: AIWaveFieldProps) {
  const geometry = useMemo(() => buildWaveGeometry(series), [series])
  const fillGradientId = useId()
  const lineGradientId = useId()
  const bloomGradientId = useId()

  return (
    <div className={`ai-wave-field ai-wave-field--${level}`} aria-hidden="true">
      <svg
        className="ai-wave-field__svg"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        shapeRendering="geometricPrecision"
      >
        <defs>
          <linearGradient id={fillGradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#d9f7ff" stopOpacity="0.06" />
            <stop offset="38%" stopColor="#b8efff" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#79d7ff" stopOpacity="0.03" />
          </linearGradient>
          <linearGradient id={lineGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ccf7ff" stopOpacity="0.1" />
            <stop offset="20%" stopColor="#dffaff" stopOpacity="0.72" />
            <stop offset="50%" stopColor="#a9ecff" stopOpacity="1" />
            <stop offset="80%" stopColor="#dffaff" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#ccf7ff" stopOpacity="0.1" />
          </linearGradient>
          <radialGradient id={bloomGradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#c8f7ff" stopOpacity="0.26" />
            <stop offset="55%" stopColor="#8ddfff" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#8ddfff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse
          cx={VIEWBOX_WIDTH / 2}
          cy={CENTER_Y}
          rx="228"
          ry="98"
          fill={`url(#${bloomGradientId})`}
          className="ai-wave-field__bloom"
        />

        {[0.22, 0.5, 0.78].map((ratio) => (
          <line
            key={ratio}
            x1="0"
            x2={VIEWBOX_WIDTH}
            y1={VIEWBOX_HEIGHT * ratio}
            y2={VIEWBOX_HEIGHT * ratio}
            className="ai-wave-field__grid"
          />
        ))}

        <path d={geometry.fillPath} fill={`url(#${fillGradientId})`} className="ai-wave-field__ribbon" />
        <path d={geometry.centerlinePath} className="ai-wave-field__line ai-wave-field__line--halo" />
        <path d={geometry.accentPath} stroke={`url(#${lineGradientId})`} className="ai-wave-field__line ai-wave-field__line--accent" />
        <path d={geometry.centerlinePath} stroke={`url(#${lineGradientId})`} className="ai-wave-field__line" />

        <rect
          x="-240"
          y="0"
          width="240"
          height={VIEWBOX_HEIGHT}
          fill={`url(#${lineGradientId})`}
          className="ai-wave-field__scan"
        />
      </svg>
    </div>
  )
}

export default memo(AIWaveField)
