# Masterway

Masterway is a Windows-focused industrial IO-Link monitoring and configuration platform for real-time process-data inspection, device diagnostics, IODD-based decoding, ISDU access, and OPC UA data exposure.

The project is designed as a professional operator tool rather than a prototype dashboard. Its architecture separates the industrial communication layer, cached runtime data model, frontend visualization, AI-assisted diagnostics, and Windows desktop packaging so the product can evolve safely toward a deployable EXE application.

## Product Scope

Masterway is intended for engineers, operators, and system integrators who need a compact and reliable interface for IO-Link master monitoring.

Core goals:

- Monitor all IO-Link ports with stable, low-latency PDI updates.
- Decode raw Modbus TCP process data into usable engineering values.
- Support per-port process-data mapping for different connected devices.
- Manage uploaded IODD files and use them as device profile references.
- Read and write ISDU parameters where the target IO-Link master supports it.
- Provide device, port, and diagnostic status in a professional industrial UI.
- Expose selected live data to external industrial systems through OPC UA.
- Package the system as a Windows desktop product named Masterway.

## Current Capabilities

- FastAPI backend for communication, caching, configuration, and integration APIs.
- React frontend for operator-facing monitoring and configuration screens.
- Real-device mode for Modbus TCP communication with an IO-Link master.
- Simulator mode for development, demonstrations, and validation without hardware.
- PDI Monitor for live raw and decoded process-data inspection.
- Port Overview for compact per-port configuration and display mapping.
- IODD Library upload, profile listing, profile inspection, and deletion.
- ISDU read/write workflow for IO-Link parameter access.
- AI Diagnostics page with per-port baseline learning and anomaly interpretation.
- OPC UA server mode for exposing Masterway runtime data as read-only industrial nodes.
- Desktop launcher and PyInstaller packaging pipeline for Windows EXE deployment.

## Architecture

Masterway uses a layered architecture to keep communication, data processing, UI, and packaging concerns independent.

```text
IO-Link Master / Simulator
        |
        | Modbus TCP / HTTP ISDU
        v
Backend Runtime
  - FastAPI application
  - Modbus TCP client
  - PDI polling worker
  - Runtime cache
  - IODD library service
  - ISDU service
  - OPC UA server bridge
        |
        | REST API
        v
Frontend Application
  - PDI Monitor
  - Port Overview
  - IODD Library
  - ISDU Tools
  - AI Diagnostics
  - OPC UA Control
        |
        v
Windows Desktop Shell
  - Local backend process
  - Embedded web UI
  - Masterway.exe packaging
```

This structure is intentional: the backend owns industrial communication and state consistency, while the frontend focuses on visualization, operator interaction, and configuration workflows.

## Repository Layout

```text
backend/
  app.py                  FastAPI entry point and API routes
  config.py               Runtime configuration and environment handling
  modbus_core.py          Modbus TCP connection and PDI addressing logic
  polling.py              Cached polling worker for live PDI data
  pdi_display.py          Display-state normalization and port severity helpers
  iodd_library.py         IODD upload, indexing, parsing, and deletion support
  isdu_service.py         ISDU read/write service
  opcua_service.py        OPC UA server and live node model
  runtime_settings.py     Persistent runtime settings store
  simulator.py            Development simulator backend

frontend/
  src/App.tsx             Main frontend shell and route composition
  src/pages/              Product pages
  src/components/         Shared UI components
  src/hooks/              Workspace and runtime state hooks
  src/utils/              Diagnostics, learning, and mapping utilities
  src/styles/app.css      Masterway visual system and layout styles

desktop/
  launcher.py             Windows desktop launcher
  masterway.spec          PyInstaller build specification
  build_windows.ps1       Windows EXE build script
  assets/                 Desktop assets and icon resources
```

## Backend Runtime

The backend is the source of truth for industrial communication and runtime state.

Main responsibilities:

