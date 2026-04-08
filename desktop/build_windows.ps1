$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot 'frontend'
$pythonExe = Join-Path $repoRoot '.venv\Scripts\python.exe'
$distDir = Join-Path $PSScriptRoot 'dist'
$buildDir = Join-Path $PSScriptRoot 'build'
$specPath = Join-Path $PSScriptRoot 'masterway.spec'

if (-not (Test-Path $pythonExe)) {
  throw "Python virtual environment not found at $pythonExe"
}

Push-Location $frontendDir
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Frontend production build failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

& $pythonExe -m PyInstaller $specPath --noconfirm --clean --distpath $distDir --workpath $buildDir
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller build failed with exit code $LASTEXITCODE"
}
