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

- Saved walks, reference sets, and bundles are written to `survey_data/`.
- When run from source, this lives in the repo folder (portable dev setup).
- When run as the installed exe, it lives in `%LOCALAPPDATA%\WiFi Survey Pro\survey_data`
  so the app works even when installed to a read-only location like Program Files.

## Installer (Windows)

Ships a click-to-run installer that creates Start Menu + Desktop shortcuts.

1. Install **Inno Setup 6** once: https://jrsoftware.org/isdl.php
   (or `winget install JRSoftware.InnoSetup`).
2. Run `build_installer.bat` from the repo root. It:
   - builds `dist\WiFi Survey Pro.exe` (via `build_windows_exe.bat`), then
   - compiles `installer\WiFiSurveyPro.iss` into
     `installer\Output\WiFiSurveyProSetup-<version>.exe`.
3. The setup script lives at `installer\WiFiSurveyPro.iss` — bump `MyAppVersion`
   there for each release. Keep `AppId` unchanged so upgrades replace cleanly.

## Distributing via GitHub (download → install → click icon)

1. Build the installer (above).
2. On GitHub, create a **Release** (Releases → Draft a new release), tag it
   (e.g. `v1.0.0`), and **attach** `WiFiSurveyProSetup-<version>.exe` as a
   release asset.
3. Users download that single `.exe`, run it, and get a desktop/Start Menu icon
   that launches the app (which opens the browser UI).

Optional: automate this with a GitHub Actions workflow that builds the exe +
installer on a `windows-latest` runner and uploads it to the Release whenever a
`v*` tag is pushed.

## Notes

- The browser view remains unchanged; this is not an embedded desktop shell.
- Unsigned installers show a Windows SmartScreen warning ("More info → Run
  anyway"). To remove it, sign the exe + installer with a code-signing
  certificate.
