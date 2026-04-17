# Masterway OPC UA Data Logging Program

Masterway OPC UA Data Logging Program is a Windows desktop application for connecting to live OPC UA endpoints, discovering industrial data nodes, and logging selected values into Microsoft Excel and CSV at the same time.

The program is designed for practical engineering work rather than demo-only visualization. It gives operators and test engineers a compact desktop workspace where they can:

- connect directly to an OPC UA server by host/IP, port, optional path, or full manual endpoint override
- discover live IO-Link style `PDI Fields` and other OPC UA nodes from the target server
- mirror current values into a structured Excel workbook for operator visibility
- keep durable CSV history in parallel with the Excel session
- stage only the fields that matter for retained history instead of logging every discovered node
- split output into global sheets and per-port sheets for cleaner analysis
- prune active history after a retention window while continuously appending trimmed rows into archive CSV files
- keep logging stable even when Excel becomes busy or slow

This repository is the focused Windows deliverable for the OPC UA logging workflow. It is intended for commissioning, field validation, test benches, factory acceptance support, and industrial data capture on engineering PCs.

## Product Scope

The application is built around a simple but production-oriented model:

- OPC UA server is the live data source
- Masterway desktop viewer is the operator workspace and logging controller
- Excel workbook is the readable live surface for operators and engineers
- CSV output is the durable data log
- retention archive CSV files provide rolling long-term preservation without making the active workbook too large

The current product is especially well suited to OPC UA servers that expose IO-Link process data in browse paths similar to:

```text
IOLM/Port 7/Attached Device/PDI Fields/MV - Distance
IOLM/Port 7/Attached Device/PDI Fields/SSC1 - Switching Signal 1
IOLM/Port 8/Attached Device/PDI Fields/MV - Measurement Value
```

Node naming depends on the upstream OPC UA server implementation, but the viewer is optimized for PDI-oriented industrial structures.

## What The Program Does

### Direct OPC UA Connection

The viewer supports a staged connection workflow with:

- host/IP input
- port input
- optional path input
- optional full endpoint override
- connect and disconnect controls
- start logging only after node discovery and history setup

Typical endpoints:

```text
opc.tcp://192.168.1.108:4840
opc.tcp://192.168.1.108:4840/masterway
```

UaExpert can be used to inspect the endpoint in advance, but it does not need to remain open during normal operation. The program connects directly to the OPC UA server.

### Live Node Discovery

After connection, the program reads the target namespace, discovers candidate nodes, and builds a runtime model used for:

- the global `Live` sheet
- per-port live sheets such as `Port 1`, `Port 6`, or `Port 8`
- history staging lists in the UI
- per-port history sheets

### Selective History Logging

Live monitoring often exposes more nodes than the engineer wants to retain. The viewer therefore separates:

- live node discovery
- selected history fields

Only fields explicitly staged into the history selection are written into retained history outputs. This keeps workbook history, per-port history, and CSV logging aligned to the signals that actually matter.

### Excel Workbook Logging

The program keeps a live workbook open through the Windows Excel COM bridge. The workbook is intended for human-readable operator use, not just raw data dumping.

Typical workbook structure:

- `Live`
- `History`
- `Port 1`
- `Port 1 History`
- `Port 6`
- `Port 6 History`
- `Port 8`
- `Port 8 History`

The exact per-port sheets depend on the selected history fields and discovered nodes for the current session.

### Persistent CSV Logging

CSV runs in parallel with Excel so that durable history remains available even if Excel is hidden, slow, or restarted. The CSV layer is the primary persistent history record.

The current CSV schema is:

- `timestamp_kst`
- `browse_path`
- `display_name`
- `value`
- `datatype`
- `status`

CSV timestamps are normalized to Korea Standard Time and written in the format:

```text
YYYY-MM-DD HH:MM:SS
```

Example:

```text
2026-04-17 11:30:33
```

### Retention With Continuous Archive Export

The active workbook and main CSV can be bounded by a retention window such as:

- 30 sec
- 1 min
- 5 min
- 15 min
- 30 min
- 1 hour
- 6 hours
- or no auto-delete

When retention is enabled:

