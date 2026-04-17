param(
  [string]$SourceDir,
  [string]$SetupName
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$issPath = Join-Path $scriptDir 'masterway.iss'
$outputDir = Join-Path $scriptDir 'dist'
$versionPath = Join-Path $scriptDir '..\VERSION.txt'

if (-not (Test-Path $issPath)) {
  throw "Installer script not found at $issPath"
}

if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$appVersion = $null
if (Test-Path $versionPath) {
  $appVersion = (Get-Content $versionPath -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
}

$iscc = Get-Command iscc.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
  $fallbacks = @(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
  )

  foreach ($candidate in $fallbacks) {
    if (Test-Path $candidate) {
      $iscc = $candidate
      break
    }
  }

  if (-not $iscc) {
    throw 'ISCC.exe not found. Install Inno Setup 6 and try again.'
  }
}

$defineArgs = @()
if ($appVersion) {
  $defineArgs += "/DAppVersion=$appVersion"
}
if ($SourceDir) {
  $defineArgs += "/DAppSourceDir=$SourceDir"
}
if ($SetupName) {
  $defineArgs += "/DOutputBaseFilename=$SetupName"
}

& $iscc /O"$outputDir" @defineArgs $issPath
