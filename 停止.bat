@echo off
title NextCoWork Stop

rem Kill the whole dev tree: launcher cmd of this project's .bat + electron-vite node (/T takes children).
rem Exclude self ($PID) and the cmd running this script ($pp).
powershell -NoProfile -Command "$me=$PID; $pp=(Get-CimInstance Win32_Process | Where-Object ProcessId -eq $me).ParentProcessId; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and $_.ProcessId -ne $pp -and (($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*%~dp0*.bat*') -or ($_.CommandLine -like '*%~dp0node_modules*electron-vite*')) } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }" >nul 2>&1

rem Orphan electron GUI processes of this project
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.ExecutablePath -like '*%~dp0node_modules\electron\dist\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

ping -n 2 127.0.0.1 >nul

powershell -NoProfile -Command "$me=$PID; $pp=(Get-CimInstance Win32_Process | Where-Object ProcessId -eq $me).ParentProcessId; if (Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and $_.ProcessId -ne $pp -and (($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*%~dp0*.bat*') -or ($_.CommandLine -like '*%~dp0node_modules*electron-vite*') -or ($_.Name -eq 'electron.exe' -and $_.ExecutablePath -like '*%~dp0node_modules\electron\dist\*')) }) { exit 1 } else { exit 0 }" >nul 2>&1
if %errorlevel%==0 (
    echo [NextCoWork] Dev stopped.
) else (
    echo [NextCoWork] Stop FAILED. Some processes remain, check Task Manager.
    pause
    exit /b 1
)
