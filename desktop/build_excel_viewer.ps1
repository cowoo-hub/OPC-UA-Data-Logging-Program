$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $repoRoot '.venv\Scripts\python.exe'
$distDir = Join-Path $PSScriptRoot 'dist-excel-viewer'
$buildDir = Join-Path $PSScriptRoot 'build-excel-viewer'
$specPath = Join-Path $PSScriptRoot 'masterway_excel_viewer.spec'

if (-not (Test-Path $pythonExe)) {
  throw "Python virtual environment not found at $pythonExe"
}

& $pythonExe -m PyInstaller $specPath --noconfirm --clean --distpath $distDir --workpath $buildDir
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller build failed with exit code $LASTEXITCODE"
}
