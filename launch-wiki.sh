#!/bin/bash
# ============================================================
#  Laundry Sci-Fi Wiki - macOS Launcher
#  ------------------------------------------------------------
#  1. Starts Python's built-in HTTP server in the background,
#     rooted at this script's folder.
#  2. Launches a Chromium-based browser in "app" mode
#     (chromeless window: no tabs, no address bar, no menu)
#     pointed at the wiki, trying Edge → Chrome → Chromium in
#     order. Falls back to the system default browser if none
#     of those are installed.
#  3. Waits for that browser window to close, then shuts the
#     server down automatically.
#
#  No external tools required — uses only Python 3 (built into
#  macOS since Monterey) and whichever browser you have.
# ============================================================

PORT=8765
ROOT="$(cd "$(dirname "$0")" && pwd)"
URL="http://localhost:${PORT}/index.html"
BROWSER_PROFILE="/tmp/LaundryWikiProfile"

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

echo "  Launching browser in app mode..."
echo "  (Close the browser window to shut everything down.)"
echo ""

# Try Chromium-based browsers that support --app mode.
# Running the binary directly (rather than via `open`) blocks
# until the window closes, which is what lets us auto-shutdown.
if [ -d "/Applications/Microsoft Edge.app" ]; then
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
        --user-data-dir="${BROWSER_PROFILE}" \
        --app="${URL}" 2>/dev/null

elif [ -d "/Applications/Google Chrome.app" ]; then
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        --user-data-dir="${BROWSER_PROFILE}" \
        --app="${URL}" 2>/dev/null

elif [ -d "/Applications/Chromium.app" ]; then
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
        --user-data-dir="${BROWSER_PROFILE}" \
        --app="${URL}" 2>/dev/null

else
    # No Chromium browser found — open in whatever the default is.
    # The server won't auto-stop when you're done; press Ctrl-C here
    # or close this terminal window instead.
    echo "  No Edge/Chrome/Chromium found — opening in default browser."
    echo "  Press Ctrl-C in this window when you're finished."
    open "${URL}"
    wait "${SERVER_PID}"
fi