- Maintain the selected backend mode: real device or simulator.
- Connect to the IO-Link master through Modbus TCP.
- Poll all configured PDI blocks at a controlled interval.
- Keep the latest per-port snapshots in memory for responsive UI updates.
- Retain short-term history for trend visualization and CSV export.
- Normalize decoded display data for the frontend and OPC UA integration.
- Provide IODD library management.
- Provide ISDU access where supported by the device and master.
- Start, stop, and configure the OPC UA server.

Important API groups:

- `GET /health`
- `GET /connection`
- `POST /connect`
- `POST /disconnect`
- `GET /ports/all/pdi`
- `GET /ports/all/history`
- `GET /ports/{port}/pdi`
- `GET /ports/{port}/history`
- `GET /ports/{port}/history/export`
- `POST /convert`
- `GET /iodd/library`
- `POST /iodd/library/upload`
- `DELETE /iodd/library/{profile_id}`
- `POST /isdu/read`
- `POST /isdu/write`
- `GET /opcua/status`
- `GET /opcua/nodes`
- `PUT /opcua/config`
- `GET /display-configs`
- `PUT /display-configs`

## Frontend Runtime

The frontend is designed as a dense industrial operator UI. It prioritizes compact layout, stable positioning, and fast visual interpretation over decorative dashboard behavior.

Main pages:

- PDI Monitor: live PDI inspection with raw and decoded values.
- Port Overview: per-port profile, decode, scale, status, and map configuration.
- IODD Library: uploaded profile management and delete workflow.
- ISDU: parameter read/write tooling for supported IO-Link devices.
- AI Diagnostics: baseline learning, anomaly scoring, and operator guidance.
- OPC UA: server configuration, endpoint status, and live node preview.

UI principles:

- Avoid layout shift during live status changes.
- Keep per-port cards compact and consistent.
- Prevent chart and text overflow across card boundaries.
- Use fixed operator-oriented surfaces instead of reactive dashboard motion.
- Keep key industrial values visible without excessive whitespace.
- Preserve readability under frequent live data refresh.

## PDI and Port Data Model

Masterway treats each IO-Link port as an independent runtime unit.

Each port can expose:

- Raw process-data registers.
- Decoded display value.
- Scaled engineering value.
- Process-data validity.
- Port status and diagnostic indicators.
- Device-specific profile and mapping selection.
- Short-term history samples.
- AI learning and anomaly state.
- OPC UA mirror nodes.

This model allows different sensors on different ports to be monitored with independent scaling, decoding, and diagnostic behavior.

## AI Diagnostics

The AI Diagnostics page is designed around per-port learning rather than a single global threshold.

Each port can learn its own expected signal behavior because industrial sensors differ by range, unit, noise profile, application, and operating condition.

The current diagnostic model supports:

- Per-port baseline learning.
- Configurable learning duration.
- Sample counting during learning.
- Learned normal envelope.
- Post-learning anomaly interpretation.
- Stable AI score layout without text wrapping.
- Compact current-analysis result cards.
- Operator-oriented recommendations.

This approach is more suitable for real industrial monitoring than applying one fixed anomaly rule to every device.

## OPC UA Integration

Masterway includes an OPC UA server mode so external systems can consume live Masterway data.

Typical consumers:

- SCADA systems
- HMI platforms
- MES systems
- Historians
- Test benches
- Engineering tools such as UaExpert

Default behavior:

- Endpoint path: `opc.tcp://<host>:4840/masterway`
- Default host: `0.0.0.0`
- Default port: `4840`
- Security mode: none
- Anonymous access: enabled
- Node access: read-only by default

The OPC UA implementation exposes a live node preview in the UI and mirrors selected Masterway runtime values, including system state and port-level process-data information.

For production deployments, OPC UA security policy, certificate management, network segmentation, and access rules should be reviewed according to the target plant requirements.

## Excel Live Logging

For operator-friendly logging and quick engineering review, Masterway can be bridged from OPC UA into Microsoft Excel with a hybrid workflow:

