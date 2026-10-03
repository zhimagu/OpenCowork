@echo off
rem One-click packaging: typecheck + build + electron-builder NSIS installer.
rem Output: dist\nextcowork-<version>-setup.exe  (version comes from package.json)
rem Nothing is uploaded anywhere (--publish never).

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [NextCoWork] Node.js not found in PATH. Install Node 20.19+ or 22.12+ first.
    pause
    exit /b 1
)

if not exist "%~dp0node_modules\" (
    echo [NextCoWork] node_modules not found. Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [NextCoWork] npm install failed. See messages above.
        pause
        exit /b 1
    )
)

echo [NextCoWork] Building...
call npm run build
if errorlevel 1 (
    echo [NextCoWork] Build FAILED. See messages above.
    pause
    exit /b 1
)

rem npmRebuild=false: local VS BuildTools lacks Spectre-mitigated libs (MSB8040), so
rem recompiling node-pty here always fails. node_modules already contains an
rem Electron-matched build (postinstall ran install-app-deps), we just pack it as-is.
rem If Electron is ever upgraded, re-verify with: ELECTRON_RUN_AS_NODE=1 electron -e "require('node-pty')"
echo [NextCoWork] Packaging installer, takes several minutes...
call npx electron-builder --publish never -c.npmRebuild=false
if errorlevel 1 (
    echo [NextCoWork] Packaging FAILED. See messages above.
    pause
    exit /b 1
)

echo.
echo [NextCoWork] Done. Installer: %cd%\dist\nextcowork-*-setup.exe
echo [NextCoWork] Double-click the setup exe to install, then launch "NextCoWork" from the desktop shortcut.
pause