- active workbook history is trimmed
- active CSV history is trimmed
- trimmed rows are continuously appended to a session archive CSV file
- archive logging continues until disconnect

This means the operator sees a compact active workbook while older rows remain preserved outside the active retention window.

## Technical Architecture

The program has three main runtime layers.

### 1. Desktop Viewer

File:

```text
desktop/excel_viewer.py
```

Responsibilities:

- operator UI
- endpoint assembly and validation
- node discovery workflow
- history field staging
- retention and archive configuration
- runtime status reporting
- performance timing display
- worker lifecycle management

### 2. OPC UA / Excel / CSV Bridge

File:

```text
desktop/tools/masterway_excel_bridge.py
```

Responsibilities:

- OPC UA client reads
- browse path normalization
- port classification
- live snapshot generation
- Excel workbook synchronization
- per-port worksheet maintenance
- selected-history filtering
- CSV writing
- retention pruning
- archive CSV generation

### 3. Packaging Layer

Files:

```text
desktop/build_excel_viewer.ps1
desktop/masterway_excel_viewer.spec
desktop/installer/build_installer.ps1
desktop/installer/masterway.iss
```

Responsibilities:

- standalone Windows bundle generation with PyInstaller
- asset inclusion
- desktop runtime packaging
- installer generation with Inno Setup

## Runtime Data Flow

```text
External OPC UA Server
        |
        | browse + read loop
        v
OpcUaReader
        |
        | normalized runtime snapshots
        v
Desktop Worker Loop
  - history field filter
  - retention window
  - archive export
  - performance timing
        |
        +--> ExcelWorkbookBridge -> Live workbook / per-port sheets
        |
        +--> CsvHistoryWriter -> Main CSV / archive CSV
        |
        +--> Viewer UI -> status / node count / perf / control state
```

## Workbook Model

### Live Sheet

The global `Live` sheet shows the current discovered node set for the active endpoint.

### Per-Port Sheets

Per-port sheets group current values by inferred port classification so the engineer can focus on one device channel at a time.

### History Sheet

The global `History` sheet is the compact rolling history area for selected fields.

### Per-Port History Sheets

Per-port history sheets isolate retained signals by port. This is useful when only specific PDI fields should remain visible for a given channel.

## Output Paths

By default, outputs are written under:

```text
%LOCALAPPDATA%\Masterway\excel
```

Typical files:

```text
%LOCALAPPDATA%\Masterway\excel\Masterway_OPCUA_Live.xlsx
%LOCALAPPDATA%\Masterway\excel\masterway_opcua_YYYYMMDD.csv
%LOCALAPPDATA%\Masterway\excel\masterway_perf_YYYYMMDD.csv
%LOCALAPPDATA%\Masterway\excel\retention-archive\masterway_retention_session_YYYYMMDD_HHMMSS.csv
```

The archive directory can also be changed from the UI.

## Performance Model

The desktop viewer exposes runtime measurements so the operator can understand where time is being spent. Typical metrics include:

- OPC UA read time
- Excel live write time
- history write time
- prune time
- loop time
- node count

This is useful when tuning:

- endpoint responsiveness
- Excel workload
- history field count
- retention window size
- archive behavior

The current viewer configuration is optimized around a fast polling workflow with separate intervals for read, Excel, port-sheet sync, history writes, and reconnect attempts.

## Intended Operator Workflow

1. Launch the desktop application.
2. Enter host/IP, port, and optional path, or use a full endpoint override.
3. Click `Connect`.
4. Review discovered PDI fields or other candidate nodes.
5. Move only required fields into the history selection list.
6. Choose the retention window and archive destination if needed.
7. Click `Start Logging`.
8. Use the live workbook and per-port sheets while CSV and archive output continue in the background.

## Requirements

### Runtime Requirements

- Windows 10 or Windows 11
- Microsoft Excel installed locally for workbook integration
- Reachable OPC UA server endpoint

### Source Build Requirements

- Python 3.14.2
- PowerShell
- Inno Setup for installer generation

### Python Dependencies

The packaged desktop application bundles its runtime, but source execution requires Python packages.

Desktop packages:

