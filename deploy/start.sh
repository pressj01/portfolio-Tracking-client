#!/bin/bash
echo "Starting Portfolio Tracking Client..."
echo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if database exists, create if not
if [ ! -f "$SCRIPT_DIR/backend/portfolio.db" ]; then
    echo "First run - creating database..."
    cd "$SCRIPT_DIR/backend"
    python3 -c "from database import ensure_tables_exist; from config import get_connection; conn = get_connection(); ensure_tables_exist(conn); conn.close()"
fi

# Start Flask backend
echo "Starting backend server..."
cd "$SCRIPT_DIR"
python3 backend/app.py &
FLASK_PID=$!

# Wait for Flask to be ready
echo "Waiting for backend..."
sleep 3

# Launch Electron app
echo "Launching application..."
NODE_ENV=production npx electron .

# When Electron closes, kill Flask
echo "Shutting down..."
kill $FLASK_PID 2>/dev/null
