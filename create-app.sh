#!/bin/bash
# Creates "Launch Wiki.app" in the same folder as this script.
# Run once — after that, double-click the .app to start the wiki.

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="${ROOT}/Launch Wiki.app"

osacompile -o "${APP_PATH}" -e "
set appDir to do shell script \"dirname \" & quoted form of POSIX path of (path to me)
tell application \"Terminal\"
    activate
    do script \"bash \" & quoted form of (appDir & \"/launch-wiki.sh\")
end tell
"

echo "Created: ${APP_PATH}"
echo "Double-click 'Launch Wiki.app' to start the wiki."
