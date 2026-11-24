@echo off
setlocal
cd /d "%~dp0"
title THE LION - Local paper trading
if /i "%~1"=="--uninstall" (
 reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v NexusTradingLion /f
 exit /b
)
if /i not "%~1"=="--startup" (
 reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v NexusTradingLion /t REG_SZ /d "\"%~f0\" --startup" /f >nul
 if errorlevel 1 goto fail
)
where node >nul 2>&1
if errorlevel 1 goto missing
where npm >nul 2>&1
if errorlevel 1 goto missing
if not exist "node_modules\@modelcontextprotocol\sdk\package.json" (
 call npm install
 if errorlevel 1 goto fail
)
powershell -NoProfile -Command "$p=Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue; if($p){exit 0}else{exit 1}"
if not errorlevel 1 (
 echo Port 8790 is already in use. No duplicate server will be started.
 start "" "http://127.0.0.1:8790/"
 exit /b
)
where ollama >nul 2>&1
if not errorlevel 1 (
 powershell -NoProfile -Command "try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }"
 if errorlevel 1 start "THE LION - Ollama" /min ollama serve
) else (
 echo Ollama not found in PATH. Start or install it separately for AI commentary.
)
echo Reusing encrypted Robinhood session if available. Authorize only if requested.
echo Paper mode only. Leave this window open.
start "THE LION - Dashboard opener" /min powershell -NoProfile -Command "for($i=0;$i -lt 900;$i++){try{Invoke-WebRequest 'http://127.0.0.1:8790/' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://127.0.0.1:8790/'; break}catch{Start-Sleep -Seconds 2}}"
call npm run start:robinhood
if errorlevel 1 goto fail
exit /b
:missing
echo Node.js or npm is missing from PATH.
:fail
echo THE LION could not start. Review the messages above.
pause
exit /b 1
