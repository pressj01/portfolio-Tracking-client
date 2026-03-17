@echo off
echo ============================================
echo  Building Deployment Package
echo ============================================
echo.

set DEPLOY_DIR=%~dp0
set PROJECT_DIR=%DEPLOY_DIR%..
set OUTPUT=%USERPROFILE%\Desktop\PortfolioTrackingClient

:: Clean previous output
if exist "%OUTPUT%" rmdir /s /q "%OUTPUT%"
mkdir "%OUTPUT%"

echo [1/6] Copying backend...
xcopy "%PROJECT_DIR%\backend\*.py" "%OUTPUT%\backend\" /q
copy "%PROJECT_DIR%\backend\requirements.txt" "%OUTPUT%\backend\" >nul
mkdir "%OUTPUT%\backend\uploads" 2>nul

echo [2/6] Building frontend...
cd /d "%PROJECT_DIR%"
call npm run build
xcopy "%PROJECT_DIR%\dist" "%OUTPUT%\dist\" /s /e /q

echo [3/6] Copying Electron launcher...
xcopy "%PROJECT_DIR%\electron" "%OUTPUT%\electron\" /q

echo [4/6] Copying config files...
copy "%PROJECT_DIR%\package.json" "%OUTPUT%\" >nul
copy "%PROJECT_DIR%\package-lock.json" "%OUTPUT%\" >nul
copy "%PROJECT_DIR%\index.html" "%OUTPUT%\" >nul
copy "%PROJECT_DIR%\vite.config.js" "%OUTPUT%\" >nul

echo [5/6] Copying startup scripts...
copy "%DEPLOY_DIR%\setup.bat" "%OUTPUT%\" >nul
copy "%DEPLOY_DIR%\start.bat" "%OUTPUT%\" >nul
copy "%DEPLOY_DIR%\start-browser.bat" "%OUTPUT%\" >nul

echo [6/6] Creating zip archive...
cd /d "%USERPROFILE%\Desktop"
powershell -Command "Compress-Archive -Path '%OUTPUT%\*' -DestinationPath '%OUTPUT%.zip' -Force"

echo.
echo ============================================
echo  Done! Package created at:
echo  %OUTPUT%.zip
echo.
echo  Contents (no database, no node_modules):
echo    backend/        - Flask API + Python source
echo    dist/           - Built React frontend
echo    electron/       - Electron launcher
echo    setup.bat       - First-time setup
echo    start.bat       - Launch as Electron desktop app
echo    start-browser.bat - Launch in browser
echo ============================================
pause
