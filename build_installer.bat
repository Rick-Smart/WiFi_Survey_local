@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo  ============================================
echo   WiFi Survey Pro  —  build installer
echo  ============================================
echo.

:: ── Step 1: build the standalone exe ───────────────────────────
echo  [1/2] Building the Windows executable...
call "%~dp0build_windows_exe.bat"
if not exist "%~dp0dist\WiFi Survey Pro.exe" (
    echo.
    echo  ERROR: dist\WiFi Survey Pro.exe was not produced. Aborting.
    exit /b 1
)

:: ── Step 2: locate the Inno Setup compiler (ISCC) ──────────────
echo.
echo  [2/2] Compiling the installer with Inno Setup...

set "ISCC="
where ISCC >nul 2>&1 && set "ISCC=ISCC"
if not defined ISCC if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"

if not defined ISCC (
    echo.
    echo  ERROR: Inno Setup compiler ^(ISCC.exe^) not found.
    echo  Install Inno Setup 6 from https://jrsoftware.org/isdl.php
    echo  ^(or: winget install JRSoftware.InnoSetup^), then rerun this script.
    exit /b 1
)

"%ISCC%" "%~dp0installer\WiFiSurveyPro.iss"
if errorlevel 1 (
    echo.
    echo  ERROR: Installer compilation failed.
    exit /b 1
)

echo.
echo  ============================================
echo   Done. Installer is in: installer\Output\
echo  ============================================
echo.
pause
