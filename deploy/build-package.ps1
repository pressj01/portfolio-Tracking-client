$src = "C:\Users\Press\Portfolio_Tracking_client"
$out = "C:\Users\Press\Desktop\PortfolioTrackingClient"

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Path $out -Force | Out-Null
New-Item -ItemType Directory -Path "$out\backend\uploads" -Force | Out-Null
New-Item -ItemType Directory -Path "$out\electron" -Force | Out-Null

# Backend python files
Copy-Item "$src\backend\*.py" "$out\backend\"
Copy-Item "$src\backend\requirements.txt" "$out\backend\"

# Built frontend
Copy-Item "$src\dist" "$out\dist" -Recurse

# Electron
Copy-Item "$src\electron\main.js" "$out\electron\"

# Config files
Copy-Item "$src\package.json" "$out\"
Copy-Item "$src\package-lock.json" "$out\"
Copy-Item "$src\index.html" "$out\"
Copy-Item "$src\vite.config.js" "$out\"

# Startup scripts
Copy-Item "$src\deploy\setup.bat" "$out\"
Copy-Item "$src\deploy\start.bat" "$out\"
Copy-Item "$src\deploy\start-browser.bat" "$out\"

Write-Host "Files copied to $out"
Get-ChildItem $out -Recurse -File | Measure-Object -Property Length -Sum | ForEach-Object { Write-Host ("Total size: {0:N2} MB" -f ($_.Sum / 1MB)) }

# Create zip
$zipPath = "$out.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
Compress-Archive -Path "$out\*" -DestinationPath $zipPath -Force
Get-Item $zipPath | ForEach-Object { Write-Host ("Zip created: {0} ({1:N2} MB)" -f $_.FullName, ($_.Length / 1MB)) }
