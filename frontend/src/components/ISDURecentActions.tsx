import { memo } from 'react'

import type { IsduOperation } from '../api/types'
import type { StatusTone } from './StatusBadge'
import StatusBadge from './StatusBadge'

export interface ISDURecentActionItem {
  id: string
  operation: IsduOperation
  port: number
  index: number
  subindex: number
  statusLabel: string
  statusTone: StatusTone
  durationMs: number | null
  timestampLabel: string
  summary: string
}

interface ISDURecentActionsProps {
  actions: ISDURecentActionItem[]
  compact?: boolean
}

function formatAddress(index: number, subindex: number) {
  return `0x${index.toString(16).toUpperCase().padStart(4, '0')}:0x${subindex
    .toString(16)
    .toUpperCase()
    .padStart(2, '0')}`
}

function ISDURecentActions({ actions, compact = false }: ISDURecentActionsProps) {
  return (
    <section className={`isdu-recent-actions ${compact ? 'isdu-recent-actions--compact' : ''}`}>
      <div className="isdu-recent-actions__head">
        <div>
          <p className="section-kicker">Recent operations</p>
          <h3 className="section-title">
            {compact ? 'Recent actions' : 'Recent reads and writes'}
          </h3>
        </div>
      </div>

      {actions.length === 0 ? (
        <p className="isdu-recent-actions__empty">
          No ISDU activity yet. Read or write a parameter to populate the console history.
        </p>
      ) : (
        <div className="isdu-recent-actions__list" role="list">
          {actions.map((action) => (
            <article
              key={action.id}
              className="isdu-recent-actions__row"
              role="listitem"
            >
              <div className="isdu-recent-actions__row-main">
                <span className="isdu-recent-actions__cell isdu-recent-actions__cell--time">
                  {action.timestampLabel}
                </span>
                <span className="isdu-recent-actions__cell isdu-recent-actions__cell--port">
                  Port {action.port}
                </span>
                <span className="isdu-recent-actions__cell isdu-recent-actions__cell--address">
                  {formatAddress(action.index, action.subindex)}
                </span>
                <span className="isdu-recent-actions__cell isdu-recent-actions__cell--operation">
                  {action.operation.toUpperCase()}
                </span>
                <div className="isdu-recent-actions__status">
                  <StatusBadge label={action.statusLabel} tone={action.statusTone} />
                </div>
                <span className="isdu-recent-actions__cell isdu-recent-actions__cell--duration">
                  {action.durationMs === null ? '--' : `${action.durationMs} ms`}
                </span>
              </div>

              <p className="isdu-recent-actions__summary">{action.summary}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default memo(ISDURecentActions)
