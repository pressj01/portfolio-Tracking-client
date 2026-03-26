$src = "C:\Users\Press\Portfolio_Tracking_client"
$releaseDir = "$src\release"
$version = (Get-Content "$src\package.json" | ConvertFrom-Json).version

# Staging dirs (temp, cleaned up after zipping)
$outWin = "$env:TEMP\PortfolioTrackingClient-Win"
$outMac = "$env:TEMP\PortfolioTrackingClient-Mac"

# ── Windows Package ──────────────────────────────────────────────────────────
Write-Host "=== Building Windows Package (v$version) ===" -ForegroundColor Cyan

if (Test-Path $outWin) { Remove-Item -Recurse -Force $outWin }
New-Item -ItemType Directory -Path $outWin -Force | Out-Null
New-Item -ItemType Directory -Path "$outWin\backend\uploads" -Force | Out-Null
New-Item -ItemType Directory -Path "$outWin\electron" -Force | Out-Null

# Backend python files
Copy-Item "$src\backend\*.py" "$outWin\backend\"
Copy-Item "$src\backend\requirements.txt" "$outWin\backend\"

# Built frontend
Copy-Item "$src\dist" "$outWin\dist" -Recurse

# Electron
Copy-Item "$src\electron\main.js" "$outWin\electron\"

# Config files
Copy-Item "$src\package.json" "$outWin\"
Copy-Item "$src\package-lock.json" "$outWin\"
Copy-Item "$src\index.html" "$outWin\"
Copy-Item "$src\vite.config.js" "$outWin\"

# Windows startup scripts
Copy-Item "$src\deploy\setup.bat" "$outWin\"
Copy-Item "$src\deploy\start.bat" "$outWin\"
Copy-Item "$src\deploy\start-browser.bat" "$outWin\"

Write-Host "Windows files staged"
Get-ChildItem $outWin -Recurse -File | Measure-Object -Property Length -Sum | ForEach-Object { Write-Host ("Total size: {0:N2} MB" -f ($_.Sum / 1MB)) }

# Create Windows zip in release folder
$zipWin = "$releaseDir\PortfolioTrackingClient-Win-$version.zip"
if (Test-Path $zipWin) { Remove-Item $zipWin }
Compress-Archive -Path "$outWin\*" -DestinationPath $zipWin -Force
Get-Item $zipWin | ForEach-Object { Write-Host ("Zip created: {0} ({1:N2} MB)" -f $_.FullName, ($_.Length / 1MB)) }
Remove-Item -Recurse -Force $outWin

# ── Mac Package ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Building Mac Package (v$version) ===" -ForegroundColor Cyan

if (Test-Path $outMac) { Remove-Item -Recurse -Force $outMac }
New-Item -ItemType Directory -Path $outMac -Force | Out-Null
New-Item -ItemType Directory -Path "$outMac\backend\uploads" -Force | Out-Null
New-Item -ItemType Directory -Path "$outMac\electron" -Force | Out-Null

# Backend python files
Copy-Item "$src\backend\*.py" "$outMac\backend\"
Copy-Item "$src\backend\requirements.txt" "$outMac\backend\"

# Built frontend
Copy-Item "$src\dist" "$outMac\dist" -Recurse

# Electron
Copy-Item "$src\electron\main.js" "$outMac\electron\"

# Config files
Copy-Item "$src\package.json" "$outMac\"
Copy-Item "$src\package-lock.json" "$outMac\"
Copy-Item "$src\index.html" "$outMac\"
Copy-Item "$src\vite.config.js" "$outMac\"

# Mac startup scripts
Copy-Item "$src\deploy\setup.sh" "$outMac\"
Copy-Item "$src\deploy\start.sh" "$outMac\"
Copy-Item "$src\deploy\start-browser.sh" "$outMac\"

Write-Host "Mac files staged"
Get-ChildItem $outMac -Recurse -File | Measure-Object -Property Length -Sum | ForEach-Object { Write-Host ("Total size: {0:N2} MB" -f ($_.Sum / 1MB)) }

# Create Mac zip in release folder
$zipMac = "$releaseDir\PortfolioTrackingClient-Mac-$version.zip"
if (Test-Path $zipMac) { Remove-Item $zipMac }
Compress-Archive -Path "$outMac\*" -DestinationPath $zipMac -Force
Get-Item $zipMac | ForEach-Object { Write-Host ("Zip created: {0} ({1:N2} MB)" -f $_.FullName, ($_.Length / 1MB)) }
Remove-Item -Recurse -Force $outMac

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
