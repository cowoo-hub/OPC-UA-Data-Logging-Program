import { memo } from 'react'

import type { IoddIsduVariable, IsduOperation } from '../api/types'
import type {
  EncodedIsduWritePayload,
  IsduByteOrder,
  IsduReadDisplayType,
  IsduWriteEncoding,
} from '../utils/isdu'
import type { StatusTone } from './StatusBadge'
import StableSelect from './StableSelect'
import StatusBadge from './StatusBadge'

interface ISDURequestPanelProps {
  operation: IsduOperation
  portNumber: number
  ioddProfileName: string | null
  ioddVariableOptions: IoddIsduVariable[]
  selectedIoddVariableKey: string
  matchedIoddVariable: IoddIsduVariable | null
  indexInput: string
  subindexInput: string
  writeValue: string
  writeEncoding: IsduWriteEncoding
  writeByteOrder: IsduByteOrder
  readDisplayType: IsduReadDisplayType
  readBackAfterWrite: boolean
  requestPreview: string
  targetSummary: string
  stagedWrite: EncodedIsduWritePayload | null
  liveWritePreview: EncodedIsduWritePayload | null
  writePreviewError: string | null
  feedbackMessage: string | null
  feedbackTone: StatusTone
  isBusy: boolean
  onOperationChange: (value: IsduOperation) => void
  onPortChange: (portNumber: number) => void
  onIoddVariableSelect: (variableKey: string) => void
  onIndexChange: (value: string) => void
  onSubindexChange: (value: string) => void
  onWriteValueChange: (value: string) => void
  onWriteEncodingChange: (value: IsduWriteEncoding) => void
  onWriteByteOrderChange: (value: IsduByteOrder) => void
  onReadDisplayTypeChange: (value: IsduReadDisplayType) => void
  onReadBackAfterWriteChange: (value: boolean) => void
  onRead: () => void
  onStageWrite: () => void
  onConfirmWrite: () => void
  onCancelWrite: () => void
  onClear: () => void
}

const readDisplayTypeOptions: Array<{ value: IsduReadDisplayType; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'uint16', label: 'UINT16' },
  { value: 'int16', label: 'INT16' },
  { value: 'uint32', label: 'UINT32' },
  { value: 'int32', label: 'INT32' },
  { value: 'enum', label: 'ENUM' },
  { value: 'string', label: 'STRING' },
]

const writeEncodingOptions: Array<{ value: IsduWriteEncoding; label: string }> = [
  { value: 'raw_hex', label: 'Raw hex bytes' },
  { value: 'utf8', label: 'UTF-8 text' },
  { value: 'uint16', label: 'UINT16' },
  { value: 'int16', label: 'INT16' },
  { value: 'uint32', label: 'UINT32' },
  { value: 'int32', label: 'INT32' },
]

const byteOrderOptions: Array<{ value: IsduByteOrder; label: string }> = [
  { value: 'big', label: 'Big endian' },
  { value: 'little', label: 'Little endian' },
]

