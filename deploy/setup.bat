@echo off
echo ============================================
echo  Portfolio Tracking Client - Setup
echo ============================================
echo.

:: Check Python
py --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Install Python 3.10+ and ensure 'py' is in PATH.
    pause
    exit /b 1
)

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

echo [1/3] Installing Python dependencies...
cd /d "%~dp0backend"
py -m pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Python dependencies.
    pause
    exit /b 1
)

echo [2/3] Installing Node.js dependencies...
cd /d "%~dp0"
call npm install --silent
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Node dependencies.
    pause
    exit /b 1
)

echo [3/3] Initializing blank database...
cd /d "%~dp0backend"
py -c "from database import ensure_tables_exist; from config import get_connection; conn = get_connection(); ensure_tables_exist(conn); conn.close(); print('Database created: portfolio.db')"
if %errorlevel% neq 0 (
    echo ERROR: Failed to create database.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Setup complete!
echo  Run start.bat to launch the application.
echo ============================================
pause
