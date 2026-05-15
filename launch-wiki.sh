#!/bin/bash
# ============================================================
#  Laundry Sci-Fi Wiki - macOS Launcher
#  ------------------------------------------------------------
#  1. Starts Python's built-in HTTP server in the background,
#     rooted at this script's folder.
#  2. Opens the wiki in your default browser.
#  3. Keeps running until you close this Terminal window,
#     then shuts the server down automatically.
# ============================================================

PORT=8765
ROOT="$(cd "$(dirname "$0")" && pwd)"
URL="http://localhost:${PORT}/index.html"

echo ""
echo "  Starting local server  http://localhost:${PORT}/"
echo "  Serving from           ${ROOT}"
echo ""

# Start Python HTTP server in the background
python3 -m http.server "${PORT}" --directory "${ROOT}" &
SERVER_PID=$!

# Trap Ctrl-C / script exit so the server is always cleaned up
cleanup() {
    echo ""
    echo "  Shutting down server..."
    kill "${SERVER_PID}" 2>/dev/null
    wait "${SERVER_PID}" 2>/dev/null
    echo "  Done."
    exit 0
}
trap cleanup INT TERM EXIT

# Give the server a moment to bind to the port
sleep 1

echo "  Opening wiki in browser..."
echo "  (Close this Terminal window to shut the server down.)"
echo ""

open "${URL}"

# Keep the script alive so the trap can fire on window close
wait "${SERVER_PID}"
