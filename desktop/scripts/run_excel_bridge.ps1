param(
  [string]$Endpoint = "",
  [string]$NamespaceUri = "urn:masterway:opcua",
  [int]$PollMs = 100,
  [int]$ExcelMs = 250,
  [int]$HistoryMs = 1000,
  [int]$SaveMs = 30000,
  [int]$DurationSeconds = 0,
  [ValidateSet("pdi-fields", "masterway", "custom")]
  [string]$DiscoverMode = "pdi-fields",
  [switch]$VisibleExcel,
  [switch]$NoExcel,
  [switch]$NoExcelHistory
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$pythonPath = Join-Path $repoRoot '.venv\Scripts\python.exe'
$scriptPath = Join-Path $repoRoot 'desktop\tools\masterway_excel_bridge.py'

if (-not (Test-Path $pythonPath)) {
  throw "Python virtual environment not found: $pythonPath"
}

if (-not (Test-Path $scriptPath)) {
  throw "Bridge script not found: $scriptPath"
}

if ([string]::IsNullOrWhiteSpace($Endpoint)) {
  $Endpoint = Read-Host "Enter OPC UA endpoint (example: opc.tcp://192.168.1.108:4840)"
}

if ([string]::IsNullOrWhiteSpace($Endpoint)) {
  throw "Endpoint is required."
}

$arguments = @(
  $scriptPath,
  "--endpoint=$Endpoint",
  "--namespace-uri=$NamespaceUri",
  "--poll-ms=$PollMs",
  "--excel-ms=$ExcelMs",
  "--history-ms=$HistoryMs",
  "--save-ms=$SaveMs",
  "--duration-seconds=$DurationSeconds",
  "--discover-mode=$DiscoverMode"
)

if ($VisibleExcel) {
  $arguments += "--visible-excel"
}

if ($NoExcel) {
  $arguments += "--no-excel"
}

if ($NoExcelHistory) {
  $arguments += "--no-excel-history"
}

& $pythonPath @arguments
