@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   MY TRADING AGENT - 30D DATA + $100 MICRO BACKTEST
echo ============================================================
echo.
echo [1/2] Downloading 30 days of 5-minute Coinbase candles...
call npx tsx scripts\ingest-30d-candles.ts
if errorlevel 1 goto :fail

echo.
echo [2/2] Running $100 SQLite-backed VectorBT simulation...
if not exist ".venv-quant\Scripts\python.exe" (
  echo [ERROR] Quant environment not found. Run INSTALL-QUANT-ENGINES.bat first.
  goto :fail
)

".venv-quant\Scripts\python.exe" quant\backtest_100_account.py
if errorlevel 1 goto :fail

echo.
echo [DONE] Historical data and $100 backtest completed.
pause
exit /b 0

:fail
echo.
echo [FAILED] Check the message above.
pause
exit /b 1
