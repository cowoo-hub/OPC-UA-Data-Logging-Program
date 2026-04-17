param(
  [string]$ExePath,
  [string]$OpcUaHost = '127.0.0.1',
  [int]$OpcUaPort = 4840,
  [int]$BackendPort = 4870,
  [int]$RunSeconds = 30,
  [string]$EndpointPath = 'masterway',
  [int]$StartupTimeoutSeconds = 40
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

if (-not $ExePath) {
  $ExePath = Join-Path $repoRoot 'desktop\dist\Masterway\Masterway.exe'
}

if (-not (Test-Path $ExePath)) {
  throw "Masterway executable not found: $ExePath"
}

$pythonPath = Join-Path $repoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $pythonPath)) {
  throw "Python virtual environment not found: $pythonPath"
}

$appDataDir = Join-Path $env:LOCALAPPDATA 'Masterway'
if (-not (Test-Path $appDataDir)) {
  New-Item -ItemType Directory -Force -Path $appDataDir | Out-Null
}

$settingsPath = Join-Path $appDataDir 'runtime_settings.local.json'
$settingsPayload = @{
  opcua = @{
    enabled = $true
    host = $OpcUaHost
    port = $OpcUaPort
    path = $EndpointPath
    namespace_uri = 'urn:masterway:opcua'
    server_name = 'Masterway OPC UA Server'
    security_mode = 'none'
    anonymous = $true
    writable = $false
  }
}
$settingsPayload | ConvertTo-Json -Depth 6 | Set-Content -Path $settingsPath -Encoding UTF8

$env:MASTERWAY_RUNTIME_SETTINGS_FILE = $settingsPath

$proc = Start-Process -FilePath $ExePath -ArgumentList @(
  '--no-gui',
  "--backend-port=$BackendPort",
  "--run-seconds=$RunSeconds"
) -PassThru

try {
  $healthUrl = "http://127.0.0.1:$BackendPort/health"
  $statusUrl = "http://127.0.0.1:$BackendPort/opcua/status"
  $healthDeadline = (Get-Date).AddSeconds([Math]::Max(10, [int]($StartupTimeoutSeconds / 2)))
  $statusDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)

  $healthReady = $false
  $lastHealthError = $null
  while ((Get-Date) -lt $healthDeadline) {
    try {
      $health = Invoke-RestMethod -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
      if ($health -and $health.status) {
        $healthReady = $true
        break
      }
    } catch {
      $lastHealthError = $_
      Start-Sleep -Milliseconds 300
    }
  }

  if (-not $healthReady) {
    throw "Backend did not become healthy at $healthUrl. Last error: $lastHealthError"
  }

  $running = $false
  $lastStatusError = $null
  while ((Get-Date) -lt $statusDeadline) {
    try {
      $status = Invoke-RestMethod -UseBasicParsing -Uri $statusUrl -TimeoutSec 2
      if ($status.opcua -and $status.opcua.last_error) {
        throw "OPC UA reported an error: $($status.opcua.last_error)"
      }
      if ($status.opcua -and $status.opcua.running) {
        $running = $true
        break
      }
    } catch {
      $lastStatusError = $_
      Start-Sleep -Milliseconds 300
    }
  }

  if (-not $running) {
    throw "OPC UA server did not reach running state at $statusUrl. Last error: $lastStatusError"
  }

  $clientHost = if ($OpcUaHost -eq '0.0.0.0') { '127.0.0.1' } else { $OpcUaHost }
  $endpointUrl = "opc.tcp://$clientHost`:$OpcUaPort/$EndpointPath"
  $env:MASTERWAY_OPCUA_ENDPOINT = $endpointUrl
  $pythonCommand = @'
# -*- coding: utf-8 -*-
import os
from opcua import Client

endpoint = os.environ.get("MASTERWAY_OPCUA_ENDPOINT")
if not endpoint:
    raise RuntimeError("MASTERWAY_OPCUA_ENDPOINT is not set")

client = Client(endpoint)
client.connect()
try:
    idx = client.get_namespace_index("urn:masterway:opcua")
    objects = client.get_objects_node()
    masterway = objects.get_child([f"{idx}:Masterway"])
    system = masterway.get_child([f"{idx}:System"])
    node = system.get_child([f"{idx}:Status"])
    value = node.get_value()
    print(f"OPC UA connected, status={value}")
finally:
    client.disconnect()
'@

  $pythonScript = Join-Path $env:TEMP ("masterway_opcua_smoke_" + $PID + ".py")
  Set-Content -Path $pythonScript -Value $pythonCommand -Encoding UTF8
  & $pythonPath $pythonScript
  $exitCode = $LASTEXITCODE
  if (Test-Path $pythonScript) {
    Remove-Item -Force $pythonScript
  }
  if ($exitCode -ne 0) {
    throw "Python OPC UA client exited with code $exitCode"
  }
  Write-Host "OPC UA smoke test passed."
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
