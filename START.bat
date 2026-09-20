@echo off
setlocal EnableExtensions
title My Trading Agent - Start
cd /d "%~dp0"

rem Force one known local address even if an older .env still has SERVER_PORT=8765.
set "SERVER_HOST=127.0.0.1"
set "SERVER_PORT=8787"
set "APP_URL=http://127.0.0.1:8787"

echo.
echo ============================================================
echo              MY TRADING AGENT - START
echo ============================================================
echo Project folder: %CD%
echo App address:    %APP_URL%
echo Server port:    %SERVER_PORT%
echo.

where node >nul 2>&1
if errorlevel 1 goto :install
where npm >nul 2>&1
if errorlevel 1 goto :install

call npm ls --depth=0 >nul 2>&1
if errorlevel 1 goto :install

if not exist "dist\index.html" (
 echo [BUILD] Client build missing. Building now...
 call npm run build
 if errorlevel 1 goto :failed
)
if not exist "server-dist\index.js" (
 echo [BUILD] Server build missing. Building now...
 call npm run build
 if errorlevel 1 goto :failed
)

where ollama >nul 2>&1
if not errorlevel 1 (
 powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
 if errorlevel 1 (
  echo [START] Starting Ollama...
  start "Ollama - My Trading Agent" /min ollama serve
  timeout /t 3 /nobreak >nul
 ) else (
  echo [OK] Ollama already running.
 )
)

echo [CHECK] Looking for an existing server at %APP_URL%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
 echo [OK] My Trading Agent is already running on port 8787.
 echo [OPEN] %APP_URL%
 start "" "%APP_URL%"
 exit /b 0
)

echo [START] Starting local server on 127.0.0.1:8787...
start "My Trading Agent Server" cmd /k "cd /d ""%CD%"" && set SERVER_HOST=127.0.0.1&& set SERVER_PORT=8787&& npm start"

echo [WAIT] Waiting for the server...
for /L %%S in (1,1,30) do (
 powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%/api/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
 if not errorlevel 1 goto :open
 timeout /t 1 /nobreak >nul
)

goto :failed

:open
echo.
echo [OK] My Trading Agent is ready.
echo [OPEN] %APP_URL%
start "" "%APP_URL%"
exit /b 0

:install
echo [SETUP] Missing or outdated setup detected. Running INSTALL.bat...
call "INSTALL.bat"
if errorlevel 1 exit /b 1
call "%~f0"
exit /b %errorlevel%

:failed
echo.
echo [ERROR] My Trading Agent did not start on port 8787.
echo.
echo Check the black window titled "My Trading Agent Server".
echo It should say:
echo   My Trading Agent running at http://127.0.0.1:8787
echo.
echo If another old copy is using port 8765, close that old server window.
pause
exit /b 1
