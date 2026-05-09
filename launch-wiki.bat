@echo off
setlocal

REM ============================================================
REM  Laundry Sci-Fi Wiki - Local Launcher
REM  ------------------------------------------------------------
REM  1. Starts a tiny PowerShell-based HTTP server in a minimized
REM     window, rooted at this .bat's folder.
REM  2. Launches Microsoft Edge in "app" mode (chromeless window:
REM     no tabs, no address bar, no menu) pointed at the wiki.
REM  3. Waits for that Edge window to close, then automatically
REM     shuts the server down.
REM
REM  No external tools required (no Python, no Node) - uses only
REM  PowerShell's built-in System.Net.HttpListener.
REM ============================================================

set "PORT=8765"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "URL=http://localhost:%PORT%/index.html"
set "EDGE_PROFILE=%TEMP%\LaundryWikiEdge"
set "SERVER_TITLE=Laundry Wiki Server"

echo.
echo   Starting local server  http://localhost:%PORT%/
echo   Serving from           %ROOT%
echo.

REM ---- Spin up the PowerShell HTTP server in a minimized window ----
start "%SERVER_TITLE%" /min powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ErrorActionPreference='Stop'; $port=%PORT%; $root=(Resolve-Path '%ROOT%').Path; $listener=New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:'+$port+'/'); $listener.Start(); Write-Host ('Listening on http://localhost:' + $port + '/  (root: ' + $root + ')'); $mime=@{'.html'='text/html; charset=utf-8';'.htm'='text/html; charset=utf-8';'.css'='text/css; charset=utf-8';'.js'='application/javascript; charset=utf-8';'.mjs'='application/javascript; charset=utf-8';'.json'='application/json; charset=utf-8';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.gif'='image/gif';'.svg'='image/svg+xml';'.ico'='image/x-icon';'.txt'='text/plain; charset=utf-8';'.woff'='font/woff';'.woff2'='font/woff2';'.webp'='image/webp';'.map'='application/json'}; try { while ($listener.IsListening) { $ctx=$listener.GetContext(); $req=$ctx.Request; $res=$ctx.Response; try { $p=[Uri]::UnescapeDataString($req.Url.AbsolutePath); if ($p -eq '/') { $p='/index.html' }; $file=Join-Path $root $p.TrimStart('/'); $rp=$null; try { $rp=(Resolve-Path -LiteralPath $file -ErrorAction Stop).Path } catch {}; if ($rp -and $rp.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $rp -PathType Leaf)) { $ext=[IO.Path]::GetExtension($rp).ToLower(); $ct=$mime[$ext]; if (-not $ct) { $ct='application/octet-stream' }; $bytes=[IO.File]::ReadAllBytes($rp); $res.ContentType=$ct; $res.ContentLength64=$bytes.Length; $res.OutputStream.Write($bytes,0,$bytes.Length) } else { $res.StatusCode=404; $msg=[Text.Encoding]::UTF8.GetBytes('404 Not Found'); $res.ContentLength64=$msg.Length; $res.OutputStream.Write($msg,0,$msg.Length) } } catch { try { $res.StatusCode=500 } catch {} } finally { try { $res.Close() } catch {} } } } finally { $listener.Stop(); $listener.Close() }"

REM ---- Give the listener a moment to bind to the port ----
timeout /t 1 /nobreak >nul

echo   Launching Microsoft Edge in app mode...
echo   (Close the Edge window to shut everything down.)
echo.

REM ---- Launch Edge in chromeless app mode with isolated profile ----
REM  --user-data-dir forces a separate Edge process, so /wait actually
REM  waits for THIS window to close (otherwise Edge would just hand off
REM  to an already-running instance and return immediately).
start /wait msedge --user-data-dir="%EDGE_PROFILE%" --app=%URL%

echo   Shutting down server...
taskkill /FI "WINDOWTITLE eq %SERVER_TITLE%*" /T /F >nul 2>&1

endlocal
exit /b 0