- Live values are mirrored into an Excel workbook.
- Durable CSV history is written in parallel so logging continues even if Excel is closed or crashes.
- The bridge reconnects automatically if the OPC UA endpoint restarts.

Bridge files:

```text
desktop/tools/masterway_excel_bridge.py
desktop/scripts/run_excel_bridge.ps1
desktop/excel_viewer.py
desktop/build_excel_viewer.ps1
desktop/masterway_excel_viewer.spec
```

Default outputs:

- Workbook: `%LOCALAPPDATA%\Masterway\excel\Masterway_OPCUA_Live.xlsx`
- CSV log: `%LOCALAPPDATA%\Masterway\excel\masterway_opcua_YYYYMMDD.csv`

Typical usage:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\scripts\run_excel_bridge.ps1 `
  -Endpoint "opc.tcp://192.168.1.108:4840" `
  -VisibleExcel
```

Headless logging only:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\scripts\run_excel_bridge.ps1 `
  -Endpoint "opc.tcp://192.168.1.108:4840" `
  -NoExcel
```

Notes:

- Excel live integration uses Windows COM automation and requires Microsoft Excel on the PC.
- If `pywin32` is not installed, the bridge still runs in CSV-only mode when `-NoExcel` is used.
- If no explicit node list is supplied, the bridge can auto-discover external IO-Link `PDI Fields` nodes.
- Discovered ports are also split into dedicated Excel sheets such as `Port 1`, `Port 2`, and `Port 7` for cleaner operator review.
- History is available both as a global log and as per-port sheets such as `Port 7 History`.
- You can omit `-Endpoint` and type the OPC UA endpoint interactively when the script starts.

### Excel Viewer EXE

For deployment to operator PCs, Masterway also includes a standalone desktop viewer with:

- Host/IP input
- Port input
- Optional path input
- `Connect` / `Disconnect` workflow
- Live Excel launch
- Per-port live sheets and per-port history sheets

