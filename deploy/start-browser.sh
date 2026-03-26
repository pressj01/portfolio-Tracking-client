#!/bin/bash
echo "Starting Portfolio Tracking Client (Browser Mode)..."
echo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if database exists, create if not
if [ ! -f "$SCRIPT_DIR/backend/portfolio.db" ]; then
    echo "First run - creating database..."
    cd "$SCRIPT_DIR/backend"
    python3 -c "from database import ensure_tables_exist; from config import get_connection; conn = get_connection(); ensure_tables_exist(conn); conn.close()"
fi

# Build frontend if dist doesn't exist
if [ ! -f "$SCRIPT_DIR/dist/index.html" ]; then
    echo "Building frontend..."
    cd "$SCRIPT_DIR"
    npm run build
fi

# Start Flask backend
echo "Starting backend on http://localhost:5001 ..."
cd "$SCRIPT_DIR"
python3 backend/app.py &
FLASK_PID=$!

# Wait for Flask
sleep 3

# Open in default browser
echo "Opening in browser..."
open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null

# Start Vite to serve frontend
echo "Starting frontend server..."
npx vite

# Cleanup
echo "Shutting down..."
kill $FLASK_PID 2>/dev/null
