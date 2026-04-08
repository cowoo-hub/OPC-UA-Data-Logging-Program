import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  readIsduParameter,
  writeIsduParameter,
} from '../api/client'
import type {
  IoddIsduVariable,
  IsduOperation,
  IsduOperationResponse,
  IsduReadResponse,
} from '../api/types'
import { type ISDURecentActionItem } from '../components/ISDURecentActions'
import ISDURequestPanel from '../components/ISDURequestPanel'
import ISDUResultPanel from '../components/ISDUResultPanel'
import type { StatusTone } from '../components/StatusBadge'
import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import {
  encodeIsduWritePayload,
  formatIsduRequestFramePreview,
  formatIsduTimestamp,
  type IsduReadDisplayType,
  parseNumericInput,
  type EncodedIsduWritePayload,
  type IsduByteOrder,
  type IsduWriteEncoding,
} from '../utils/isdu'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'ISDU operation failed'
}

function buildRecentAction(
  result: IsduOperationResponse | null,
  {
    operation,
    port,
    index,
    subindex,
    error,
    timestamp,
  }: {
    operation: IsduOperation
    port: number
    index: number
    subindex: number
    error?: string | null
    timestamp: string
  },
): ISDURecentActionItem {
  const isOk = result?.response.ok ?? false
  const isTimedOut = result?.response.timed_out ?? false

  let statusLabel = 'Error'
  let statusTone: StatusTone = 'critical'

  if (isTimedOut) {
    statusLabel = 'Timeout'
    statusTone = 'warning'
  } else if (isOk) {
    statusLabel = operation === 'write' ? 'Write OK' : 'Read OK'
    statusTone = 'normal'
  } else if (!error && result) {
    statusLabel = 'Rejected'
    statusTone = 'critical'
  }

  const summary =
    error ??
    result?.response.data_hex ??
    result?.request.data_hex ??
    result?.preview?.hex ??
    result?.response.status ??
    'No payload'

  return {
    id: `${timestamp}-${operation}-${port}-${index}-${subindex}-${Math.random().toString(16).slice(2, 8)}`,
    operation,
    port,
    index,
    subindex,
    statusLabel,
    statusTone,
    durationMs: result?.duration_ms ?? null,
    timestampLabel: formatIsduTimestamp(timestamp),
    summary,
  }
}

