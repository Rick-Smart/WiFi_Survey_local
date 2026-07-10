@echo off
setlocal

cd /d "%~dp0"

echo.
echo  ============================================
echo   WiFi Survey Pro  —  building Windows exe
echo  ============================================
echo.

:: ── Step 0: build the React frontend ──────────────────────
echo  [pre] Building React frontend...
where npm >nul 2>&1
if not errorlevel 1 (
    npm --prefix "%~dp0web" run build
    if errorlevel 1 (
        echo  ERROR: npm build failed.
        exit /b 1
    )
) else (
    echo  WARNING: npm not found; skipping React build. Ensure web/dist exists.
)
echo.

where uv >nul 2>&1
if not errorlevel 1 (
    echo  Using uv + PyInstaller...
    uv run --no-project --with pyinstaller pyinstaller --noconfirm --clean "WiFi Survey Pro.spec"
    goto :done
)

where py >nul 2>&1
if not errorlevel 1 (
    echo  Using py launcher + PyInstaller...
    py -m pip install --upgrade pyinstaller flask werkzeug jinja2 click
    py -m PyInstaller --noconfirm --clean "WiFi Survey Pro.spec"
    goto :done
)

where python >nul 2>&1
if not errorlevel 1 (
    echo  Using python + PyInstaller...
    python -m pip install --upgrade pyinstaller flask werkzeug jinja2 click
    python -m PyInstaller --noconfirm --clean "WiFi Survey Pro.spec"
    goto :done
)

echo  ERROR: No Python launcher found.
echo  Install uv or Python, then rerun this script.
exit /b 1

:done
echo.
echo  Build finished. See the dist folder for the executable.
echo.
pause