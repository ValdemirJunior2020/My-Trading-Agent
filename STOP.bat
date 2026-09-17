@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title My Trading Agent - Stop
if not exist "data\server.pid" (echo My Trading Agent may already be stopped. & pause & exit /b 0)
set /p PID=<"data\server.pid"
if "%PID%"=="" (del /q "data\server.pid" >nul 2>&1 & exit /b 0)
taskkill /PID %PID% /T /F >nul 2>&1
del /q "data\server.pid" >nul 2>&1
echo My Trading Agent stopped.
pause
