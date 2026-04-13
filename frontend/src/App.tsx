import { useEffect, useState } from 'react'

import ConnectionBar from './components/ConnectionBar'
import Footer from './components/Footer'
import { useMonitoringWorkspaceContext } from './context/MonitoringWorkspaceContext'
import { MonitoringWorkspaceProvider } from './context/MonitoringWorkspaceProvider'
import AIDiagnosticsPage from './pages/AIDiagnosticsPage'
import IODDLibraryPage from './pages/IODDLibraryPage'
import ISDUPage from './pages/ISDUPage'
import OPCUAPage from './pages/OPCUAPage'
import PDIPage from './pages/PDIPage'
import PortOverviewPage from './pages/PortOverviewPage'

type AppPage = 'pdi' | 'overview' | 'iodd' | 'isdu' | 'opcua' | 'ai'

const navigationItems: Array<{
  id: AppPage
  label: string
}> = [
  {
    id: 'pdi',
    label: 'PDI Monitor',
  },
  {
    id: 'overview',
    label: 'Port Overview',
  },
  {
    id: 'iodd',
    label: 'IODD Library',
  },
  {
    id: 'isdu',
    label: 'ISDU',
  },
  {
    id: 'opcua',
    label: 'OPC UA',
  },
  {
    id: 'ai',
    label: 'AI Diagnostics',
  },
]

function AppShell() {
  const workspace = useMonitoringWorkspaceContext()
  const [activePage, setActivePage] = useState<AppPage>('pdi')

  useEffect(() => {
    const root = document.documentElement
    const runtimeSearchParams = new URLSearchParams(window.location.search)
    const isDesktopRuntime = runtimeSearchParams.get('desktop') === '1'
    let animationFrameId = 0
    let lastViewportWidth = 0
    let lastViewportHeight = 0

    function applyViewportMetrics() {
      const viewportWidth = Math.round(
        document.documentElement.clientWidth || window.innerWidth,
      )
      const viewportHeight = Math.round(
        document.documentElement.clientHeight || window.innerHeight,
      )

      if (
        Math.abs(viewportWidth - lastViewportWidth) < 2 &&
        Math.abs(viewportHeight - lastViewportHeight) < 2
      ) {
        return
      }

      lastViewportWidth = viewportWidth
      lastViewportHeight = viewportHeight

      root.dataset.runtime = isDesktopRuntime ? 'desktop' : 'browser'
      root.style.setProperty('--app-viewport-width', `${viewportWidth}px`)
      root.style.setProperty('--app-viewport-height', `${viewportHeight}px`)
    }

    function scheduleViewportMetrics() {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = window.requestAnimationFrame(applyViewportMetrics)
    }

    scheduleViewportMetrics()
    window.addEventListener('resize', scheduleViewportMetrics)
    if (!isDesktopRuntime) {
      window.visualViewport?.addEventListener('resize', scheduleViewportMetrics)
    }

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', scheduleViewportMetrics)
      if (!isDesktopRuntime) {
        window.visualViewport?.removeEventListener('resize', scheduleViewportMetrics)
      }
      root.style.removeProperty('--app-viewport-width')
      root.style.removeProperty('--app-viewport-height')
      if (!isDesktopRuntime) {
        delete root.dataset.runtime
      }
    }
  }, [])

  return (
    <div className={`app-shell app-shell--${activePage}`}>
      <aside className="app-rail">
        <div className="rail-brand">
          <div className="rail-brand__logo-shell" aria-label="Masterway">
            <img
              className="rail-brand__logo"
              src="/masterway-logo-ui.png"
              alt="Masterway"
            />
          </div>
        </div>

        <nav className="rail-nav" aria-label="Primary">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail-nav__item ${activePage === item.id ? 'rail-nav__item--active' : ''}`}
              onClick={() => setActivePage(item.id)}
            >
              <span className="rail-nav__title">{item.label}</span>
            </button>
          ))}
        </nav>

        <Footer />
      </aside>

      <main className={`workspace-shell workspace-shell--${activePage}`}>
        <ConnectionBar />

        {activePage === 'pdi' ? (
          <PDIPage
            onOpenOverview={(portNumber) => {
              workspace.setSelectedPortNumber(portNumber)
              setActivePage('overview')
            }}
          />
        ) : null}

        {activePage === 'overview' ? <PortOverviewPage /> : null}
        {activePage === 'iodd' ? <IODDLibraryPage /> : null}
        {activePage === 'isdu' ? <ISDUPage /> : null}
        {activePage === 'opcua' ? <OPCUAPage /> : null}
        {activePage === 'ai' ? <AIDiagnosticsPage /> : null}
      </main>
    </div>
  )
}

function App() {
  return (
    <MonitoringWorkspaceProvider>
      <AppShell />
    </MonitoringWorkspaceProvider>
  )
}

export default App
