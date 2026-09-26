@echo off
setlocal EnableExtensions EnableDelayedExpansion
title My Trading Agent - Start
cd /d "%~dp0"

set "SERVER_HOST=127.0.0.1"
set "SERVER_PORT=8787"
set "APP_URL=http://127.0.0.1:8787/"

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
  for /L %%O in (1,1,20) do (
   powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
   if not errorlevel 1 goto :ollama_ready
   timeout /t 1 /nobreak >nul
  )
  echo [WARN] Ollama did not answer yet. Server will still start safely.
  :ollama_ready
 ) else (
  echo [OK] Ollama already running.
 )
)

echo [CHECK] Testing %APP_URL%api/health ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%APP_URL%api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 goto :open

echo [START] Launching My Trading Agent server on port 8787...
start "My Trading Agent Server" cmd /k "cd /d ""%CD%"" && set SERVER_HOST=127.0.0.1&& set SERVER_PORT=8787&& node server-dist\index.js"

echo [WAIT] Waiting for port 8787...
for /L %%S in (1,1,30) do (
 powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%APP_URL%api/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
 if not errorlevel 1 goto :open
 timeout /t 1 /nobreak >nul
)

goto :failed

:open
echo.
echo [OK] Server confirmed at %APP_URL%
echo [OPEN] Opening a NEW Edge window on port 8787...

set "EDGE1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE1%" (
 start "" "%EDGE1%" --new-window "%APP_URL%"
 exit /b 0
)

if exist "%EDGE2%" (
 start "" "%EDGE2%" --new-window "%APP_URL%"
 exit /b 0
)

echo [INFO] Edge executable not found in the normal folders. Using Windows URL handler.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%APP_URL%'"
exit /b 0

:install
echo [SETUP] Missing or outdated setup detected. Running INSTALL.bat...
call "INSTALL.bat"
if errorlevel 1 exit /b 1
call "%~f0"
exit /b %errorlevel%

:failed
echo.
echo ============================================================
echo START FAILED
echo ============================================================
echo The program did NOT respond at:
echo   %APP_URL%
echo.
echo Leave the black "My Trading Agent Server" window open and
echo read the error shown there. Do NOT use port 8765.
echo.
echo You can also test this exact address manually:
echo   http://127.0.0.1:8787/api/health
echo.
pause
exit /b 1