```powershell
.\.venv\Scripts\python.exe -m pip install -r desktop\requirements.txt
```

OPC UA client package:

```powershell
.\.venv\Scripts\python.exe -m pip install opcua==0.98.13
```

If you are preparing a full local environment that also mirrors the wider repository tooling, you can additionally install:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

## Run From Source

Create the environment and launch the viewer:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r desktop\requirements.txt
.\.venv\Scripts\python.exe -m pip install opcua==0.98.13
.\.venv\Scripts\python.exe .\desktop\excel_viewer.py
```

If you want to run without the console window:

```powershell
.\.venv\Scripts\pythonw.exe .\desktop\excel_viewer.py
```

## CLI Bridge Execution

For direct bridge execution without the full desktop UI:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\scripts\run_excel_bridge.ps1 `
  -Endpoint "opc.tcp://192.168.1.108:4840" `
  -VisibleExcel
```

For CSV-oriented execution without showing Excel:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\scripts\run_excel_bridge.ps1 `
  -Endpoint "opc.tcp://192.168.1.108:4840" `
  -NoExcel
```

## Build The Windows EXE Bundle

Build the packaged desktop application:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build_excel_viewer.ps1
```

Main output:

```text
desktop\dist-excel-viewer\MasterwayExcelViewer\MasterwayExcelViewer.exe
```

## Build The Windows Installer

Generate the installer after the EXE bundle exists:

```powershell
cd desktop
powershell -ExecutionPolicy Bypass -File .\installer\build_installer.ps1 `
  -SourceDir '..\dist-excel-viewer\MasterwayExcelViewer' `
  -SetupName 'Masterway_OPCUA_Data_Logging_Setup'
```

Installer output:

```text
desktop\installer\dist\Masterway_OPCUA_Data_Logging_Setup.exe
```

## Repository Layout

```text
README.md
desktop/
  excel_viewer.py                    Main desktop operator UI
  build_excel_viewer.ps1             PyInstaller build helper
  masterway_excel_viewer.spec        PyInstaller spec
  requirements.txt                   Desktop packaging/runtime dependencies
  VERSION.txt                        Product version
  assets/
    masterway.ico                    Windows application icon
    masterway-brand.png              Brand asset
    masterway-brand-ui2.png          UI logo asset
  tools/
    masterway_excel_bridge.py        OPC UA / Excel / CSV bridge runtime
  scripts/
    run_excel_bridge.ps1             CLI bridge runner
    opcua_smoke_test.ps1             Basic OPC UA smoke test
  installer/
    build_installer.ps1              Inno Setup wrapper
    masterway.iss                    Installer definition
backend/
  requirements.txt                   Shared repository dependency list including opcua
```

## Deployment Notes

### Installer vs GitHub ZIP

A GitHub ZIP download is source code only. It is not the recommended operator delivery format.

Use one of the following for real deployment:

- packaged EXE bundle
- generated Windows installer

### Excel Requirement

Microsoft Excel must be installed on the target Windows PC if the workbook integration is required.

### OPC UA Security

The current workflow is aimed primarily at engineering environments using direct endpoint access and common anonymous / no-security test setups. If your production endpoint requires certificates, security policies, or stricter authentication, validate that server policy before deployment.

## Troubleshooting

### The endpoint is reachable in UaExpert but not in Masterway

Check:

- exact endpoint URL
- port accessibility
- path suffix such as `/masterway` if required by the server
- local firewall rules
- server security mode and authentication policy

### Excel is open but updates feel slow

Possible causes:

- too many discovered nodes
- too many fields staged for history
- aggressive retention pruning
- Excel COM delays on the PC
- slow OPC UA server response

### History looks too large or hard to review

Reduce the history selection list and enable an appropriate retention window so the archive CSV absorbs older rows while the active workbook remains compact.

## Current Product Direction

This repository is positioned as a practical Windows OPC UA logging product with:

- compact operator UI
- direct endpoint-driven workflow
- Excel live monitoring
- per-port sheet organization
- selected-field history logging
- rolling retention with archive export
- EXE packaging
- installer packaging

It is intended to be easy to operate on a real engineering PC while remaining transparent enough for technical validation and troubleshooting.
