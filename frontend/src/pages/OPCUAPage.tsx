import OpcUaPanel from '../components/OpcUaPanel'
import { useMonitoringWorkspaceContext } from '../context/MonitoringWorkspaceContext'

function OPCUAPage() {
  const workspace = useMonitoringWorkspaceContext()

  return (
    <section className="workspace-page workspace-page--opcua">
      <div className="workspace-page__body">
        <div className="opcua-target-strip" aria-label="OPC UA target and endpoint">
          <span className="opcua-target-strip__item">
            <span>Target</span>
            <strong>{workspace.connectionSummary}</strong>
          </span>
          <span className="opcua-target-strip__item opcua-target-strip__item--endpoint">
            <span>Endpoint</span>
            <strong>{workspace.opcUaStatus?.endpoint ?? '--'}</strong>
          </span>
        </div>
        <OpcUaPanel />
      </div>
    </section>
  )
}

export default OPCUAPage
