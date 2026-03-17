@echo off
echo Starting Portfolio Tracking Client (Browser Mode)...
echo.

:: Check if database exists, create if not
if not exist "%~dp0backend\portfolio.db" (
    echo First run - creating database...
    cd /d "%~dp0backend"
    py -c "from database import ensure_tables_exist; from config import get_connection; conn = get_connection(); ensure_tables_exist(conn); conn.close()"
)

:: Build frontend if dist doesn't exist
if not exist "%~dp0dist\index.html" (
    echo Building frontend...
    cd /d "%~dp0"
    call npm run build
)

:: Start Flask backend
echo Starting backend on http://localhost:5001 ...
cd /d "%~dp0"
start /b py backend/app.py

:: Wait for Flask
timeout /t 3 /nobreak >nul

:: Open in default browser
echo Opening in browser...
start http://localhost:5173

:: Start Vite to serve frontend
echo Starting frontend server...
npx vite

:: Cleanup
echo Shutting down...
taskkill /f /im python.exe /fi "WINDOWTITLE eq *app.py*" >nul 2>&1
