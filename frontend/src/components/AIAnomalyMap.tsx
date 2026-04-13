import { memo } from 'react'

import type { DiagnosticLevel } from '../api/types'
import StatusBadge from './StatusBadge'

interface AIAnomalyMapItem {
  portNumber: number
  level: DiagnosticLevel
  title: string
  summary: string
  aiScore: number
}

interface AIAnomalyMapProps {
  items: AIAnomalyMapItem[]
  selectedPortNumber: number
  onSelect: (portNumber: number) => void
}

function AIAnomalyMap({
  items,
  selectedPortNumber,
  onSelect,
}: AIAnomalyMapProps) {
  return (
    <section className="ai-holo-panel ai-holo-panel--ports">
      <div className="ai-holo-panel__head">
        <div>
          <p className="section-kicker">Port intelligence</p>
        </div>
      </div>

      <div className="ai-port-list">
        {items.map((item) => (
          <button
            key={item.portNumber}
            type="button"
            className={`ai-port-list__item ai-port-list__item--${item.level} ${
              item.portNumber === selectedPortNumber ? 'ai-port-list__item--selected' : ''
            }`}
            onClick={() => onSelect(item.portNumber)}
          >
            <div className="ai-port-list__identity">
              <strong className="ai-port-list__title">{item.title}</strong>
              <p className="ai-port-list__summary" title={item.summary}>
                {item.summary}
              </p>
            </div>

            <div className="ai-port-list__meta">
              <StatusBadge label={item.level} tone={item.level} />
              <span className="ai-port-list__score">AI score {item.aiScore}%</span>
            </div>
          </button>
        ))}
      </div>

      <div className="ai-port-brain" aria-hidden="true">
        <svg viewBox="0 0 220 150" role="img">
          <defs>
            <radialGradient id="brainGlow" cx="50%" cy="48%" r="55%">
              <stop offset="0%" stopColor="rgba(125, 255, 217, 0.52)" />
              <stop offset="64%" stopColor="rgba(100, 220, 255, 0.16)" />
              <stop offset="100%" stopColor="rgba(100, 220, 255, 0)" />
            </radialGradient>
            <linearGradient id="brainStroke" x1="18%" y1="12%" x2="82%" y2="92%">
              <stop offset="0%" stopColor="rgba(149, 255, 226, 0.78)" />
              <stop offset="48%" stopColor="rgba(100, 220, 255, 0.72)" />
              <stop offset="100%" stopColor="rgba(126, 176, 228, 0.28)" />
            </linearGradient>
          </defs>
          <ellipse cx="110" cy="76" rx="82" ry="54" fill="url(#brainGlow)" />
          <path
            d="M70 92c-18-4-30-18-30-36 0-20 15-34 34-35 8-13 25-18 41-11 14-8 32-5 42 8 18 1 32 16 32 34 0 19-13 35-32 39-10 16-32 22-49 10-14 9-29 6-38-9Z"
            fill="rgba(9, 19, 30, 0.46)"
            stroke="url(#brainStroke)"
            strokeWidth="2"
          />
          <path
            d="M72 82c12-16 18-20 34-17 15 3 25-1 38-15M80 50c13 9 25 10 41 2M100 101c1-18 3-29 12-41M134 96c-7-16-4-27 11-38M58 63h32M151 75h31M72 92h-22M166 90h-28"
            fill="none"
            stroke="rgba(154, 239, 255, 0.42)"
            strokeLinecap="round"
            strokeWidth="1.6"
          />
          <g fill="rgba(125, 255, 217, 0.82)">
            <circle cx="80" cy="50" r="3" />
            <circle cx="107" cy="65" r="3" />
            <circle cx="145" cy="58" r="3" />
            <circle cx="134" cy="96" r="3" />
            <circle cx="72" cy="92" r="3" />
            <circle cx="182" cy="75" r="2.4" />
            <circle cx="50" cy="92" r="2.4" />
          </g>
          <g className="ai-port-brain__sparkles" fill="rgba(198, 255, 243, 0.9)">
            <circle cx="42" cy="34" r="1.6" />
            <circle cx="180" cy="32" r="1.4" />
            <circle cx="198" cy="112" r="1.5" />
            <circle cx="30" cy="112" r="1.2" />
            <circle cx="111" cy="22" r="1.2" />
          </g>
        </svg>
        <span>Neural process core</span>
      </div>
    </section>
  )
}

export default memo(AIAnomalyMap)
