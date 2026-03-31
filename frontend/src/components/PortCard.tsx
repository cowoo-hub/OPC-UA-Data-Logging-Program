import { memo, useMemo } from 'react'

import type {
  DecodeType,
  DecodedPreview,
  PortSeverity,
  PortSnapshot,
} from '../api/types'
import StatusBadge from './StatusBadge'

interface PortCardProps {
  snapshot: PortSnapshot
  selectedDecodeType: DecodeType
}

const severityLabels: Record<PortSeverity, string> = {
  normal: 'Normal',
  warning: 'Warning',
  critical: 'Critical',
}

const quickDecodeTypes = ['float32', 'uint32', 'int32', 'binary'] as const

function booleanTone(isActive: boolean) {
  return isActive ? 'normal' : 'neutral'
}

function formatRegisters(registers: number[]) {
  if (registers.length === 0) {
    return 'No registers'
  }

  return registers.join(', ')
}

function renderPreviewMeta(preview: DecodedPreview) {
  if (preview.error) {
    return preview.error
  }

  return `Registers ${formatRegisters(preview.sourceRegisters)}`
}

function PortCard({ snapshot, selectedDecodeType }: PortCardProps) {
  const { pdi, severity, portNumber, decodes, error } = snapshot

  const quickDecodes = useMemo(
    () =>
      quickDecodeTypes.map((decodeType) => ({
        decodeType,
        preview: decodes?.[decodeType] ?? null,
      })),
    [decodes],
  )

  const payloadRegisters = useMemo(
    () => formatRegisters(pdi?.payload.registers ?? []),
    [pdi],
  )

  const headerSummary = useMemo(() => {
    if (!pdi) {
      return 'Awaiting backend data'
    }

    return `${pdi.connection.host}:${pdi.connection.port} | ${pdi.pdi_block.mode} block`
  }, [pdi])

  return (
    <article className={`port-card port-card--${severity}`}>
      <header className="port-card__header">
        <div className="port-card__header-copy">
          <p className="port-card__eyebrow">Port {portNumber}</p>
          <h3 className="port-card__title">PDI channel monitor</h3>
          <p className="port-card__target">{headerSummary}</p>
        </div>

        <div className="port-card__badge-stack">
          <StatusBadge label={severityLabels[severity]} tone={severity} />
          <StatusBadge
            label={pdi?.header.port_status.pdi_valid ? 'PDI valid' : 'PDI invalid'}
            tone={
              pdi?.header.port_status.pdi_valid
                ? 'normal'
                : pdi?.header.port_status.fault
                  ? 'critical'
                  : 'warning'
            }
          />
          <StatusBadge
            label={pdi?.header.event_code.active ? pdi.header.event_code.hex : 'No event'}
            tone={pdi?.header.event_code.active ? 'warning' : 'neutral'}
          />
        </div>
      </header>

      {!pdi ? (
        <>
          <div className="metrics-grid metrics-grid--placeholder">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="metric-item metric-item--muted">
                <span className="metric-item__label">Waiting</span>
                <strong className="metric-item__value">--</strong>
              </div>
            ))}
          </div>

          <div className="card-panels">
            <section className="surface-panel surface-panel--decode">
              <div className="surface-panel__header">
                <p className="surface-panel__title">Decoded preview</p>
                <StatusBadge label="Awaiting data" tone="neutral" />
              </div>
              <div className="surface-panel__placeholder">
                <p className="surface-panel__empty-title">Port data unavailable</p>
                <p className="surface-panel__empty-body">
                  {error ?? 'The card is waiting for its first payload sample.'}
                </p>
              </div>
            </section>

            <section className="surface-panel surface-panel--telemetry">
              <div className="surface-panel__header">
                <p className="surface-panel__title">Header detail</p>
                <StatusBadge label="Offline" tone="critical" />
              </div>
              <div className="detail-list">
                <div className="detail-row">
                  <span>Port status</span>
                  <strong>--</strong>
                </div>
                <div className="detail-row">
                  <span>Aux input</span>
                  <strong>--</strong>
                </div>
                <div className="detail-row">
                  <span>Event code</span>
                  <strong>--</strong>
                </div>
                <div className="detail-row">
                  <span>Fault severity</span>
                  <strong>--</strong>
                </div>
              </div>
            </section>
          </div>

          <section className="surface-panel surface-panel--payload">
            <div className="surface-panel__header">
              <p className="surface-panel__title">Payload snapshot</p>
              <StatusBadge label="No payload" tone="neutral" />
            </div>
            <div className="payload-scroll payload-scroll--placeholder">
              <div className="mono-surface mono-surface--compact">No registers</div>
              <div className="mono-surface mono-surface--compact">No payload hex</div>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="metrics-grid">
            <div className="metric-item">
              <span className="metric-item__label">Init</span>
              <StatusBadge
                label={pdi.header.port_status.initialization_active ? 'Active' : 'Idle'}
                tone={booleanTone(pdi.header.port_status.initialization_active)}
              />
            </div>

            <div className="metric-item">
              <span className="metric-item__label">Operational</span>
              <StatusBadge
                label={pdi.header.port_status.operational ? 'Online' : 'Offline'}
                tone={booleanTone(pdi.header.port_status.operational)}
              />
            </div>

            <div className="metric-item">
              <span className="metric-item__label">PDI valid</span>
              <StatusBadge
                label={pdi.header.port_status.pdi_valid ? 'Valid' : 'Invalid'}
                tone={
                  pdi.header.port_status.pdi_valid
                    ? 'normal'
                    : pdi.header.port_status.fault
                      ? 'critical'
                      : 'warning'
                }
              />
            </div>

            <div className="metric-item">
              <span className="metric-item__label">Fault</span>
              <StatusBadge
                label={pdi.header.port_status.fault ? 'Faulted' : 'Clear'}
                tone={pdi.header.port_status.fault ? 'critical' : 'normal'}
              />
            </div>

            <div className="metric-item">
              <span className="metric-item__label">Aux input</span>
              <StatusBadge
                label={pdi.header.auxiliary_input.active ? 'Active' : 'Inactive'}
                tone={booleanTone(pdi.header.auxiliary_input.active)}
              />
            </div>

            <div className="metric-item">
              <span className="metric-item__label">Event raw</span>
              <strong className="metric-item__value">{pdi.header.event_code.raw}</strong>
            </div>
          </div>

          <div className="card-panels">
            <section className="surface-panel surface-panel--decode">
              <div className="surface-panel__header">
                <p className="surface-panel__title">Decoded preview</p>
                <StatusBadge
                  label={selectedDecodeType}
                  tone={decodes?.featured.error ? 'warning' : 'normal'}
                />
              </div>

              <div className="featured-decode">
                <p className="featured-decode__label">Selected decode</p>
                <p className="featured-decode__value">
                  {decodes?.featured.displayValue ?? 'No preview yet'}
                </p>
                <p className="featured-decode__meta">
                  {decodes?.featured
                    ? renderPreviewMeta(decodes.featured)
                    : 'Preview pending'}
                </p>
              </div>

              <div className="decode-grid">
                {quickDecodes.map(({ decodeType, preview }) => (
                  <div key={decodeType} className="decode-cell">
                    <span className="decode-cell__label">{decodeType}</span>
                    <strong className="decode-cell__value">
                      {preview?.displayValue ?? 'Unavailable'}
                    </strong>
                    <span className="decode-cell__meta">
                      {preview ? renderPreviewMeta(preview) : 'No preview'}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="surface-panel surface-panel--telemetry">
              <div className="surface-panel__header">
                <p className="surface-panel__title">Header detail</p>
                <StatusBadge label={pdi.header.port_status.hex} tone={severity} />
              </div>

              <div className="detail-list">
                <div className="detail-row">
                  <span>Port status</span>
                  <strong>{pdi.header.port_status.hex}</strong>
                </div>
                <div className="detail-row">
                  <span>Aux input</span>
                  <strong>{pdi.header.auxiliary_input.hex}</strong>
                </div>
                <div className="detail-row">
                  <span>Event code</span>
                  <strong>{pdi.header.event_code.hex}</strong>
                </div>
                <div className="detail-row">
                  <span>Fault severity</span>
                  <strong>{pdi.header.port_status.fault_severity ?? 'none'}</strong>
                </div>
                <div className="detail-row">
                  <span>Event active</span>
                  <strong>{pdi.header.event_code.active ? 'true' : 'false'}</strong>
                </div>
                <div className="detail-row">
                  <span>Base1 address</span>
                  <strong>{pdi.pdi_block.base1_address}</strong>
                </div>
              </div>
            </section>
          </div>

          <section className="surface-panel surface-panel--payload">
            <div className="surface-panel__header">
              <div>
                <p className="surface-panel__title">Payload snapshot</p>
                <p className="surface-panel__subtext">
                  Base1 {pdi.pdi_block.base1_address} | total words{' '}
                  {pdi.pdi_block.total_word_count}
                </p>
              </div>
              <StatusBadge label={`${pdi.payload.registers.length} words`} tone="neutral" />
            </div>

            <div className="payload-scroll">
              <div className="mono-surface mono-surface--compact">{payloadRegisters}</div>
              <div className="mono-surface mono-surface--compact">
                {pdi.payload.hex || 'No payload hex'}
              </div>
            </div>
          </section>
        </>
      )}
    </article>
  )
}

export default memo(
  PortCard,
  (previousProps, nextProps) =>
    previousProps.snapshot === nextProps.snapshot &&
    previousProps.selectedDecodeType === nextProps.selectedDecodeType,
)
