#!/bin/bash
echo "============================================"
echo " Portfolio Tracking Client - Setup"
echo "============================================"
echo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "ERROR: Python 3 not found. Install Python 3.10+ first."
    exit 1
fi

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Install Node.js 18+ from https://nodejs.org"
    exit 1
fi

echo "[1/3] Installing Python dependencies..."
cd "$SCRIPT_DIR/backend"
python3 -m pip install -r requirements.txt --quiet
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install Python dependencies."
    exit 1
fi

echo "[2/3] Installing Node.js dependencies..."
cd "$SCRIPT_DIR"
npm install --silent
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install Node dependencies."
    exit 1
fi

echo "[3/3] Initializing blank database..."
cd "$SCRIPT_DIR/backend"
python3 -c "from database import ensure_tables_exist; from config import get_connection; conn = get_connection(); ensure_tables_exist(conn); conn.close(); print('Database created: portfolio.db')"
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create database."
    exit 1
fi

echo
echo "============================================"
echo " Setup complete!"
echo " Run ./start.sh to launch the application."
echo "============================================"
