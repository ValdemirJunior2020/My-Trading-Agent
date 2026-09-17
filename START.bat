@echo off
setlocal EnableExtensions
title My Trading Agent - Start
cd /d "%~dp0"
set "APP_URL=http://127.0.0.1:8787"

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

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
 echo [OK] My Trading Agent is already running.
 start "" "%APP_URL%"
 exit /b 0
)

echo [START] Starting local server and client...
start "My Trading Agent Server" cmd /k "cd /d ""%CD%"" && npm start"

for /L %%S in (1,1,20) do (
 powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%/api/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
 if not errorlevel 1 goto :open
 timeout /t 1 /nobreak >nul
)
goto :failed

:open
echo [OK] My Trading Agent is ready.
start "" "%APP_URL%"
exit /b 0

:install
echo [SETUP] Missing or outdated setup detected. Running INSTALL.bat...
call "INSTALL.bat"
if errorlevel 1 exit /b 1
call "%~f0"
exit /b %errorlevel%

:failed
echo [ERROR] My Trading Agent did not start.
echo Check the server window for the exact error.
pause
exit /b 1