function ISDUPage() {
  const workspace = useMonitoringWorkspaceContext()
  const [operation, setOperation] = useState<IsduOperation>('read')
  const [indexInput, setIndexInput] = useState('0')
  const [subindexInput, setSubindexInput] = useState('0')
  const [writeValue, setWriteValue] = useState('')
  const [writeEncoding, setWriteEncoding] =
    useState<IsduWriteEncoding>('raw_hex')
  const [writeByteOrder, setWriteByteOrder] =
    useState<IsduByteOrder>('big')
  const [readDisplayType, setReadDisplayType] =
    useState<IsduReadDisplayType>('auto')
  const [readBackAfterWrite, setReadBackAfterWrite] = useState(true)
  const [stagedWrite, setStagedWrite] = useState<EncodedIsduWritePayload | null>(
    null,
  )
  const [result, setResult] = useState<IsduOperationResponse | null>(null)
  const [verificationResult, setVerificationResult] =
    useState<IsduReadResponse | null>(null)
  const [transientError, setTransientError] = useState<string | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [recentActions, setRecentActions] = useState<ISDURecentActionItem[]>([])
  const [lastCompletedAt, setLastCompletedAt] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const connection = workspace.dashboard?.connection ?? null
  const portNumber = workspace.selectedPortNumber
  const selectedPortIoddProfile = workspace.selectedPortIoddProfile

  const getAssignedIoddProfile = useCallback(
    (requestedPortNumber: number) => {
      const profileId =
        workspace.resolvedPortDisplayConfigs[requestedPortNumber]?.processDataProfileId ?? null

      return profileId ? workspace.ioddProfilesById[profileId] ?? null : null
    },
    [workspace.ioddProfilesById, workspace.resolvedPortDisplayConfigs],
  )

  useEffect(() => {
    setStagedWrite(null)
  }, [
    operation,
    portNumber,
    indexInput,
    subindexInput,
    writeValue,
    writeEncoding,
    writeByteOrder,
  ])

  const parsedIndex = useMemo(() => parseNumericInput(indexInput), [indexInput])
  const parsedSubindex = useMemo(
    () => parseNumericInput(subindexInput),
    [subindexInput],
  )

  const addressValidationError = useMemo(() => {
    if (parsedIndex === null || parsedSubindex === null) {
      return 'Enter a decimal or 0x-prefixed hex value for index and subindex.'
    }

    if (parsedIndex < 0 || parsedIndex > 0xffff) {
      return 'ISDU index must be between 0 and 65535.'
    }

    if (parsedSubindex < 0 || parsedSubindex > 0xff) {
      return 'ISDU subindex must be between 0 and 255.'
    }

    return null
  }, [parsedIndex, parsedSubindex])

  const liveWritePreviewState = useMemo(() => {
    if (operation !== 'write') {
      return {
        payload: null as EncodedIsduWritePayload | null,
        error: null as string | null,
      }
    }

    if (!writeValue.trim()) {
      return {
        payload: null as EncodedIsduWritePayload | null,
        error: null as string | null,
      }
    }

    try {
      return {
        payload: encodeIsduWritePayload(writeValue, writeEncoding, writeByteOrder),
        error: null as string | null,
      }
    } catch (error) {
      return {
        payload: null as EncodedIsduWritePayload | null,
        error: getErrorMessage(error),
      }
    }
  }, [operation, writeByteOrder, writeEncoding, writeValue])

  const targetSummary = useMemo(() => {
    if (!connection) {
      return 'No active ICE2 target configured. Connect from the product connection bar first.'
    }

    return `${connection.mode} | ${connection.host}:${connection.port} | slave ${connection.slave_id}`
  }, [connection])

  const requestPreview = useMemo(() => {
    if (addressValidationError) {
      return addressValidationError
    }

    if (parsedIndex === null || parsedSubindex === null) {
      return 'Awaiting valid ISDU address.'
    }

    const payload =
      operation === 'read'
        ? [
            {
              req: 'read',
              port: portNumber - 1,
              index: parsedIndex,
              subindex: parsedSubindex,
            },
          ]
        : [
            {
              req: 'write',
              port: portNumber - 1,
              index: parsedIndex,
              subindex: parsedSubindex,
              data:
                stagedWrite?.dataHex ??
                liveWritePreviewState.payload?.dataHex ??
                '',
            },
          ]

    return formatIsduRequestFramePreview({
      operation,
      port: portNumber,
      device_port: portNumber - 1,
      index: parsedIndex,
      subindex: parsedSubindex,
      data_hex:
        operation === 'write'
          ? stagedWrite?.dataHex ?? liveWritePreviewState.payload?.dataHex ?? null
          : null,
      payload,
    })
  }, [
    addressValidationError,
    liveWritePreviewState.payload?.dataHex,
    operation,
    parsedIndex,
    parsedSubindex,
    portNumber,
    stagedWrite?.dataHex,
  ])

  const matchedIoddVariable = useMemo<IoddIsduVariable | null>(() => {
    if (
      !selectedPortIoddProfile ||
      parsedIndex === null ||
      parsedSubindex === null
    ) {
      return null
    }

    return (
      selectedPortIoddProfile.isduVariables.find(
        (variable) =>
          variable.index === parsedIndex && variable.subindex === parsedSubindex,
      ) ?? null
    )
  }, [parsedIndex, parsedSubindex, selectedPortIoddProfile])

  const resultMatchedIoddVariable = useMemo<IoddIsduVariable | null>(() => {
    if (!result) {
      return null
    }

    const assignedProfile = getAssignedIoddProfile(result.request.port)
    if (!assignedProfile) {
      return null
    }

    return (
      assignedProfile.isduVariables.find(
        (variable) =>
          variable.index === result.request.index &&
          variable.subindex === result.request.subindex,
      ) ?? null
    )
  }, [getAssignedIoddProfile, result])

  const verificationMatchedIoddVariable = useMemo<IoddIsduVariable | null>(() => {
    if (!verificationResult) {
      return null
    }

    const assignedProfile = getAssignedIoddProfile(verificationResult.request.port)
    if (!assignedProfile) {
      return null
    }

    return (
      assignedProfile.isduVariables.find(
        (variable) =>
          variable.index === verificationResult.request.index &&
          variable.subindex === verificationResult.request.subindex,
      ) ?? null
    )
  }, [getAssignedIoddProfile, verificationResult])

  const selectedIoddVariableKey = matchedIoddVariable?.key ?? ''

  const feedbackMessage = useMemo(() => {
    if (stagedWrite) {
      return 'Write armed. Review the payload and confirm before sending it to the active target.'
    }

    if (transientError) {
      return transientError
    }

    if (operation === 'write' && liveWritePreviewState.error) {
      return liveWritePreviewState.error
    }

    if (!connection) {
      return 'Connect a real ICE2 or simulator first. The ISDU console will use the active backend target.'
    }

    return null
  }, [
    connection,
    liveWritePreviewState.error,
    operation,
    stagedWrite,
    transientError,
  ])

  const feedbackTone = useMemo<StatusTone>(() => {
    if (stagedWrite) {
      return 'warning'
    }

    if (transientError || (operation === 'write' && liveWritePreviewState.error)) {
      return 'critical'
    }

    if (!connection) {
      return 'warning'
    }

    return 'neutral'
  }, [
    connection,
    liveWritePreviewState.error,
    operation,
    stagedWrite,
    transientError,
  ])

  function pushRecentAction(
    operationType: IsduOperation,
    operationResult: IsduOperationResponse | null,
    {
      port,
      index,
      subindex,
      error,
      timestamp,
    }: {
      port: number
      index: number
      subindex: number
      error?: string | null
      timestamp: string
    },
  ) {
    const item = buildRecentAction(operationResult, {
      operation: operationType,
      port,
      index,
      subindex,
      error,
      timestamp,
    })

    setRecentActions((previousItems) => [item, ...previousItems].slice(0, 8))
  }

  function clearTransientState() {
    setTransientError(null)
    setVerificationError(null)
  }

  function handleClear() {
    setIndexInput('0')
    setSubindexInput('0')
    setWriteValue('')
    setWriteEncoding('raw_hex')
    setWriteByteOrder('big')
    setReadBackAfterWrite(true)
    setStagedWrite(null)
    clearTransientState()
  }

  function handleIoddVariableSelect(variableKey: string) {
    const variable = selectedPortIoddProfile?.isduVariables.find(
      (candidate) => candidate.key === variableKey,
    )

    if (!variable) {
      return
    }

    setIndexInput(String(variable.index))
    setSubindexInput(String(variable.subindex))
    clearTransientState()
  }

  async function handleRead() {
    clearTransientState()
    setVerificationResult(null)

    if (addressValidationError || parsedIndex === null || parsedSubindex === null) {
      setTransientError(addressValidationError)
      return
    }

    setIsBusy(true)

    try {
      const response = await readIsduParameter({
        port: portNumber,
        index: parsedIndex,
        subindex: parsedSubindex,
      })

      const completedAt = new Date().toISOString()
      setResult(response)
      setLastCompletedAt(completedAt)
      pushRecentAction('read', response, {
        port: portNumber,
        index: parsedIndex,
        subindex: parsedSubindex,
        timestamp: completedAt,
      })
    } catch (error) {
      const message = getErrorMessage(error)
      const completedAt = new Date().toISOString()
      setTransientError(message)
      pushRecentAction('read', null, {
        port: portNumber,
        index: parsedIndex,
        subindex: parsedSubindex,
        error: message,
        timestamp: completedAt,
      })
    } finally {
      setIsBusy(false)
    }
  }

  function handleStageWrite() {
    clearTransientState()

    if (addressValidationError || parsedIndex === null || parsedSubindex === null) {
      setTransientError(addressValidationError)
      return
    }

    if (liveWritePreviewState.error || !liveWritePreviewState.payload) {
      setTransientError(
        liveWritePreviewState.error ??
          'Enter a write payload before staging the ISDU write.',
      )
      return
    }

    setStagedWrite(liveWritePreviewState.payload)
  }

  function handleCancelWrite() {
    setStagedWrite(null)
    clearTransientState()
  }

  async function handleConfirmWrite() {
    clearTransientState()
    setVerificationResult(null)

    if (
      !stagedWrite ||
      addressValidationError ||
      parsedIndex === null ||
      parsedSubindex === null
    ) {
      setTransientError(
        addressValidationError ?? 'Stage a write payload before confirming it.',
      )
      return
    }

    setIsBusy(true)

    try {
      const writeResponse = await writeIsduParameter({
        port: portNumber,
        index: parsedIndex,
        subindex: parsedSubindex,
        data_hex: stagedWrite.dataHex,
      })

      const completedAt = new Date().toISOString()
      setResult(writeResponse)
      setLastCompletedAt(completedAt)
      setStagedWrite(null)
      pushRecentAction('write', writeResponse, {
        port: portNumber,
        index: parsedIndex,
        subindex: parsedSubindex,
        timestamp: completedAt,
      })

      if (readBackAfterWrite && writeResponse.response.ok) {
        try {
          const verification = await readIsduParameter({
            port: portNumber,
            index: parsedIndex,
            subindex: parsedSubindex,
          })

          const verificationCompletedAt = new Date().toISOString()
          setVerificationResult(verification)
          pushRecentAction('read', verification, {
            port: portNumber,
            index: parsedIndex,
            subindex: parsedSubindex,
            timestamp: verificationCompletedAt,
          })

          if (!verification.response.ok) {
            setVerificationError(
              `Write completed, but read-back verification returned '${verification.response.status}'.`,
            )
          }
        } catch (error) {
          const message = getErrorMessage(error)
          const verificationCompletedAt = new Date().toISOString()
          setVerificationError(`Write completed, but read-back verification failed: ${message}`)
          pushRecentAction('read', null, {
            port: portNumber,
            index: parsedIndex,
            subindex: parsedSubindex,
            error: message,
            timestamp: verificationCompletedAt,
          })
        }
      }
    } catch (error) {
      const message = getErrorMessage(error)
      const completedAt = new Date().toISOString()
      setTransientError(message)
      pushRecentAction('write', null, {
        port: portNumber,
        index: parsedIndex,
        subindex: parsedSubindex,
        error: message,
        timestamp: completedAt,
      })
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="workspace-page workspace-page--isdu">
      <section className="isdu-console">
        <ISDURequestPanel
          operation={operation}
          portNumber={portNumber}
          ioddProfileName={selectedPortIoddProfile?.deviceName ?? null}
          ioddVariableOptions={selectedPortIoddProfile?.isduVariables ?? []}
          selectedIoddVariableKey={selectedIoddVariableKey}
          matchedIoddVariable={matchedIoddVariable}
          indexInput={indexInput}
          subindexInput={subindexInput}
          writeValue={writeValue}
          writeEncoding={writeEncoding}
          writeByteOrder={writeByteOrder}
          readDisplayType={readDisplayType}
          readBackAfterWrite={readBackAfterWrite}
          requestPreview={requestPreview}
          targetSummary={targetSummary}
          stagedWrite={stagedWrite}
          liveWritePreview={liveWritePreviewState.payload}
          writePreviewError={liveWritePreviewState.error}
          feedbackMessage={feedbackMessage}
          feedbackTone={feedbackTone}
          isBusy={isBusy}
          onOperationChange={setOperation}
          onPortChange={workspace.setSelectedPortNumber}
          onIoddVariableSelect={handleIoddVariableSelect}
          onIndexChange={setIndexInput}
          onSubindexChange={setSubindexInput}
          onWriteValueChange={setWriteValue}
          onWriteEncodingChange={setWriteEncoding}
          onWriteByteOrderChange={setWriteByteOrder}
          onReadDisplayTypeChange={setReadDisplayType}
          onReadBackAfterWriteChange={setReadBackAfterWrite}
          onRead={() => void handleRead()}
          onStageWrite={handleStageWrite}
          onConfirmWrite={() => void handleConfirmWrite()}
          onCancelWrite={handleCancelWrite}
          onClear={handleClear}
        />

        <ISDUResultPanel
          result={result}
          resultMatchedIoddVariable={resultMatchedIoddVariable}
          verificationResult={verificationResult}
          verificationMatchedIoddVariable={verificationMatchedIoddVariable}
          verificationError={verificationError}
          transientError={transientError}
          lastCompletedAt={lastCompletedAt}
          recentActions={recentActions}
          readDisplayType={readDisplayType}
          writeEncoding={writeEncoding}
        />
      </section>
    </div>
  )
}

export default ISDUPage
