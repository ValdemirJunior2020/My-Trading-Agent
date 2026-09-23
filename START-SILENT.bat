@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "SERVER_HOST=127.0.0.1"
set "SERVER_PORT=8787"
set "APP_URL=http://127.0.0.1:8787/"

where node >nul 2>&1 || exit /b 1
where npm >nul 2>&1 || exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 exit /b 0

where ollama >nul 2>&1
if not errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
  if errorlevel 1 start "Ollama - My Trading Agent" /min ollama serve
)

start "My Trading Agent Server" /min cmd /c "cd /d ""%CD%"" && set SERVER_HOST=127.0.0.1&& set SERVER_PORT=8787&& node server-dist\index.js"
exit /b 0
