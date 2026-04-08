import { memo, useMemo, useState } from 'react'

import type {
  IoddIsduVariable,
  IsduOperationResponse,
  IsduPreviewSource,
  IsduReadResponse,
} from '../api/types'
import {
  formatIsduDevicePortDebug,
  formatIsduRequestFramePreview,
  formatIsduRawResponsePreview,
  formatIsduTimestamp,
  formatIsduUserPort,
  resolveIsduDecodedValue,
  type IsduReadDisplayType,
  type IsduWriteEncoding,
} from '../utils/isdu'
import ISDURecentActions, { type ISDURecentActionItem } from './ISDURecentActions'
import StatusBadge from './StatusBadge'

interface ISDUResultPanelProps {
  result: IsduOperationResponse | null
  resultMatchedIoddVariable: IoddIsduVariable | null
  verificationResult: IsduReadResponse | null
  verificationMatchedIoddVariable: IoddIsduVariable | null
  verificationError: string | null
  transientError: string | null
  lastCompletedAt: string | null
  recentActions: ISDURecentActionItem[]
  readDisplayType: IsduReadDisplayType
  writeEncoding: IsduWriteEncoding
}

function formatNullable(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '--'
  }

  return String(value)
}

function countHexBytes(value: string | null | undefined) {
  if (!value) {
    return 0
  }

  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

function getResultTone(result: IsduOperationResponse | null) {
  if (!result) {
    return 'neutral' as const
  }

  if (result.response.timed_out) {
    return 'warning' as const
  }

  return result.response.ok ? ('normal' as const) : ('critical' as const)
}

function getResultLabel(result: IsduOperationResponse | null) {
  if (!result) {
    return 'Idle'
  }

  if (result.response.timed_out) {
    return 'Timeout'
  }

  if (result.response.ok) {
    return result.request.operation === 'write' ? 'Write OK' : 'Read OK'
  }

  return 'Operation error'
}

function getPreviewSourceLabel(previewSource: IsduPreviewSource | null) {
  switch (previewSource) {
    case 'response':
      return 'Response payload'
    case 'request':
      return 'Request payload'
    default:
      return 'No preview'
  }
}

function getVerificationLabel(verificationResult: IsduReadResponse | null) {
  if (!verificationResult) {
    return 'Not run'
  }

  return verificationResult.response.ok ? 'Verified' : 'Needs review'
}

function ISDUResultPanel({
  result,
  resultMatchedIoddVariable,
  verificationResult,
  verificationMatchedIoddVariable,
  verificationError,
  transientError,
  lastCompletedAt,
  recentActions,
  readDisplayType,
  writeEncoding,
}: ISDUResultPanelProps) {
  const [showAdvancedDebug, setShowAdvancedDebug] = useState(false)
  const tone = getResultTone(result)
  const label = getResultLabel(result)
  const primaryValue = useMemo(
    () =>
      resolveIsduDecodedValue({
        result,
        readDisplayType,
        matchedVariable: resultMatchedIoddVariable,
        writeEncoding,
      }),
    [readDisplayType, result, resultMatchedIoddVariable, writeEncoding],
  )
  const requestFrameText = useMemo(() => {
    if (!result) {
      return null
    }

    return formatIsduRequestFramePreview(result.request)
  }, [result])
  const rawResponseText = useMemo(() => {
    if (!result) {
      return null
    }

    return formatIsduRawResponsePreview(result)
  }, [result])
  const payloadByteCount = useMemo(() => {
    if (!result) {
      return 0
    }

    return (
      result.preview?.byte_count ??
      countHexBytes(result.response.data_hex) ??
      countHexBytes(result.request.data_hex)
    )
  }, [result])
  const supportCards = useMemo(() => {
    if (!result) {
      return []
    }

    return [
      {
        label: 'Address lane',
        value: formatIsduUserPort(result.request.port),
        meta: formatIsduDevicePortDebug(result.request.device_port),
      },
      {
        label: 'Payload',
        value: payloadByteCount === 0 ? 'No bytes' : `${payloadByteCount} byte(s)`,
        meta: getPreviewSourceLabel(result.preview_source),
      },
      {
        label: 'Decode mode',
        value: primaryValue.typeLabel,
        meta:
          result.request.operation === 'write'
            ? `Write payload interpreted as ${primaryValue.typeLabel}`
            : readDisplayType === 'auto'
              ? `Auto-resolved${resultMatchedIoddVariable ? ` from ${resultMatchedIoddVariable.name}` : ''}`
              : `Manual read decode selection`,
      },
      {
        label: 'Verification',
        value: getVerificationLabel(verificationResult),
        meta:
          verificationResult?.response.status ??
          verificationError ??
          (result.request.operation === 'write'
            ? 'Read-back available after writes'
            : 'Read operation only'),
      },
      {
        label: 'Console note',
        value: 'Raw response keeps protocol details readable.',
        meta: 'User-facing port stays 1-based; internal device index is debug-only.',
      },
    ]
  }, [
    payloadByteCount,
    primaryValue.typeLabel,
    readDisplayType,
    result,
    resultMatchedIoddVariable,
    verificationError,
    verificationResult,
  ])

  return (
    <section className="overview-panel overview-panel--isdu-console">
      <div className="overview-panel__head">
        <div>
          <p className="section-kicker">Result</p>
          <h2 className="section-title">Decoded reply</h2>
        </div>
        <StatusBadge label={label} tone={tone} />
      </div>

      {!result ? (
        <div className="isdu-result-panel__empty">
          <p className="page-description">
            Run an ISDU read or write to inspect the request, reply, and decoded value.
          </p>
          {transientError ? (
            <div className="isdu-inline-error isdu-inline-error--critical">
              {transientError}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="isdu-result-panel__console">
          <div className="isdu-result-panel__hero">
            <div className="isdu-result-panel__hero-value">
              <span className="isdu-result-panel__hero-label">Decoded value</span>
              <strong className="isdu-result-panel__hero-reading">
                {primaryValue.displayValue}
              </strong>
              {primaryValue.secondaryValue ? (
                <span className="isdu-result-panel__hero-secondary">
                  Numeric value {primaryValue.secondaryValue}
                </span>
              ) : null}
              <span className="isdu-result-panel__hero-meta">
                {result.request.operation.toUpperCase()} |{' '}
                {formatIsduUserPort(result.request.port)} | Index {result.request.index} | Sub{' '}
                {result.request.subindex} | {primaryValue.typeLabel}
              </span>
            </div>

            <div className="isdu-result-panel__hero-stats">
              <div className="overview-debug-card">
                <span className="overview-debug-card__label">Result status</span>
                <strong className="overview-debug-card__value">{result.response.status}</strong>
                <span className="overview-debug-card__meta">
                  {result.duration_ms} ms | {result.request.operation.toUpperCase()}
                </span>
              </div>

              <div className="overview-debug-card">
                <span className="overview-debug-card__label">Preview source</span>
                <strong className="overview-debug-card__value">
                  {getPreviewSourceLabel(result.preview_source)}
                </strong>
                <span className="overview-debug-card__meta">
                  {formatIsduTimestamp(lastCompletedAt)}
                </span>
              </div>
            </div>
          </div>

          {transientError ? (
            <div className="isdu-inline-error isdu-inline-error--critical">
              {transientError}
            </div>
          ) : null}

          {result.error ? (
            <div className="isdu-inline-error isdu-inline-error--critical">{result.error}</div>
          ) : null}

          {verificationError ? (
            <div className="isdu-inline-error isdu-inline-error--warning">
              {verificationError}
            </div>
          ) : null}

          {verificationResult ? (
            <div className="isdu-verification-card">
              <div className="isdu-verification-card__head">
                <p className="section-kicker">Read-back verification</p>
                <StatusBadge
                  label={verificationResult.response.ok ? 'Verified' : 'Verification issue'}
                  tone={verificationResult.response.ok ? 'normal' : 'warning'}
                />
              </div>
              <strong className="isdu-verification-card__value">
                {
                  resolveIsduDecodedValue({
                    result: verificationResult,
                    readDisplayType,
                    matchedVariable: verificationMatchedIoddVariable,
                  }).displayValue
                }
              </strong>
              <span className="isdu-verification-card__meta">
                {verificationResult.duration_ms} ms | {verificationResult.response.status} |{' '}
                {
                  resolveIsduDecodedValue({
                    result: verificationResult,
                    readDisplayType,
                    matchedVariable: verificationMatchedIoddVariable,
                  }).typeLabel
                }
              </span>
            </div>
          ) : null}

          <div className="isdu-result-panel__surfaces">
            <div className="isdu-surface">
              <div className="overview-panel__head">
                <div>
                  <p className="section-kicker">Request frame</p>
                  <p className="isdu-surface__meta">
                    {formatIsduUserPort(result.request.port)} |{' '}
                    {formatIsduDevicePortDebug(result.request.device_port)}
                  </p>
                </div>
              </div>
              <div className="mono-surface">{requestFrameText}</div>
            </div>

            <div className="isdu-surface">
              <div className="overview-panel__head">
                <div>
                  <p className="section-kicker">Raw response</p>
                  <p className="isdu-surface__meta">
                    {formatIsduUserPort(result.request.port)} |{' '}
                    {formatIsduDevicePortDebug(result.request.device_port)}
                  </p>
                </div>
              </div>
              <div className="mono-surface">{rawResponseText}</div>
            </div>
          </div>

          <div className="isdu-result-panel__debug">
            <div className="overview-panel__head">
              <div>
                <p className="section-kicker">Advanced decode debug</p>
                <p className="isdu-surface__meta">
                  Main reply stays single-purpose. Open this only when you need every
                  interpretation.
                </p>
              </div>
              <button
                type="button"
                className="action-button action-button--ghost action-button--compact"
                onClick={() => setShowAdvancedDebug((current) => !current)}
              >
                {showAdvancedDebug ? 'Hide debug' : 'Show debug'}
              </button>
            </div>

            {showAdvancedDebug ? (
              <div className="isdu-preview-grid">
                <div className="overview-decode-card">
                  <span className="overview-decode-card__label">Hex</span>
                  <strong className="overview-decode-card__value">
                    {formatNullable(
                      result.preview?.hex ?? result.response.data_hex ?? result.request.data_hex,
                    )}
                  </strong>
                  <span className="overview-decode-card__meta">
                    {formatNullable(result.preview?.byte_count)} byte(s)
                  </span>
                </div>

                <div className="overview-decode-card">
                  <span className="overview-decode-card__label">UInt16 / Int16</span>
                  <strong className="overview-decode-card__value">
                    {formatNullable(result.preview?.uint16_be)} /{' '}
                    {formatNullable(result.preview?.int16_be)}
                  </strong>
                  <span className="overview-decode-card__meta">
                    LE {formatNullable(result.preview?.uint16_le)} /{' '}
                    {formatNullable(result.preview?.int16_le)}
                  </span>
                </div>

                <div className="overview-decode-card">
                  <span className="overview-decode-card__label">UInt32 / Int32</span>
                  <strong className="overview-decode-card__value">
                    {formatNullable(result.preview?.uint32_be)} /{' '}
                    {formatNullable(result.preview?.int32_be)}
                  </strong>
                  <span className="overview-decode-card__meta">
                    LE {formatNullable(result.preview?.uint32_le)} /{' '}
                    {formatNullable(result.preview?.int32_le)}
                  </span>
                </div>

                <div className="overview-decode-card">
                  <span className="overview-decode-card__label">UTF-8 / ASCII</span>
                  <strong className="overview-decode-card__value">
                    {formatNullable(result.preview?.utf8 ?? result.preview?.ascii)}
                  </strong>
                  <span className="overview-decode-card__meta">
                    ASCII {formatNullable(result.preview?.ascii)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="isdu-result-panel__support">
            <ISDURecentActions actions={recentActions} compact />

            <section className="isdu-support-panel">
              <div className="isdu-support-panel__head">
                <div>
                  <p className="section-kicker">Engineering notes</p>
                  <h3 className="section-title">Operation support</h3>
                </div>
              </div>

              <div className="isdu-support-panel__grid">
                {supportCards.map((card) => (
                  <article
                    key={card.label}
                    className="isdu-support-card"
                  >
                    <span className="isdu-support-card__label">{card.label}</span>
                    <strong className="isdu-support-card__value">{card.value}</strong>
                    <span className="isdu-support-card__meta">{card.meta}</span>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </section>
  )
}

export default memo(ISDUResultPanel)