function ISDURequestPanel({
  operation,
  portNumber,
  ioddProfileName,
  ioddVariableOptions,
  selectedIoddVariableKey,
  matchedIoddVariable,
  indexInput,
  subindexInput,
  writeValue,
  writeEncoding,
  writeByteOrder,
  readDisplayType,
  readBackAfterWrite,
  requestPreview,
  targetSummary,
  stagedWrite,
  liveWritePreview,
  writePreviewError,
  feedbackMessage,
  feedbackTone,
  isBusy,
  onOperationChange,
  onPortChange,
  onIoddVariableSelect,
  onIndexChange,
  onSubindexChange,
  onWriteValueChange,
  onWriteEncodingChange,
  onWriteByteOrderChange,
  onReadDisplayTypeChange,
  onReadBackAfterWriteChange,
  onRead,
  onStageWrite,
  onConfirmWrite,
  onCancelWrite,
  onClear,
}: ISDURequestPanelProps) {
  return (
    <section className="control-panel control-panel--display control-panel--isdu-console">
      <div className="control-panel__header">
        <div>
          <p className="section-kicker">ISDU request</p>
          <h2 className="section-title">Parameter operation</h2>
        </div>

        <StatusBadge
          label={operation === 'read' ? 'Read' : stagedWrite ? 'Write armed' : 'Write'}
          tone={operation === 'read' ? 'neutral' : 'warning'}
        />
      </div>

      <div className="isdu-operation-toggle" role="tablist" aria-label="ISDU operation type">
        <button
          type="button"
          className={`isdu-operation-toggle__item ${operation === 'read' ? 'isdu-operation-toggle__item--active' : ''}`}
          onClick={() => onOperationChange('read')}
          disabled={isBusy}
        >
          Read
        </button>
        <button
          type="button"
          className={`isdu-operation-toggle__item ${operation === 'write' ? 'isdu-operation-toggle__item--active' : ''}`}
          onClick={() => onOperationChange('write')}
          disabled={isBusy}
        >
          Write
        </button>
      </div>

      <div className="isdu-port-selector" role="radiogroup" aria-label="ISDU target port">
        {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={portNumber === value}
            className={`isdu-port-selector__item ${portNumber === value ? 'isdu-port-selector__item--active' : ''}`}
            onClick={() => onPortChange(value)}
            disabled={isBusy}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="display-grid display-grid--isdu-console">
        {ioddVariableOptions.length > 0 ? (
          <label className="control-field control-field--span">
            <span className="control-field__label">IODD variable</span>
            <StableSelect
              value={selectedIoddVariableKey}
              onChange={onIoddVariableSelect}
              disabled={isBusy}
              options={[
                { value: '', label: 'Manual index / subindex' },
                ...ioddVariableOptions.map((variable) => ({
                  value: variable.key,
                  label: variable.name,
                  meta: `${variable.index}:${variable.subindex}${variable.accessRights ? ` | ${variable.accessRights}` : ''}`,
                })),
              ]}
            />
          </label>
        ) : null}

        <label className="control-field">
          <span className="control-field__label">Index</span>
          <input
            type="text"
            value={indexInput}
            onChange={(event) => onIndexChange(event.target.value)}
            placeholder="0x0010 or 16"
            spellCheck={false}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Subindex</span>
          <input
            type="text"
            value={subindexInput}
            onChange={(event) => onSubindexChange(event.target.value)}
            placeholder="0x00 or 0"
            spellCheck={false}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Decode as</span>
          <StableSelect
            value={readDisplayType}
            onChange={(nextValue) => onReadDisplayTypeChange(nextValue as IsduReadDisplayType)}
            disabled={isBusy}
            options={readDisplayTypeOptions}
          />
        </label>
      </div>

      <div className="isdu-request-panel__meta">
        <div className="detail-chip detail-chip--wide">
          <span className="detail-chip__label">Active target</span>
          <strong className="detail-chip__value">{targetSummary}</strong>
        </div>

        {ioddProfileName ? (
          <div className="detail-chip detail-chip--wide">
            <span className="detail-chip__label">Assigned IODD profile</span>
            <strong className="detail-chip__value">{ioddProfileName}</strong>
          </div>
        ) : null}

        {matchedIoddVariable ? (
          <div className="detail-chip detail-chip--wide">
            <span className="detail-chip__label">Matched variable</span>
            <strong className="detail-chip__value">
              {matchedIoddVariable.name} | {matchedIoddVariable.accessRights ?? 'Access n/a'} |{' '}
              {matchedIoddVariable.dataType ?? 'Type n/a'}
              {matchedIoddVariable.unit ? ` | ${matchedIoddVariable.unit}` : ''}
            </strong>
          </div>
        ) : null}
      </div>

      {operation === 'write' ? (
        <div className="isdu-write-panel">
          <div className="isdu-write-panel__grid">
            <label className="control-field">
              <span className="control-field__label">Encoding</span>
              <StableSelect
                value={writeEncoding}
                onChange={(nextValue) => onWriteEncodingChange(nextValue as IsduWriteEncoding)}
                options={writeEncodingOptions}
              />
            </label>

            <label className="control-field">
              <span className="control-field__label">Byte order</span>
              <StableSelect
                value={writeByteOrder}
                onChange={(nextValue) => onWriteByteOrderChange(nextValue as IsduByteOrder)}
                options={byteOrderOptions}
              />
            </label>
          </div>

          <label className="control-field">
            <span className="control-field__label">Write value</span>
            <input
              type="text"
              value={writeValue}
              onChange={(event) => onWriteValueChange(event.target.value)}
              placeholder={
                writeEncoding === 'raw_hex'
                  ? '12 34 AB'
                  : writeEncoding === 'utf8'
                    ? 'Text payload'
                    : '123 or 0x7B'
              }
              spellCheck={false}
            />
          </label>

          <label className="isdu-checkbox">
            <input
              type="checkbox"
              checked={readBackAfterWrite}
              onChange={(event) => onReadBackAfterWriteChange(event.target.checked)}
            />
            <span>Read back after write</span>
          </label>

          <div className="detail-chip detail-chip--wide">
            <span className="detail-chip__label">Encoded payload</span>
            <strong className="detail-chip__value">
              {liveWritePreview ? liveWritePreview.dataHex : writePreviewError ?? 'Awaiting payload'}
            </strong>
          </div>

          {stagedWrite ? (
            <div className="isdu-write-guard">
              <div className="isdu-write-guard__copy">
                <p className="section-kicker">Write confirmation</p>
                <strong className="isdu-write-guard__title">Confirm parameter write</strong>
                <p className="isdu-write-guard__body">
                  Payload {stagedWrite.dataHex} | {stagedWrite.summary}
                </p>
              </div>

              <div className="display-actions">
                <button
                  type="button"
                  className="action-button action-button--primary"
                  onClick={onConfirmWrite}
                  disabled={isBusy}
                >
                  {isBusy ? 'Writing...' : 'Confirm write'}
                </button>
                <button
                  type="button"
                  className="action-button action-button--ghost"
                  onClick={onCancelWrite}
                  disabled={isBusy}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="isdu-frame-preview">
        <div className="overview-panel__head">
          <p className="section-kicker">Request frame</p>
        </div>
        <div className="mono-surface">{requestPreview}</div>
      </div>

      {feedbackMessage ? (
        <div className={`isdu-request-panel__message isdu-request-panel__message--${feedbackTone}`}>
          {feedbackMessage}
        </div>
      ) : null}

      <div className="display-actions">
        {operation === 'read' ? (
          <button
            type="button"
            className="action-button action-button--primary"
            onClick={onRead}
            disabled={isBusy}
          >
            {isBusy ? 'Reading...' : 'Read parameter'}
          </button>
        ) : (
          <button
            type="button"
            className="action-button action-button--primary"
            onClick={onStageWrite}
            disabled={isBusy || Boolean(stagedWrite)}
          >
            Stage write
          </button>
        )}

        <button
          type="button"
          className="action-button action-button--ghost"
          onClick={onClear}
          disabled={isBusy}
        >
          Clear form
        </button>
      </div>
    </section>
  )
}

export default memo(ISDURequestPanel)
