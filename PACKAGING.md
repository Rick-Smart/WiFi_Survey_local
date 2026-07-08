# WiFi Survey Pro Packaging

The app is designed to ship as a Windows executable while keeping the browser-based UI.

## What gets bundled
- `app.py` and all Python modules
- UI assets under `ui/`
- App icon from `assets/wifi-survey-pro.ico`
- The Python runtime used by the build tool

## What stays external
- The user’s browser

## Recommended build flow
1. Run `build_windows_exe.bat` from the repo root.
2. Distribute the `dist/WiFi Survey Pro.exe` file.
3. Launching the exe opens the local server and then the browser.

## Runtime data
- Saved walks, reference sets, and bundles are written to `survey_data/` beside the exe.
- This keeps the app self-contained on disk and makes it easy to copy between machines.

## Notes
- The browser view remains unchanged; this is not an embedded desktop shell.
- If you want an installer later, the next step is to wrap the exe with something like WiX, Inno Setup, or Squirrel.