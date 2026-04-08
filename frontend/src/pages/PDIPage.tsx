import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'
import { formatHistoryWindow } from '../utils/history'
import PortCard from '../components/PortCard'
import StatusBadge from '../components/StatusBadge'

interface PDIPageProps {
  onOpenOverview: (portNumber: number) => void
}

function PDIPage({ onOpenOverview }: PDIPageProps) {
  const workspace = useMonitoringWorkspaceContext()
  const {
    ports,
    hasLoadedOnce,
    resolvedPortDisplayConfigs,
    portDisplayOverrides,
    featuredDecodesByPort,
    trendSeriesByPort,
    historySnapshot,
    historyWindowMs,
    communicationPresentation,
    backendModeLabel,
    updatePortDisplayOverride,
  } = workspace
  const historyWindowLabel = formatHistoryWindow(
    historySnapshot?.history_window_ms ?? historyWindowMs,
  )

  return (
    <div className="workspace-page workspace-page--monitor">
      <header className="page-header">
        <div>
          <p className="section-kicker">PDI monitor</p>
          <h2 className="page-title">Live process matrix</h2>
          <p className="page-description">
            All eight ports, live decoded values, and only the process signals
            operators need at a glance.
          </p>
        </div>

        <div className="page-header__badges">
          <StatusBadge label={communicationPresentation.label} tone={communicationPresentation.tone} />
          <StatusBadge label={backendModeLabel} tone={backendModeLabel === 'real' ? 'normal' : 'warning'} />
        </div>
      </header>

      {!hasLoadedOnce ? (
        <section className="monitor-grid" aria-label="Loading port monitor cards">
          {ports.map((snapshot) => (
            <article key={snapshot.portNumber} className="monitor-card monitor-card--loading">
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--text" />
              <div className="skeleton skeleton--panel" />
              <div className="skeleton skeleton--panel" />
            </article>
          ))}
        </section>
      ) : (
        <section className="monitor-grid">
          {ports.map((snapshot) => (
            <PortCard
              key={snapshot.portNumber}
              snapshot={snapshot}
              displayConfig={resolvedPortDisplayConfigs[snapshot.portNumber]}
              displayOverride={portDisplayOverrides[snapshot.portNumber] ?? null}
              featuredPreview={featuredDecodesByPort[snapshot.portNumber]}
              trendSeries={trendSeriesByPort[snapshot.portNumber]}
              historyWindowLabel={historyWindowLabel}
              onOverrideChange={updatePortDisplayOverride}
              onOpenOverview={onOpenOverview}
            />
          ))}
        </section>
      )}
    </div>
  )
}

export default PDIPage
