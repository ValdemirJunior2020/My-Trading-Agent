@echo off
setlocal EnableExtensions
title My Trading Agent - Enable Daily Auto Start
cd /d "%~dp0"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_FILE=%STARTUP_DIR%\My-Trading-Agent-Auto-Start.cmd"
set "START_BAT=%~dp0START-SILENT.bat"

if not exist "%START_BAT%" (
  echo [ERROR] START-SILENT.bat is missing.
  pause
  exit /b 1
)

if not exist "%STARTUP_DIR%" (
  echo [ERROR] Windows Startup folder was not found.
  pause
  exit /b 1
)

> "%STARTUP_FILE%" echo @echo off
>> "%STARTUP_FILE%" echo call "%START_BAT%"

if not exist "%STARTUP_FILE%" (
  echo [ERROR] Could not create the Startup launcher.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo              AUTO START ENABLED
echo ============================================================
echo [OK] No administrator permission is required.
echo [OK] My Trading Agent will start automatically when you sign in.
echo [OK] Auto Agents will use your saved AUTO ON interval.
echo.
echo Startup file:
echo   %STARTUP_FILE%
echo.
echo Real-money execution is still not automatic.
echo.
pause
exit /b 0