Build the viewer package:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build_excel_viewer.ps1
```

Build output:

```text
desktop\dist-excel-viewer\MasterwayExcelViewer\MasterwayExcelViewer.exe
```

## IODD Library

The IODD Library is used to manage uploaded IO-Link Device Description files.

Supported workflows:

- Upload IODD XML files.
- Parse and index profile metadata.
- Display vendor, profile, and file information.
- Select uploaded profiles for process-data interpretation.
- Delete uploaded IODD files and associated indexed profile data.

Deletion is implemented as a real backend operation, not only a frontend state change. After deletion, the frontend refreshes the library list and provides success or error feedback.

## ISDU Access

Masterway provides ISDU read/write tooling for supported IO-Link masters and devices.

The ISDU workflow is intended for:

- Reading parameter values.
- Writing configurable device parameters.
- Validating index and subindex inputs.
- Supporting engineering and commissioning tasks.

Because ISDU write operations can change device behavior, production use should follow the device vendor documentation and site commissioning procedure.

## Runtime Modes

Masterway supports two runtime modes.

Real mode:

- Connects to an actual IO-Link master through Modbus TCP.
- Uses the configured host and port.
- Intended for commissioning, monitoring, and production validation.

Simulator mode:

- Uses an internal software simulator.
- Allows UI, diagnostics, and integration testing without hardware.
- Useful for development, demonstrations, and recovery testing.

## Environment Configuration

The backend can be configured through environment variables.

Common settings:

```text
ICE2_DEFAULT_MODE=real|simulator
USE_SIMULATOR=true|false
PDI_POLL_INTERVAL_MS=20
PDI_STALE_AFTER_MS=250
PDI_RECONNECT_BASE_MS=250
PDI_RECONNECT_MAX_MS=5000
PDI_HISTORY_RETENTION_MS=3600000
PDI_HISTORY_MAX_POINTS=240
PDI_HISTORY_SAMPLE_INTERVAL_MS=100
PDI_PAYLOAD_WORD_COUNT=<word-count>
PDI_BLOCK_MODE=multiple|specific
IODD_LIBRARY_DIR=<path>
MASTERWAY_RUNTIME_SETTINGS_FILE=<path>
```

ISDU settings:

```text
ICE2_ISDU_HTTP_SCHEME=http
ICE2_ISDU_HTTP_PORT=80
ICE2_ISDU_TIMEOUT_SECONDS=5.0
ICE2_ISDU_HTTP_USERNAME=<optional-user>
ICE2_ISDU_HTTP_PASSWORD=<optional-password>
```

OPC UA settings:

```text
OPCUA_ENABLED=false
OPCUA_HOST=0.0.0.0
OPCUA_PORT=4840
OPCUA_PATH=masterway
OPCUA_NAMESPACE_URI=urn:masterway:opcua
OPCUA_SERVER_NAME=Masterway OPC UA Server
OPCUA_SECURITY_MODE=none
OPCUA_ANONYMOUS=true
OPCUA_WRITABLE=false
```

## Development Requirements

Current tested environment:

- Windows 10/11
- Python 3.14.2
- Node.js 20 or newer recommended
- npm
- Git

Backend dependencies are pinned in:

```text
backend/requirements.txt
```

Frontend dependencies are managed in:

```text
frontend/package.json
```

Desktop packaging dependencies are listed in:

```text
desktop/requirements.txt
```

For production EXE packaging, use a fixed Python runtime and validate the complete PyInstaller output on a clean Windows machine.

## Development Setup

Create and prepare the Python environment:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Install frontend dependencies:

```powershell
cd frontend
npm install
```

Run the backend:

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Run the frontend development server:

```powershell
cd frontend
npm run dev
```

Build the frontend:

```powershell
cd frontend
npm run build
```

## Windows EXE Packaging

The desktop package uses a local FastAPI backend and an embedded web UI shell.

Install desktop packaging dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r desktop\requirements.txt
.\.venv\Scripts\python.exe -m pip install pywebview --no-deps
```

Build the Windows desktop package:

```powershell
.\desktop\build_windows.ps1
```

Expected output:

```text
desktop\dist\Masterway\Masterway.exe
```

The build script first creates a production frontend build, then packages the desktop launcher and backend runtime with PyInstaller.

## Validation Commands

Recommended validation before committing or packaging:

```powershell
cd frontend
npm run build
npm run lint
```

```powershell
cd ..
python -m compileall backend
```

For OPC UA validation, start the backend, enable the OPC UA server from the UI, then connect with an OPC UA client such as UaExpert using the configured endpoint.

## Security and Deployment Notes

Masterway is intended for industrial environments and should be deployed with normal plant-network controls.

Recommended production practices:

- Keep the Masterway host on a trusted industrial network segment.
- Restrict inbound access to required ports only.
- Use Windows firewall rules for backend, OPC UA, and desktop runtime ports.
- Keep OPC UA nodes read-only unless write support is explicitly engineered and tested.
- Protect ISDU write workflows because they can change device behavior.
- Avoid storing production credentials directly in source-controlled files.
- Validate IODD files from trusted vendor sources.
- Test EXE packaging on a clean target Windows machine before field deployment.

## Product Direction

Planned product-quality improvements:

- Stronger OPC UA security profile and certificate handling.
- More device-specific IODD decoding coverage.
- Expanded diagnostic event handling.
- Per-device templates for process-data maps.
- Installer-based Windows deployment.
- Signed executable and release packaging.
- Persistent project profiles for plant-specific configurations.
- Automated integration tests for backend API, PDI decode logic, and OPC UA node exposure.

## Project Status

Masterway is under active productization. The current codebase contains working monitoring, configuration, diagnostics, IODD, ISDU, OPC UA, and Windows packaging foundations. Further validation with real IO-Link hardware, plant-network constraints, and production deployment scenarios is required before operational release.
