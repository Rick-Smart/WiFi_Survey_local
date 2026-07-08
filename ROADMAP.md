# WiFi Survey Pro Roadmap

This file is the project continuity guide so work can resume cleanly after session breaks.

## Product Goal
Build an engineer-grade Wi-Fi survey app that supports:
- Deep diagnostic scans from a laptop
- Site walk sampling with location context
- No-floorplan and floorplan-based map visualization
- PDF/HTML reporting for customer documentation
- Optional automation paths (phone-assisted and laptop-only replay)

## Architecture Rules
- Keep modules isolated by responsibility.
- Avoid adding large mixed logic blocks to one file.
- Backend domain logic belongs in dedicated managers.
- API routes in app.py should stay thin wrappers around managers.
- Frontend should prefer focused functions over long monolithic handlers.

## Current Modules
- scanner.py: modular scan providers
- walk_manager.py: walk sampling, movement capture, report aggregates
- localization_manager.py: reference/replay fingerprint localization (laptop-only)
- app.py: local HTTP server + API routing
- ui/index.html: layout and controls
- ui/styles.css: visual styles
- ui/app.js: frontend behavior and rendering
- ui/mobile_walker.html: optional phone motion streaming helper

## Completed
- Modular scan dashboard and module registry
- Site walk session start/stop/checkpoints
- Directional movement and XY path updates
- Live SSID/channel scanner panel
- Walk report with timeline and route view
- Floorplan overlay and calibration support
- Backend extraction of walk domain logic to walk_manager.py
- Frontend extraction to styles.css and app.js
- Mobile auto-step optional flow
- Initial laptop-only localization backend and API endpoints

## In Progress
- Localization UI wiring in ui/app.js for reference/replay controls
- End-to-end validation of localization routes with UI actions
- Milestone 1 started: confidence/drift messaging + replay progress overlays
- Milestone 1: confidence guidance block added (pending full manual flow validation)
- Milestone 2 started: JSON persistence foundation for walk sessions, reference libraries, and backup bundles
- Site Walk UX staging: make reference-first workflow explicit with ordered step banner and gated replay
- Distribution packaging started: self-contained Windows exe with browser-based UI preserved

## Next Milestones
1. Stabilize localization UX
- Show clear confidence status and drift warnings
- Add replay progress indicator in map panel
- Add user-facing explanation for low-confidence segments

Milestone 1 acceptance checks:
- Replay mode shows confidence percentage and drift risk label in the localization panel.
- Map panel shows replay progress and confidence status text while replay is active.
- Low-confidence replay states are visibly distinguished from stable states.
- No regressions in walk start/stop, checkpoint tagging, and map rendering.

2. Persist survey data to disk
- Save walk sessions and reference sets as JSON artifacts
- Load/import previous sessions
- Add backup/export bundle format

Milestone 2 acceptance checks:
- Current walk session can be saved to a JSON artifact and loaded back into the app.
- Reference library can be saved to a JSON artifact and loaded back into the app.
- Combined backup bundle can save both walk and references and restore both.
- Saved artifacts are listed in the UI for later selection.
- Persistence logic remains separated from route and UI logic.

3. Improve replay estimation quality
- Fingerprint smoothing window tuning
- Better temporal continuity constraints
- Outlier rejection for noisy AP samples

Milestone 2 UX acceptance checks:
- Site Walk tab clearly presents a reference-first workflow.
- Reference creation is visually the primary action before any replay controls.
- A workflow banner explains the current stage and next step.
- Replay remains visually secondary until a reference set exists.
- Layout reads as a guided process rather than a general-purpose toolbox.

4. Reporting improvements
- Include localization confidence layer in report
- Add run-to-run comparison summary
- Include reference set metadata and replay quality metrics

5. Refactor pass
- Split app.py routes into scan_routes.py, walk_routes.py, localization_routes.py
- Keep all manager logic out of route files

6. Distribution packaging
- Bundle the Python runtime and app files into a Windows exe
- Keep the browser as the view layer
- Store survey_data beside the exe for portable artifact persistence

Packaging acceptance checks:
- `build_windows_exe.bat` produces a runnable executable in `dist/`
- Launching the exe opens the local server and then the browser UI
- Packaged app still loads the UI assets correctly
- Saved walk/reference/bundle artifacts persist beside the exe

## Suggested Session Resume Checklist
1. Read this roadmap and confirm current milestone.
2. Run editor error check on app.py, ui/app.js, ui/index.html, walk_manager.py, localization_manager.py.
3. Verify key flows manually:
- Scan dashboard run
- Walk start/stop + checkpoint
- Localization reference start/stop
- Localization replay start/stop
4. Update this roadmap with what changed and what remains.

## Risks to Watch
- UI complexity growth in ui/app.js
- Overlapping timers causing noisy refresh behavior
- Localization confidence misread as absolute position certainty
- Route drift in large low-AP environments

## Decisions Log
- Keep phone-assisted automation optional, not required.
- Prioritize laptop-only reference/replay for no-extra-equipment workflow.
- Preserve modularity as a hard requirement for future extension.

## Progress Log
- 2026-06-17: Added persistent roadmap file for session continuity.
- 2026-06-17: Added modular localization manager and API routes.
- 2026-06-17: Started Milestone 1 by adding confidence/drift status tones and replay progress overlays in the map panel.
- 2026-06-17: Added dynamic confidence guidance instructions in localization panel for moderate/high drift states.
- 2026-06-18: Started Milestone 2 by adding survey_data JSON storage, walk/reference serialization, storage API routes, and a persistence panel in the Site Walk tab.
