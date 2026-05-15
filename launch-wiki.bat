@echo off
setlocal

set "PORT=8765"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "URL=http://localhost:%PORT%/index.html"

echo ============================================================
echo   Laundry Sci-Fi Wiki - Local Server
echo ============================================================
echo.
echo   Serving from:  %ROOT%
echo   URL copied to clipboard:
echo.
echo     %URL%
echo.
echo   Paste into Chrome to open the wiki.
echo   Close this window to shut the server down.
echo.
echo ============================================================
echo.

echo %URL% | clip

powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%PORT%; $root='%ROOT%'; $listener=New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:'+$port+'/'); $listener.Start(); Write-Host 'Server running. Press Ctrl+C to stop.'; $mime=@{'.html'='text/html; charset=utf-8';'.htm'='text/html; charset=utf-8';'.css'='text/css; charset=utf-8';'.js'='application/javascript; charset=utf-8';'.mjs'='application/javascript; charset=utf-8';'.json'='application/json; charset=utf-8';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.gif'='image/gif';'.svg'='image/svg+xml';'.ico'='image/x-icon';'.txt'='text/plain; charset=utf-8';'.woff'='font/woff';'.woff2'='font/woff2';'.webp'='image/webp';'.map'='application/json';'.ttf'='font/ttf'}; try { while ($listener.IsListening) { $ctx=$listener.GetContext(); $req=$ctx.Request; $res=$ctx.Response; try { $p=[Uri]::UnescapeDataString($req.Url.AbsolutePath); if ($p -eq '/') { $p='/wiki/index.html' }; $file=Join-Path $root $p.TrimStart('/'); $rp=$null; try { $rp=(Resolve-Path -LiteralPath $file -ErrorAction Stop).Path } catch {}; if ($rp -and $rp.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $rp -PathType Leaf)) { $ext=[IO.Path]::GetExtension($rp).ToLower(); $ct=$mime[$ext]; if (-not $ct) { $ct='application/octet-stream' }; $bytes=[IO.File]::ReadAllBytes($rp); $res.ContentType=$ct; $res.ContentLength64=$bytes.Length; $res.OutputStream.Write($bytes,0,$bytes.Length) } else { $res.StatusCode=404; $msg=[Text.Encoding]::UTF8.GetBytes('404 Not Found'); $res.ContentLength64=$msg.Length; $res.OutputStream.Write($msg,0,$msg.Length) } } catch { try { $res.StatusCode=500 } catch {} } finally { try { $res.Close() } catch {} } } } finally { $listener.Stop(); $listener.Close() }"

endlocal
