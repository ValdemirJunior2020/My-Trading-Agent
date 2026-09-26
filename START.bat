@echo off
setlocal EnableExtensions EnableDelayedExpansion
title My Trading Agent - Start
cd /d "%~dp0"

set "SERVER_HOST=127.0.0.1"
set "SERVER_PORT=8787"
set "APP_URL=http://127.0.0.1:8787/"
set "HEALTH_URL=http://127.0.0.1:8787/api/health"

echo.
echo ============================================================
echo              MY TRADING AGENT - START
echo ============================================================
echo Project folder: %CD%
echo App address:    %APP_URL%
echo.

where node >nul 2>&1
if errorlevel 1 goto :install
where npm >nul 2>&1
if errorlevel 1 goto :install

call npm ls --depth=0 >nul 2>&1
if errorlevel 1 goto :install

echo [BUILD] Rebuilding latest server + client...
call npm run build
if errorlevel 1 goto :failed

where ollama >nul 2>&1
if not errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo [START] Starting Ollama...
    start "Ollama - My Trading Agent" /min ollama serve
    echo [WAIT] Waiting for Ollama...
    set "OLLAMA_READY=0"
    for /L %%O in (1,1,20) do (
      if "!OLLAMA_READY!"=="0" (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
        if not errorlevel 1 (
          set "OLLAMA_READY=1"
        ) else (
          timeout /t 1 /nobreak >nul
        )
      )
    )
    if "!OLLAMA_READY!"=="0" echo [WARN] Ollama did not answer yet. Server will still start safely.
  ) else (
    echo [OK] Ollama already running.
  )
) else (
  echo [WARN] Ollama command was not found. Server will still start safely.
)

echo [CHECK] Looking for an existing server on port 8787...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 goto :open

echo [START] Launching My Trading Agent server on port 8787...
start "My Trading Agent Server" cmd /k "cd /d ""%CD%"" && set SERVER_HOST=127.0.0.1&& set SERVER_PORT=8787&& node server-dist\index.js"

echo [WAIT] Waiting for server health check...
set "SERVER_READY=0"
for /L %%S in (1,1,30) do (
  if "!SERVER_READY!"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
    if not errorlevel 1 (
      set "SERVER_READY=1"
    ) else (
      timeout /t 1 /nobreak >nul
    )
  )
)

if "!SERVER_READY!"=="0" goto :failed

:open
echo.
echo [OK] Server confirmed at %APP_URL%
echo [OPEN] Opening My Trading Agent frontend...
start "" "%APP_URL%"
if not errorlevel 1 exit /b 0

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%APP_URL%'" >nul 2>&1
if not errorlevel 1 exit /b 0

echo [WARN] Server is running, but Windows could not open the browser automatically.
echo [OPEN MANUALLY] %APP_URL%
pause
exit /b 0

:install
echo [SETUP] Missing setup detected. Running INSTALL.bat...
call "INSTALL.bat"
if errorlevel 1 exit /b 1
call "%~f0"
exit /b %errorlevel%

:failed
echo.
echo ============================================================
echo START FAILED
echo ============================================================
echo The server did not become healthy at:
echo   %HEALTH_URL%
echo.
echo Check the "My Trading Agent Server" window for the error.
echo.
pause
exit /b 1
