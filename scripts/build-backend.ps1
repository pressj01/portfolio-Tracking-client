$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend"
$distDir = Join-Path $root "installer\flask-dist"
$workDir = Join-Path $root "installer\flask-build"
$backendOut = Join-Path $distDir "backend"
$appPath = Join-Path $backendDir "app.py"

if (-not (Test-Path $appPath)) {
  throw "Could not find backend app.py at $appPath"
}

Write-Host "Checking Python backend build dependencies..."
& py -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
  & py -m pip install -r (Join-Path $backendDir "requirements.txt") pyinstaller
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install backend build dependencies."
  }
}

$resolvedRoot = (Resolve-Path $root).Path
foreach ($target in @($workDir, $backendOut)) {
  if (Test-Path $target) {
    $resolvedTarget = (Resolve-Path $target).Path
    if (-not $resolvedTarget.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to delete path outside project: $resolvedTarget"
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

$dataSeparator = if ($IsWindows -or $env:OS -eq "Windows_NT") { ";" } else { ":" }
$hiddenImports = @(
  "flask",
  "flask_cors",
  "pandas",
  "openpyxl",
  "yfinance",
  "plotly",
  "scipy",
  "pypdf",
  "sqlite3",
  "statistics",
  "decimal",
  "config",
  "database",
  "import_data",
  "normalize",
  "grading",
  "create_template",
  "tax_report",
  "dividend_safety",
  "transaction_import",
  "portfolio_tester",
  "options_pricing",
  "options_api"
)
$dataFiles = @(
  "config.py${dataSeparator}.",
  "database.py${dataSeparator}.",
  "import_data.py${dataSeparator}.",
  "normalize.py${dataSeparator}.",
  "grading.py${dataSeparator}.",
  "create_template.py${dataSeparator}.",
  "tax_report.py${dataSeparator}.",
  "dividend_safety.py${dataSeparator}.",
  "transaction_import.py${dataSeparator}.",
  "portfolio_tester.py${dataSeparator}.",
  "options_pricing.py${dataSeparator}.",
  "options_api.py${dataSeparator}.",
  "seed${dataSeparator}seed"
)

$pyinstallerArgs = @(
  "--noconfirm",
  "--clean",
  "--distpath", $distDir,
  "--workpath", $workDir,
  "--name", "backend",
  "app.py"
)
foreach ($hiddenImport in $hiddenImports) {
  $pyinstallerArgs += @("--hidden-import", $hiddenImport)
}
foreach ($dataFile in $dataFiles) {
  $pyinstallerArgs += @("--add-data", $dataFile)
}

Push-Location $backendDir
try {
  Write-Host "Building Flask backend executable..."
  & py -m PyInstaller @pyinstallerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller backend build failed."
  }
}
finally {
  Pop-Location
}

$exeName = if ($IsWindows -or $env:OS -eq "Windows_NT") { "backend.exe" } else { "backend" }
$exePath = Join-Path $backendOut $exeName
if (-not (Test-Path $exePath)) {
  throw "Backend executable was not created at $exePath"
}

Write-Host "Backend executable ready: $exePath"
