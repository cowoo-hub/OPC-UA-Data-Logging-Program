import { memo, useMemo, useState, type ChangeEvent } from 'react'

import type {
  ByteOrder,
  DecodeType,
  FieldMode,
  PortDisplayConfig,
  PortDisplayOverride,
  PortProfileId,
  ProcessDataProfileMode,
  ResolutionFactor,
  SentinelMapping,
  StatusBitState,
  WordOrder,
} from '../api/types'
import {
  FIELD_MODE_OPTIONS,
  PORT_PROFILE_OPTIONS,
  RESOLUTION_FACTOR_OPTIONS,
  buildOverrideFromPreset,
  buildPresetConfigFromDisplayConfig,
  formatStatusBits,
  formatResolutionFactor,
  getBuiltInProfilePresets,
  loadCustomProfilePresets,
  parseStatusBitsInput,
  saveCustomProfilePreset,
} from '../utils/portDisplay'
import { getProcessDataProfileOptions } from '../utils/processDataMaps'
import StableSelect from './StableSelect'
import StatusBitIndicators from './StatusBitIndicators'
import StatusBadge from './StatusBadge'

interface PortDisplayControlsProps {
  selectedPortNumber: number
  selectedConfig: PortDisplayConfig
  selectedOverride: PortDisplayOverride | null
  selectedStatusBitStates?: StatusBitState[]
  showPortSelector?: boolean
  variant?: 'default' | 'compact'
  className?: string
  onSelectedPortNumberChange: (portNumber: number) => void
  onOverrideChange: (portNumber: number, override: PortDisplayOverride) => void
  onResetPort: (portNumber: number) => void
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
  { value: 'big', label: 'Big words' },
  { value: 'little', label: 'Little words' },
]

const byteOrderOptions: Array<{ value: ByteOrder; label: string }> = [
  { value: 'big', label: 'Big bytes' },
  { value: 'little', label: 'Little bytes' },
]

const sourceWordOptions = [1, 2, 3, 4]
const processDataModeOptions: Array<{ value: ProcessDataProfileMode; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'profile', label: 'Profile' },
  { value: 'auto', label: 'Auto' },
]

interface DeferredTextInputProps {
  initialValue: string
  placeholder: string
  onCommit: (value: string) => void
}

interface CustomizingMapRowDraft {
  value: string
  label: string
}

interface DeferredCustomizingMapRowProps {
  initialValue: string
  initialLabel: string
  onCommit: (value: string, label: string) => void
}

const MIN_CUSTOMIZING_MAP_ROWS = 5

function DeferredTextInput({
  initialValue,
  placeholder,
  onCommit,
}: DeferredTextInputProps) {
  const [draftValue, setDraftValue] = useState(initialValue)

  return (
    <input
      type="text"
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={() => onCommit(draftValue)}
      placeholder={placeholder}
      spellCheck={false}
    />
  )
}

function DeferredCustomizingMapRow({
  initialValue,
  initialLabel,
  onCommit,
}: DeferredCustomizingMapRowProps) {
  const [draftValue, setDraftValue] = useState(initialValue)
  const [draftLabel, setDraftLabel] = useState(initialLabel)

  function commit(nextValue = draftValue, nextLabel = draftLabel) {
    onCommit(nextValue, nextLabel)
  }

  return (
    <div className="customizing-map__row">
      <input
        type="number"
        step="any"
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={() => commit()}
        placeholder="32766"
        spellCheck={false}
      />
      <input
        type="text"
        value={draftLabel}
        onChange={(event) => setDraftLabel(event.target.value)}
        onBlur={() => commit()}
        placeholder="Out of Range"
        spellCheck={false}
      />
    </div>
  )
}

