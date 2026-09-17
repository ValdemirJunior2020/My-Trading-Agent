@echo off
setlocal EnableExtensions
title My Trading Agent - Update
cd /d "%~dp0"
where git >nul 2>&1
if errorlevel 1 (echo Git missing. Run INSTALL.bat. & pause & exit /b 1)
git pull --ff-only
if errorlevel 1 (echo Update stopped. No force overwrite was used. & pause & exit /b 1)
call npm install
if errorlevel 1 (pause & exit /b 1)
call npm run build
if errorlevel 1 (pause & exit /b 1)
echo Update complete.
pause
