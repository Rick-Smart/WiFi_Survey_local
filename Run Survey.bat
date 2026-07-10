@echo off
:: WiFi Survey Pro — Launcher
:: Double-click to open the browser-based GUI.
:: Requires Python 3.8+ (or uv for automatic setup).

title WiFi Survey Pro
cd /d "%~dp0"

echo.
echo  ============================================
echo   WiFi Survey Pro  —  starting...
echo  ============================================
echo.

:: ── Prefer the packaged exe when present ────────────────────
if exist "%~dp0dist\WiFi Survey Pro.exe" (
    echo  Using packaged executable...
    start "" "%~dp0dist\WiFi Survey Pro.exe" %*
    goto :end
)

:: ── Try uv first (auto-installs Python if needed) ──────────
where uv >nul 2>&1
if not errorlevel 1 (
    echo  Using uv to launch...
    uv run --with flask app.py %*
    goto :end
)

:: ── Try py launcher ────────────────────────────────────────
where py >nul 2>&1
if not errorlevel 1 (
    py app.py %*
    goto :end
)

:: ── Try python ─────────────────────────────────────────────
where python >nul 2>&1
if not errorlevel 1 (
    python app.py %*
    goto :end
)

:: ── Try python3 ────────────────────────────────────────────
where python3 >nul 2>&1
if not errorlevel 1 (
    python3 app.py %*
    goto :end
)

:: ── Nothing found ──────────────────────────────────────────
echo  ERROR: Python is not installed or not on PATH.
echo.
echo  Option 1 (recommended):
echo    Install uv from https://astral.sh/uv
echo    It bootstraps Python automatically.
echo.
echo  Option 2:
echo    Install Python from https://www.python.org/downloads/
echo    Check "Add Python to PATH" during installation.
echo.
pause
exit /b 1

:end
echo.
pause
