@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 20 or later first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing viewer dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting TCGA MRI Viewer...
echo Open http://127.0.0.1:4173 if the browser does not open automatically.
echo Press Ctrl+C in this window to stop the viewer.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4173'"
call npm start

endlocal