function PortDisplayControls({
  selectedPortNumber,
  selectedConfig,
  selectedOverride,
  selectedStatusBitStates = [],
  showPortSelector = true,
  variant = 'default',
  className,
  onSelectedPortNumberChange,
  onOverrideChange,
  onResetPort,
}: PortDisplayControlsProps) {
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetName, setPresetName] = useState('')
  const [customPresets, setCustomPresets] = useState(() => loadCustomProfilePresets())
  const isCompact = variant === 'compact'
  const processDataProfileOptions = getProcessDataProfileOptions()

  const presetOptions = useMemo(
    () => [...getBuiltInProfilePresets(), ...customPresets],
    [customPresets],
  )
  const activePresetConfig = useMemo(
    () => buildPresetConfigFromDisplayConfig(selectedConfig),
    [selectedConfig],
  )
  const matchedPresetId = useMemo(() => {
    const activePresetKey = JSON.stringify(activePresetConfig)

    return (
      presetOptions.find(
        (preset) => JSON.stringify(preset.config) === activePresetKey,
      )?.id ?? ''
    )
  }, [activePresetConfig, presetOptions])
  const matchedPreset = useMemo(
    () => presetOptions.find((preset) => preset.id === matchedPresetId) ?? null,
    [matchedPresetId, presetOptions],
  )

  const presetSelectionValue = selectedPresetId || matchedPresetId
  const selectedLabelValue = selectedOverride?.label ?? ''
  const selectedDecodeValue = selectedConfig.preferredDecodeType
  const selectedWordOrderValue = selectedConfig.wordOrder
  const selectedByteOrderValue = selectedConfig.byteOrder
  const selectedResolutionValue = selectedConfig.resolutionFactor
  const selectedProfileValue = selectedOverride?.profileId ?? selectedConfig.profileId
  const selectedUnitValue =
    selectedOverride?.engineeringUnit !== undefined
      ? (selectedOverride.engineeringUnit ?? '')
      : (selectedConfig.engineeringUnit ?? '')
  const selectedFieldModeValue = selectedConfig.fieldMode
  const selectedSourceWordCountValue = selectedConfig.sourceWordCount
  const selectedBitOffsetValue = selectedConfig.bitOffset
  const selectedBitLengthValue = selectedConfig.bitLength
  const selectedSignedValue = selectedConfig.signed ? 'signed' : 'unsigned'
  const selectedProcessDataModeValue = selectedConfig.processDataMode
  const selectedProcessDataProfileValue = selectedConfig.processDataProfileId ?? ''
  const selectedStatusBitsValue = formatStatusBits(selectedConfig.statusBits)
  const selectedCustomizingMapRows = useMemo<CustomizingMapRowDraft[]>(() => {
    const rows = selectedConfig.sentinelMappings.map((mapping) => ({
      value: String(mapping.value),
      label: mapping.label,
    }))

    while (rows.length < MIN_CUSTOMIZING_MAP_ROWS) {
      rows.push({ value: '', label: '' })
    }

    return rows
  }, [selectedConfig.sentinelMappings])

  function applyNextOverride(nextOverride: PortDisplayOverride) {
    setSelectedPresetId('')
    onOverrideChange(selectedPortNumber, nextOverride)
  }

  function updateOverride(patch: Partial<PortDisplayOverride>) {
    applyNextOverride({
      ...(selectedOverride ?? {}),
      ...patch,
    })
  }

  function handleLabelChange(event: ChangeEvent<HTMLInputElement>) {
    const nextLabel = event.target.value

    if (nextLabel.trim() === '') {
      const nextOverride = { ...(selectedOverride ?? {}) }
      delete nextOverride.label
      applyNextOverride(nextOverride)
      return
    }

    updateOverride({ label: nextLabel })
  }

  function handleUnitChange(event: ChangeEvent<HTMLInputElement>) {
    updateOverride({
      engineeringUnit: event.target.value.trim() || null,
    })
  }

  function handleBitOffsetChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value

    if (nextValue.trim() === '') {
      const nextOverride = { ...(selectedOverride ?? {}) }
      delete nextOverride.bitOffset
      applyNextOverride(nextOverride)
      return
    }

    updateOverride({ bitOffset: Number(nextValue) })
  }

  function handleBitLengthChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value

    if (nextValue.trim() === '') {
      const nextOverride = { ...(selectedOverride ?? {}) }
      delete nextOverride.bitLength
      applyNextOverride(nextOverride)
      return
    }

    updateOverride({ bitLength: Number(nextValue) })
  }

  function handleCustomizingMapCommit(
    rowIndex: number,
    nextValue: string,
    nextLabel: string,
  ) {
    const nextRows = selectedCustomizingMapRows.map((row, index) =>
      index === rowIndex
        ? {
            value: nextValue.trim(),
            label: nextLabel.trim(),
          }
        : row,
    )

    const nextMappings: SentinelMapping[] = nextRows.flatMap((row) => {
      if (!row.value || !row.label) {
        return []
      }

      const numericValue = Number(row.value)

      if (!Number.isFinite(numericValue)) {
        return []
      }

      return [
        {
          value: numericValue,
          label: row.label,
        },
      ]
    })

    updateOverride({
      sentinelMappings: nextMappings,
    })
  }

  function handleStatusBitsCommit(nextValue: string) {
    updateOverride({
      statusBits: parseStatusBitsInput(nextValue),
    })
  }

  function handleApplyPreset() {
    const selectedPreset = presetOptions.find((preset) => preset.id === selectedPresetId)

    if (!selectedPreset) {
      return
    }

    applyNextOverride(buildOverrideFromPreset(selectedPreset.config, selectedOverride))
  }

  function handleResetProfile() {
    setSelectedPresetId('')
    onResetPort(selectedPortNumber)
  }

  function handlePresetSave() {
    const trimmedName = presetName.trim()

    if (!trimmedName) {
      return
    }

    const nextCustomPresets = saveCustomProfilePreset(trimmedName, activePresetConfig)
    setCustomPresets(nextCustomPresets)

    const savedPreset = nextCustomPresets.find((preset) => preset.name === trimmedName)
    setSelectedPresetId(savedPreset?.id ?? '')
    setPresetName('')
  }

  return (
    <section
      className={`control-panel control-panel--display ${isCompact ? 'control-panel--compact' : ''} ${className ?? ''}`.trim()}
    >
      <div className="control-panel__header">
        <div>
          <p className="section-kicker">Port profile</p>
          {!isCompact ? (
            <h2 className="section-title">Decode and labeling</h2>
          ) : null}
        </div>
        <div className="control-panel__status-stack">
          {!isCompact ? <StatusBadge label={`Port ${selectedPortNumber}`} tone="normal" /> : null}
          <StatusBadge
            label={selectedConfig.isCustomized ? 'Custom profile' : 'Profile default'}
            tone={selectedConfig.isCustomized ? 'warning' : 'neutral'}
          />
        </div>
      </div>

      {!isCompact ? (
        <p className="control-panel__hint">
          Tune label, decode, scale, field extraction, and Customizing Map values for this port.
        </p>
      ) : null}

      <div className="display-grid">
        {showPortSelector ? (
          <label className="control-field">
            <span className="control-field__label">
              {isCompact ? 'Port' : 'Selected port'}
            </span>
            <StableSelect
              value={String(selectedPortNumber)}
              onChange={(nextValue) =>
                onSelectedPortNumberChange(Number(nextValue))
              }
              options={Array.from({ length: 8 }, (_, index) => index + 1).map((portNumber) => ({
                value: String(portNumber),
                label: `Port ${portNumber}`,
              }))}
            />
          </label>
        ) : null}

        <label className="control-field">
          <span className="control-field__label">{isCompact ? 'Label' : 'Port label'}</span>
          <input
            type="text"
            value={selectedLabelValue}
            onChange={handleLabelChange}
            placeholder={selectedConfig.label}
            spellCheck={false}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Profile</span>
          <StableSelect
            value={selectedProfileValue}
            onChange={(nextValue) => {
              if (nextValue === 'generic') {
                const nextOverride = { ...(selectedOverride ?? {}) }
                delete nextOverride.profileId
                applyNextOverride(nextOverride)
                return
              }

              updateOverride({ profileId: nextValue as PortProfileId })
            }}
            options={PORT_PROFILE_OPTIONS.map((profile) => ({
              value: profile.id,
              label: profile.label,
            }))}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">
            {isCompact ? 'Decode' : 'Preferred decode'}
          </span>
          <StableSelect
            value={selectedDecodeValue}
            onChange={(nextValue) =>
              updateOverride({ preferredDecodeType: nextValue as DecodeType })
            }
            options={decodeTypeOptions}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Resolution</span>
          <StableSelect
            value={String(selectedResolutionValue)}
            onChange={(nextValue) =>
              updateOverride({
                resolutionFactor: Number(nextValue) as ResolutionFactor,
              })
            }
            options={RESOLUTION_FACTOR_OPTIONS.map((option) => ({
              value: String(option),
              label: formatResolutionFactor(option),
            }))}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">{isCompact ? 'Words' : 'Word order'}</span>
          <StableSelect
            value={selectedWordOrderValue}
            onChange={(nextValue) =>
              updateOverride({ wordOrder: nextValue as WordOrder })
            }
            options={wordOrderOptions}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">{isCompact ? 'Bytes' : 'Byte order'}</span>
          <StableSelect
            value={selectedByteOrderValue}
            onChange={(nextValue) =>
              updateOverride({ byteOrder: nextValue as ByteOrder })
            }
            options={byteOrderOptions}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">Unit</span>
          <input
            type="text"
            value={selectedUnitValue}
            onChange={handleUnitChange}
            placeholder={selectedConfig.engineeringUnit ?? 'None'}
            spellCheck={false}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">{isCompact ? 'Field' : 'Field mode'}</span>
          <StableSelect
            value={selectedFieldModeValue}
            onChange={(nextValue) => {
              const nextFieldMode = nextValue as FieldMode

              if (nextFieldMode === 'full_word') {
                const nextOverride = { ...(selectedOverride ?? {}) }
                nextOverride.fieldMode = 'full_word'
                delete nextOverride.bitOffset
                delete nextOverride.bitLength
                delete nextOverride.signed
                applyNextOverride(nextOverride)
                return
              }

              updateOverride({ fieldMode: nextFieldMode })
            }}
            options={FIELD_MODE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">
            {isCompact ? 'Source' : 'Source words'}
          </span>
          <StableSelect
            value={String(selectedSourceWordCountValue)}
            onChange={(nextValue) => updateOverride({ sourceWordCount: Number(nextValue) })}
            options={sourceWordOptions.map((option) => ({
              value: String(option),
              label: String(option),
            }))}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">{isCompact ? 'PDI mode' : 'Process-data mode'}</span>
          <StableSelect
            value={selectedProcessDataModeValue}
            onChange={(nextValue) =>
              updateOverride({
                processDataMode: nextValue as ProcessDataProfileMode,
              })
            }
            options={processDataModeOptions}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">{isCompact ? 'PDI map' : 'Process-data map'}</span>
          <StableSelect
            value={selectedProcessDataProfileValue}
            onChange={(nextValue) => {
              if (!nextValue) {
                applyNextOverride({
                  ...(selectedOverride ?? {}),
                  processDataProfileId: null,
                  processDataMode:
                    (selectedOverride?.processDataMode ?? selectedConfig.processDataMode) === 'profile'
                      ? 'manual'
                      : selectedOverride?.processDataMode ?? selectedConfig.processDataMode,
                })
                return
              }

              applyNextOverride({
                ...(selectedOverride ?? {}),
                processDataMode: 'profile',
                processDataProfileId: nextValue as typeof selectedConfig.processDataProfileId,
              })
            }}
            options={[
              { value: '', label: 'Manual engineering decode' },
              ...processDataProfileOptions.map((profile) => ({
                value: profile.id,
                label: profile.name,
              })),
            ]}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">
            {isCompact ? 'Signed' : 'Signedness'}
          </span>
          <StableSelect
            value={selectedSignedValue}
            onChange={(nextValue) => updateOverride({ signed: nextValue === 'signed' })}
            options={[
              { value: 'unsigned', label: 'Unsigned' },
              { value: 'signed', label: 'Signed' },
            ]}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">{isCompact ? 'Offset' : 'Bit offset'}</span>
          <input
            type="number"
            min={0}
            value={selectedFieldModeValue === 'bit_field' ? selectedBitOffsetValue : 0}
            onChange={handleBitOffsetChange}
            disabled={selectedFieldModeValue !== 'bit_field'}
          />
        </label>

        <label className="control-field">
          <span className="control-field__label">{isCompact ? 'Length' : 'Bit length'}</span>
          <input
            type="number"
            min={1}
            max={32}
            value={selectedFieldModeValue === 'bit_field' ? selectedBitLengthValue : 16}
            onChange={handleBitLengthChange}
            disabled={selectedFieldModeValue !== 'bit_field'}
          />
        </label>
      </div>

      <div className="display-grid display-grid--advanced">
        <div className="control-field control-field--span control-field--customizing-map">
          <span className="control-field__label">Customizing Map</span>
          <div className="customizing-map">
            {selectedCustomizingMapRows.map((row, rowIndex) => (
              <DeferredCustomizingMapRow
                key={`customizing-${selectedPortNumber}-${rowIndex}-${row.value}-${row.label}`}
                initialValue={row.value}
                initialLabel={row.label}
                onCommit={(nextValue, nextLabel) =>
                  handleCustomizingMapCommit(rowIndex, nextValue, nextLabel)
                }
              />
            ))}
          </div>
        </div>

        <label className="control-field control-field--span">
          <div className="control-field__label-row">
            <span className="control-field__label">Status bits</span>
            <StatusBitIndicators
              statusBits={selectedStatusBitStates}
              className="status-bit-indicators--profile"
              maxItems={2}
            />
          </div>
          <DeferredTextInput
            key={`status-${selectedPortNumber}-${selectedStatusBitsValue}`}
            initialValue={selectedStatusBitsValue}
            onCommit={handleStatusBitsCommit}
            placeholder="0=Switching signal 1, 1=Switching signal 2"
          />
        </label>
      </div>

      <div className="profile-preset-strip">
        <div className="profile-preset-strip__row">
          <label className="control-field profile-preset-strip__field">
            <span className="control-field__label">{isCompact ? 'Preset' : 'Preset library'}</span>
            <StableSelect
              value={presetSelectionValue}
              onChange={(nextValue) => setSelectedPresetId(nextValue)}
              options={[
                { value: '', label: 'Manual setup' },
                ...presetOptions.map((preset) => ({
                  value: preset.id,
                  label: preset.name,
                })),
              ]}
            />
          </label>

          <button
            type="button"
            className="action-button action-button--ghost action-button--compact"
            onClick={handleApplyPreset}
            disabled={!selectedPresetId || selectedPresetId === matchedPresetId}
          >
            Apply
          </button>
        </div>

        {!isCompact ? (
          <div className="profile-preset-strip__row">
            <label className="control-field profile-preset-strip__field">
              <span className="control-field__label">Save current</span>
              <input
                type="text"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder="Store current decode preset"
                spellCheck={false}
              />
            </label>

            <button
              type="button"
              className="action-button action-button--ghost action-button--compact"
              onClick={handlePresetSave}
              disabled={!presetName.trim()}
            >
              Save
            </button>
          </div>
        ) : null}

        <p className="profile-preset-strip__meta">
          {matchedPreset
            ? `${matchedPreset.origin === 'builtin' ? 'Built-in' : 'Custom'} preset active: ${matchedPreset.name}`
            : 'Manual setup active'}
        </p>
      </div>

      <div className="control-panel__footer control-panel__footer--split">
        {!isCompact ? (
          <div className="detail-chip detail-chip--wide">
            <span className="detail-chip__label">Resolved engineering preview</span>
            <strong className="detail-chip__value">
              {selectedConfig.label} | {selectedConfig.engineeringLabel}
              {selectedConfig.engineeringUnit ? ` (${selectedConfig.engineeringUnit})` : ''}
              {` | x${formatResolutionFactor(selectedConfig.resolutionFactor)}`}
              {selectedConfig.processDataMode !== 'manual'
                ? ` | ${selectedConfig.processDataProfileId ?? 'Auto profile'}`
                : ''}
              {selectedConfig.fieldMode === 'bit_field'
                ? ` | bits ${selectedConfig.bitOffset}-${selectedConfig.bitOffset + selectedConfig.bitLength - 1}`
                : ` | ${selectedConfig.sourceWordCount} word source`}
            </strong>
          </div>
        ) : null}

        <div className="display-actions">
          <button
            type="button"
            className="action-button action-button--ghost"
            onClick={handleResetProfile}
            disabled={!selectedConfig.isCustomized}
          >
            {isCompact ? 'Reset' : 'Reset profile'}
          </button>
        </div>
      </div>
    </section>
  )
}

export default memo(
  PortDisplayControls,
  (previousProps, nextProps) =>
    previousProps.selectedPortNumber === nextProps.selectedPortNumber &&
    previousProps.selectedConfig === nextProps.selectedConfig &&
    previousProps.selectedOverride === nextProps.selectedOverride &&
    previousProps.selectedStatusBitStates === nextProps.selectedStatusBitStates &&
    previousProps.showPortSelector === nextProps.showPortSelector &&
    previousProps.variant === nextProps.variant &&
    previousProps.className === nextProps.className &&
    previousProps.onSelectedPortNumberChange === nextProps.onSelectedPortNumberChange &&
    previousProps.onOverrideChange === nextProps.onOverrideChange &&
    previousProps.onResetPort === nextProps.onResetPort,
)
