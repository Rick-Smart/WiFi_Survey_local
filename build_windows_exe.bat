@echo off
setlocal

cd /d "%~dp0"

echo.
echo  ============================================
echo   WiFi Survey Pro  —  building Windows exe
echo  ============================================
echo.

where uv >nul 2>&1
if not errorlevel 1 (
    echo  Using uv + PyInstaller...
    uv run --no-project --with pyinstaller pyinstaller --noconfirm --clean --onefile --name "WiFi Survey Pro" --icon "assets\wifi-survey-pro.ico" --add-data "ui;ui" app.py
    goto :done
)

where py >nul 2>&1
if not errorlevel 1 (
    echo  Using py launcher + PyInstaller...
    py -m pip install --upgrade pyinstaller
    py -m PyInstaller --noconfirm --clean --onefile --name "WiFi Survey Pro" --icon "assets\wifi-survey-pro.ico" --add-data "ui;ui" app.py
    goto :done
)

where python >nul 2>&1
if not errorlevel 1 (
    echo  Using python + PyInstaller...
    python -m pip install --upgrade pyinstaller
    python -m PyInstaller --noconfirm --clean --onefile --name "WiFi Survey Pro" --icon "assets\wifi-survey-pro.ico" --add-data "ui;ui" app.py
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