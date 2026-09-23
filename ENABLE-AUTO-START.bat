@echo off
setlocal EnableExtensions
title My Trading Agent - Enable Daily Auto Start
cd /d "%~dp0"

set "TASK_NAME=My Trading Agent Auto Start"
set "START_BAT=%~dp0START-SILENT.bat"

if not exist "%START_BAT%" (
  echo [ERROR] START-SILENT.bat is missing.
  pause
  exit /b 1
)

schtasks /Create /TN "%TASK_NAME%" /TR ""%START_BAT%"" /SC ONLOGON /RL LIMITED /F >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Could not create the Windows startup task.
  echo Try right-clicking this file and choosing "Run as administrator".
  pause
  exit /b 1
)

echo.
echo [OK] My Trading Agent will now start automatically every time you sign in to Windows.
echo [OK] Auto Agents will keep using the saved AUTO ON interval.
echo [INFO] Real-money execution is still not automatic.
echo.
pause
