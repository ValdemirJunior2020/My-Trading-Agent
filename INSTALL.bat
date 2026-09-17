@echo off
setlocal EnableExtensions EnableDelayedExpansion
title My Trading Agent - Installer
cd /d "%~dp0"
echo.
echo ============================================================
echo              MY TRADING AGENT - INSTALLER
echo ============================================================
echo Checks first. Existing programs and your real .env are kept.
echo.
call :check_or_install node "Node.js LTS" OpenJS.NodeJS.LTS
if errorlevel 1 goto :failed
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
where npm >nul 2>&1
if errorlevel 1 goto :failed
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%V"
if !NODE_MAJOR! LSS 24 echo [WARNING] Node.js 24 LTS or newer is recommended.
call :check_or_install git "Git" Git.Git
if errorlevel 1 goto :failed
call :check_or_install ollama "Ollama" Ollama.Ollama
if errorlevel 1 echo [WARNING] Ollama unavailable. Server can still run without AI.
if not exist ".env" (
 if exist ".env.example" (copy /Y ".env.example" ".env" >nul & echo [OK] Created .env from .env.example.)
) else echo [OK] Existing .env found. NOT overwritten.
if not exist "data" mkdir "data"
if exist "node_modules\.bin\vite.cmd" if exist "node_modules\.bin\tsx.cmd" (
 echo [OK] npm dependencies already installed. Skipping.
) else (
 echo [INSTALL] Installing npm dependencies...
 call npm install
 if errorlevel 1 goto :failed
)
echo [BUILD] Building server and client...
call npm run build
if errorlevel 1 goto :failed
echo.
echo INSTALLATION COMPLETE. Double-click START.bat.
pause
exit /b 0
:check_or_install
where "%~1" >nul 2>&1
if not errorlevel 1 (echo [OK] %~2 already installed. Skipping. & exit /b 0)
where winget >nul 2>&1
if errorlevel 1 (echo [ERROR] %~2 missing and winget unavailable. & exit /b 1)
echo [INSTALL] Installing %~2...
winget install --id "%~3" -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 exit /b 1
exit /b 0
:failed
echo INSTALLATION STOPPED. Fix the error and run INSTALL.bat again.
echo Existing .env and .git were not overwritten.
pause
exit /b 1
