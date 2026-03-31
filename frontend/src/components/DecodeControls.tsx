import type { ChangeEvent } from 'react'

import type { ByteOrder, DecodeSettings, DecodeType, WordOrder } from '../api/types'
import StatusBadge from './StatusBadge'

interface DecodeControlsProps {
  value: DecodeSettings
  disabled?: boolean
  onChange: (nextValue: DecodeSettings) => void
}

const decodeTypeOptions: Array<{ value: DecodeType; label: string }> = [
  { value: 'float32', label: 'Float32' },
  { value: 'uint16', label: 'UInt16' },
  { value: 'int16', label: 'Int16' },
  { value: 'uint32', label: 'UInt32' },
  { value: 'int32', label: 'Int32' },
  { value: 'binary', label: 'Binary' },
]

const wordOrderOptions: Array<{ value: WordOrder; label: string }> = [
  { value: 'big', label: 'Big endian words' },
  { value: 'little', label: 'Little endian words' },
]

const byteOrderOptions: Array<{ value: ByteOrder; label: string }> = [
  { value: 'big', label: 'Big endian bytes' },
  { value: 'little', label: 'Little endian bytes' },
]

function DecodeControls({
  value,
  disabled = false,
  onChange,
}: DecodeControlsProps) {
  const updateSetting =
    <Key extends keyof DecodeSettings>(field: Key) =>
    (event: ChangeEvent<HTMLSelectElement>) => {
      onChange({
        ...value,
        [field]: event.target.value as DecodeSettings[Key],
      })
    }

  return (
    <section className="control-panel">
      <div className="control-panel__header">
        <div>
          <p className="section-kicker">Decode preview</p>
          <h2 className="section-title">Global payload decode profile</h2>
        </div>
        <div className="control-panel__status-stack">
          <StatusBadge label={value.dataType} tone="normal" />
          <StatusBadge label={`${value.wordOrder} words`} tone="neutral" />
          <StatusBadge label={`${value.byteOrder} bytes`} tone="neutral" />
        </div>
      </div>

      <p className="control-panel__hint">
        The selected decode becomes the featured preview for every port card.
        Float32, UInt32, Int32, and binary views remain visible underneath for
        side-by-side comparison. Byte order is applied client-side before the
        existing backend <code>/convert</code> call.
      </p>

      <div className="control-grid">
        <label className="control-field">
          <span className="control-field__label">Decode type</span>
          <select
            value={value.dataType}
            onChange={updateSetting('dataType')}
            disabled={disabled}
          >
            {decodeTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span className="control-field__label">Word order</span>
          <select
            value={value.wordOrder}
            onChange={updateSetting('wordOrder')}
            disabled={disabled}
          >
            {wordOrderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span className="control-field__label">Byte order</span>
          <select
            value={value.byteOrder}
            onChange={updateSetting('byteOrder')}
            disabled={disabled}
          >
            {byteOrderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}

export default DecodeControls
