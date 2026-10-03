@echo off
rem Dev-running check: any electron-vite process under this project (exclude the checker itself)
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*%~dp0node_modules*electron-vite*' }) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
    echo [NextCoWork] Dev is already running.
    ping -n 3 127.0.0.1 >nul
    exit /b 0
)

if not exist "%~dp0node_modules\" (
    echo [NextCoWork] node_modules not found. Run "npm install" first.
    pause
    exit /b 1
)

cd /d "%~dp0"
echo [NextCoWork] Starting dev (npm run dev)...
call npm run dev
echo.
echo [NextCoWork] Dev exited.
pause
