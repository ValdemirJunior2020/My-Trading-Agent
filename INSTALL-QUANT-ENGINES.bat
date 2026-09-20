@echo off
setlocal EnableExtensions EnableDelayedExpansion
title My Trading Agent - Quant Engines
cd /d "%~dp0"

echo.
echo ============================================================
echo        MY TRADING AGENT - QUANT ENGINE INSTALLER
echo ============================================================
echo VectorBT + NautilusTrader run natively on Windows.
echo RD-Agent runs through WSL because upstream targets Linux.
echo.

set "PYEXE="
where py >nul 2>&1
if not errorlevel 1 set "PYEXE=py -3"

if "!PYEXE!"=="" (
  where python >nul 2>&1
  if not errorlevel 1 set "PYEXE=python"
)

if "!PYEXE!"=="" (
  where winget >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Python is missing and winget is unavailable.
    goto :rdagent
  )
  echo [INSTALL] Installing Python 3.12...
  winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [WARNING] Python install failed. Skipping native quant engines.
    goto :rdagent
  )
  set "PYEXE=py -3"
)

if not exist ".venv-quant\Scripts\python.exe" (
  echo [INSTALL] Creating .venv-quant...
  !PYEXE! -m venv ".venv-quant"
  if errorlevel 1 (
    echo [WARNING] Could not create the quant environment.
    goto :rdagent
  )
) else (
  echo [OK] Quant Python environment already exists.
)

echo [CHECK] Installing/updating VectorBT and NautilusTrader...
".venv-quant\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :rdagent

".venv-quant\Scripts\python.exe" -m pip install -r "quant\requirements-windows.txt"
if errorlevel 1 (
  echo [WARNING] One or more native quant engines failed to install.
) else (
  echo [OK] VectorBT and NautilusTrader installed.
)

echo [TEST] Native quant engines...
".venv-quant\Scripts\python.exe" "quant\bridge.py" status

:rdagent
echo.
echo [CHECK] RD-Agent through WSL...
where wsl >nul 2>&1
if errorlevel 1 (
  echo [WARNING] WSL is not available.
  echo Install WSL/Ubuntu, then rerun this BAT for RD-Agent.
  goto :done
)

wsl -e bash -lc "echo WSL_OK" >nul 2>&1
if errorlevel 1 (
  echo [WARNING] WSL is installed but no Linux distro is ready.
  echo Run: wsl --install -d Ubuntu
  echo Windows may require a restart.
  goto :done
)

for /f "delims=" %%P in ('wsl wslpath -a "%CD%\quant\install-rdagent-wsl.sh"') do set "WSL_SCRIPT=%%P"
if "!WSL_SCRIPT!"=="" (
  echo [WARNING] Could not resolve the RD-Agent WSL script path.
  goto :done
)

echo [INSTALL] Installing/checking RD-Agent in WSL...
wsl -e bash "!WSL_SCRIPT!"
if errorlevel 1 (
  echo [WARNING] RD-Agent WSL setup did not complete.
) else (
  echo [OK] RD-Agent installed in WSL.
)

:done
echo.
echo ============================================================
echo QUANT ENGINE SETUP COMPLETE
echo ============================================================
pause
exit /b 0
