import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchHealth, uploadIoddFile } from '../api/client'
import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import { formatLocalDateTimeDisplay } from '../utils/history'
import StatusBadge from '../components/StatusBadge'

interface UploadSupportState {
  checked: boolean
  enabled: boolean
  detail: string
}

function IODDLibraryPage() {
  const workspace = useMonitoringWorkspaceContext()
  const { ioddProfiles, refreshIoddLibrary } = workspace
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadSupport, setUploadSupport] = useState<UploadSupportState>({
    checked: false,
    enabled: false,
    detail: 'Checking backend IODD upload support...',
  })

  const refreshUploadSupport = useCallback(async () => {
    try {
      const health = await fetchHealth()
      const enabled = Boolean(health.iodd_upload_enabled)
      const detail = enabled
        ? `IODD upload ready. python-multipart ${health.dependencies?.python_multipart ?? 'available'}`
        : 'IODD upload is unavailable because multipart form parsing is not available in the active backend runtime.'

      const nextState = {
        checked: true,
        enabled,
        detail,
      }

      setUploadSupport(nextState)
      if (enabled) {
        setUploadError((previousError) =>
          previousError?.includes('python-multipart') ? null : previousError,
        )
      }

      return nextState
    } catch (error) {
      const detail =
        error instanceof Error
          ? `Could not verify backend upload support: ${error.message}`
          : 'Could not verify backend upload support.'
      const nextState = {
        checked: true,
        enabled: false,
        detail,
      }
      setUploadSupport(nextState)
      return nextState
    }
  }, [])

  useEffect(() => {
    if (!selectedProfileId && ioddProfiles.length > 0) {
      setSelectedProfileId(ioddProfiles[0].profileId)
    }
  }, [ioddProfiles, selectedProfileId])

  useEffect(() => {
    void refreshUploadSupport()
  }, [refreshUploadSupport])

  const selectedProfile = useMemo(
    () =>
      ioddProfiles.find((profile) => profile.profileId === selectedProfileId) ??
      ioddProfiles[0] ??
      null,
    [ioddProfiles, selectedProfileId],
  )

  async function handleUpload() {
    if (!selectedFile) {
      setUploadError('Choose an XML IODD file before uploading.')
      return
    }

    setIsUploading(true)
    setUploadError(null)
    setUploadMessage(null)

    try {
      const support = await refreshUploadSupport()
      if (!support.enabled) {
        setUploadError(support.detail)
        return
      }

      const response = await uploadIoddFile(selectedFile)
      await refreshIoddLibrary()
      await refreshUploadSupport()
      setSelectedProfileId(response.profile.profileId)
      setUploadMessage(
        `Imported ${response.profile.deviceName} from ${response.profile.fileName}.`,
      )
      setSelectedFile(null)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'IODD upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="workspace-page workspace-page--iodd">
      <header className="page-header">
        <div>
          <p className="section-kicker">IODD library</p>
          <h2 className="page-title">Device-aware profile management</h2>
          <p className="page-description">
            Upload XML IODDs to build reusable device profiles for structured process
            data and ISDU metadata while keeping manual engineering mode available.
          </p>
        </div>

        <div className="page-header__badges">
          <StatusBadge label={`${ioddProfiles.length} profiles`} tone="normal" />
          <StatusBadge
            label={uploadSupport.enabled ? 'Upload ready' : 'Upload check'}
            tone={uploadSupport.enabled ? 'normal' : uploadSupport.checked ? 'warning' : 'neutral'}
          />
        </div>
      </header>

      <section className="iodd-layout">
        <section className="control-panel iodd-upload-panel">
          <div className="control-panel__header">
            <div>
              <p className="section-kicker">Upload IODD</p>
              <h3 className="section-title">Import XML device profile</h3>
            </div>
            <StatusBadge
              label={uploadSupport.enabled ? 'Ready' : uploadSupport.checked ? 'Unavailable' : 'Checking'}
              tone={uploadSupport.enabled ? 'normal' : uploadSupport.checked ? 'warning' : 'neutral'}
            />
          </div>

          <p className="control-panel__hint">
            {uploadSupport.detail} First-pass support focuses on XML IODDs and extracts
            device identity, process-data structure, and ISDU variable metadata where
            possible.
          </p>

          <label className="control-field">
            <span className="control-field__label">IODD XML file</span>
            <input
              type="file"
              accept=".xml,text/xml,application/xml"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null)
                setUploadError(null)
                setUploadMessage(null)
              }}
            />
          </label>

          <div className="display-actions">
            <button
              type="button"
              className="action-button action-button--primary"
              onClick={() => void handleUpload()}
              disabled={isUploading || !selectedFile || !uploadSupport.enabled}
            >
              {isUploading ? 'Uploading...' : 'Upload IODD'}
            </button>
            <button
              type="button"
              className="action-button action-button--ghost"
              onClick={() => {
                void refreshUploadSupport()
                void refreshIoddLibrary()
              }}
              disabled={isUploading}
            >
              Refresh library
            </button>
          </div>

          {uploadError ? (
            <p className="iodd-upload-panel__message iodd-upload-panel__message--error">
              {uploadError}
            </p>
          ) : null}
          {uploadMessage ? (
            <p className="iodd-upload-panel__message iodd-upload-panel__message--success">
              {uploadMessage}
            </p>
          ) : null}

          <div className="iodd-upload-panel__stats">
            <div className="detail-chip detail-chip--wide">
              <span className="detail-chip__label">Library coverage</span>
              <strong className="detail-chip__value">
                {ioddProfiles.filter((profile) => (profile.processDataProfile?.fields.length ?? 0) > 0).length}{' '}
                structured PDI maps |{' '}
                {ioddProfiles.reduce((count, profile) => count + profile.isduVariables.length, 0)}{' '}
                ISDU variables
              </strong>
            </div>
          </div>
        </section>

        <section className="overview-panel iodd-library-panel">
          <div className="overview-panel__head">
            <div>
              <p className="section-kicker">Library</p>
              <h3 className="section-title">Uploaded IODDs</h3>
            </div>
          </div>

          {ioddProfiles.length === 0 ? (
            <p className="page-description">
              No IODDs uploaded yet. Import an XML file to create a reusable device profile.
            </p>
          ) : (
            <div className="iodd-library-list">
              {ioddProfiles.map((profile) => (
                <button
                  key={profile.profileId}
                  type="button"
                  className={`iodd-library-item ${selectedProfile?.profileId === profile.profileId ? 'iodd-library-item--selected' : ''}`}
                  onClick={() => setSelectedProfileId(profile.profileId)}
                >
                  <div className="iodd-library-item__head">
                    <strong>{profile.deviceName}</strong>
                    <StatusBadge
                      label={`${profile.processDataProfile?.fields.length ?? 0} PDI fields`}
                      tone={
                        (profile.processDataProfile?.fields.length ?? 0) > 0
                          ? 'normal'
                          : 'neutral'
                      }
                    />
                  </div>
                  <span>{profile.vendorName ?? 'Unknown vendor'}</span>
                  <span>
                    Device {profile.deviceId ?? '--'} | Product {profile.productId ?? '--'}
                  </span>
                  <span>{profile.fileName}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="overview-panel iodd-detail-panel">
          <div className="overview-panel__head">
            <div>
              <p className="section-kicker">Profile detail</p>
              <h3 className="section-title">
                {selectedProfile?.deviceName ?? 'Select an uploaded IODD'}
              </h3>
            </div>
            {selectedProfile ? (
              <StatusBadge
                label={`${selectedProfile.isduVariables.length} ISDU vars`}
                tone="normal"
              />
            ) : null}
          </div>

          {!selectedProfile ? (
            <p className="page-description">
              Pick an uploaded IODD from the library to inspect its parsed metadata.
            </p>
          ) : (
            <>
              <div className="overview-list overview-list--compact">
                <div className="overview-list__row">
                  <span>Vendor</span>
                  <strong>{selectedProfile.vendorName ?? '--'}</strong>
                </div>
                <div className="overview-list__row">
                  <span>Vendor ID</span>
                  <strong>{selectedProfile.vendorId ?? '--'}</strong>
                </div>
                <div className="overview-list__row">
                  <span>Device ID</span>
                  <strong>{selectedProfile.deviceId ?? '--'}</strong>
                </div>
                <div className="overview-list__row">
                  <span>Product ID</span>
                  <strong>{selectedProfile.productId ?? '--'}</strong>
                </div>
                <div className="overview-list__row">
                  <span>Family</span>
                  <strong>{selectedProfile.deviceFamily ?? '--'}</strong>
                </div>
                <div className="overview-list__row">
                  <span>Imported</span>
                  <strong>{formatLocalDateTimeDisplay(selectedProfile.uploadedAtUtc)}</strong>
                </div>
              </div>

              <div className="iodd-detail-grid">
                <section className="iodd-detail-card">
                  <div className="overview-panel__head">
                    <div>
                      <p className="section-kicker">Process data</p>
                      <h4 className="section-title">Structured PDI map</h4>
                    </div>
                  </div>

                  <p className="iodd-detail-card__summary">
                    {(selectedProfile.processDataProfile?.fields.length ?? 0) > 0
                      ? `${selectedProfile.processDataProfile?.fields.length ?? 0} parsed field(s) across ${selectedProfile.processDataProfile?.totalBitLength ?? 0} bit(s).`
                      : 'No explicit structured PDI field map was extracted from this IODD yet.'}
                  </p>

                  <div className="overview-process-grid">
                    {(selectedProfile.processDataProfile?.fields ?? []).map((field) => (
                      <article key={field.name} className="overview-process-card">
                        <div className="overview-process-card__head">
                          <span className="overview-process-card__label">{field.label}</span>
                          <span className="overview-process-card__role">
                            {(field.role ?? 'field').replace(/_/g, ' ')}
                          </span>
                        </div>
                        <strong className="overview-process-card__value">
                          {field.bitLength} bit {field.type}
                        </strong>
                        <span className="overview-process-card__meta">
                          bits {field.bitOffset}-{field.bitOffset + field.bitLength - 1}
                          {field.unit ? ` | ${field.unit}` : ''}
                        </span>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="iodd-detail-card">
                  <div className="overview-panel__head">
                    <div>
                      <p className="section-kicker">ISDU metadata</p>
                      <h4 className="section-title">Variable catalog</h4>
                    </div>
                  </div>

                  <div className="iodd-variable-list">
                    {selectedProfile.isduVariables.slice(0, 14).map((variable) => (
                      <div key={variable.key} className="iodd-variable-row">
                        <div className="iodd-variable-row__head">
                          <strong>{variable.name}</strong>
                          <span>
                            {variable.index}:{variable.subindex}
                          </span>
                        </div>
                        <span>
                          {variable.accessRights ?? 'Access n/a'} | {variable.dataType ?? 'Type n/a'}
                          {variable.bitLength ? ` | ${variable.bitLength} bit` : ''}
                          {variable.unit ? ` | ${variable.unit}` : ''}
                        </span>
                      </div>
                    ))}

                    {selectedProfile.isduVariables.length === 0 ? (
                      <p className="page-description">
                        No ISDU variable metadata was extracted from this IODD yet.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </>
          )}
        </section>
      </section>
    </div>
  )
}

export default IODDLibraryPage
