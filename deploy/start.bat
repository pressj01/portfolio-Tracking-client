@echo off
echo Starting Portfolio Tracking Client...
echo.

:: Check if database exists, create if not
if not exist "%~dp0backend\portfolio.db" (
    echo First run - creating database...
    cd /d "%~dp0backend"
    py -c "from database import ensure_tables_exist; from config import get_connection; conn = get_connection(); ensure_tables_exist(conn); conn.close()"
)

:: Start Flask backend
echo Starting backend server...
cd /d "%~dp0"
start /b py backend/app.py

:: Wait for Flask to be ready
echo Waiting for backend...
timeout /t 3 /nobreak >nul

:: Launch Electron app
echo Launching application...
set NODE_ENV=production
npx electron .

:: When Electron closes, kill Flask
echo Shutting down...
taskkill /f /im python.exe /fi "WINDOWTITLE eq *app.py*" >nul 2>&1
