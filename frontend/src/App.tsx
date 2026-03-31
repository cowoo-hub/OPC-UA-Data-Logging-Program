import PDIPage from './pages/PDIPage'

const navigationItems = [
  {
    label: 'PDI Monitor',
    description: 'Live process data',
    status: 'live',
  },
  {
    label: 'ISDU',
    description: 'Parameter services',
    status: 'soon',
  },
  {
    label: 'MQTT',
    description: 'Telemetry pipelines',
    status: 'soon',
  },
  {
    label: 'AI Diagnostics',
    description: 'Predictive insights',
    status: 'soon',
  },
] as const

function App() {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-panel">
          <p className="brand-panel__kicker">Industrial IO-Link Monitor</p>
          <h1 className="brand-panel__title">ICE2 Nexus</h1>
          <p className="brand-panel__body">
            A simulator-first operations shell with production-style UX. The
            architecture is ready for real ICE2 hardware, ISDU workflows, MQTT
            telemetry, AI diagnostics, and a broader operator workspace.
          </p>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {navigationItems.map((item) => (
            <div
              key={item.label}
              className={`nav-card ${item.status === 'live' ? 'nav-card--active' : ''}`}
              aria-current={item.status === 'live' ? 'page' : undefined}
            >
              <div>
                <p className="nav-card__title">{item.label}</p>
                <p className="nav-card__description">{item.description}</p>
              </div>
              <span
                className={`nav-card__state nav-card__state--${item.status}`}
              >
                {item.status === 'live' ? 'Live' : 'Soon'}
              </span>
            </div>
          ))}
        </nav>

        <div className="sidebar-note">
          Phase 1 keeps the focus on live PDI monitoring while the shell and
          navigation stay ready for future industrial control-center pages.
        </div>
      </aside>

      <main className="app-main">
        <PDIPage />
      </main>
    </div>
  )
}

export default App
