"""
app.py  —  WiFi Survey Pro
Flask-based local server. Serves the React SPA from web/dist/ when built,
or falls back to legacy ui/ during development.

Usage:
    python app.py               # Launch GUI in browser
    python app.py --port 9000   # Use a specific port
    python app.py --no-browser  # Start server only (headless / scripting)
"""

import argparse
import os
import pathlib
import socket
import sys
import threading
import time
import webbrowser

from flask import Flask, jsonify, request, send_from_directory, abort

import scanner as sc
from localization_manager import LocalizationManager
from survey_storage import SurveyStorage
from walk_manager import WalkSurveyManager


# ── Path helpers ──────────────────────────────────────────────────────────────

def app_root_dir() -> pathlib.Path:
    if getattr(sys, 'frozen', False):
        return pathlib.Path(sys.executable).resolve().parent
    return pathlib.Path(__file__).resolve().parent


def resource_path(*parts: str) -> pathlib.Path:
    bundle_root = pathlib.Path(getattr(sys, '_MEIPASS', app_root_dir()))
    return bundle_root.joinpath(*parts)


def data_root_dir() -> pathlib.Path:
    """Writable data directory.

    When frozen (installed exe) the app may live in a read-only location such
    as Program Files, so write user data to a per-user writable folder instead.
    When running from source, keep everything in the repo for a portable dev
    setup.
    """
    if getattr(sys, 'frozen', False):
        base = os.environ.get('LOCALAPPDATA') or os.environ.get('APPDATA')
        if base:
            return pathlib.Path(base) / 'WiFi Survey Pro'
    return app_root_dir()


# ── Service singletons ────────────────────────────────────────────────────────

WALK = WalkSurveyManager()
LOCALIZE = LocalizationManager(
    position_provider=lambda: (WALK.state().get('position') or {'x_m': 0.0, 'y_m': 0.0}),
    checkpoint_provider=lambda: WALK.state().get('checkpoints') or [],
)
STORAGE = SurveyStorage(root=data_root_dir() / 'survey_data')

_mobile_lock = threading.Lock()
_mobile_state: dict = {
    'connected': False, 'last_seen_at': None, 'last_seen_epoch_ms': 0,
    'running': False, 'sensor_enabled': False, 'auto_start': False,
    'heading_deg': None, 'step_len_m': None, 'detected_steps': 0,
    'sent_steps': 0, 'heading_jitter_deg': None, 'last_sensor_at': None,
    'ua': None,
}


def _mobile_snapshot() -> dict:
    now_ms = int(time.time() * 1000)
    with _mobile_lock:
        st = dict(_mobile_state)
    last_ms = int(st.get('last_seen_epoch_ms') or 0)
    age_ms  = max(0, now_ms - last_ms) if last_ms else 0
    st['age_ms']    = age_ms
    st['connected'] = bool(last_ms and age_ms <= 6000)
    return st


def _update_mobile(payload: dict, ua: str) -> dict:
    now_ms = int(time.time() * 1000)
    with _mobile_lock:
        _mobile_state.update({
            'last_seen_at':       time.strftime('%Y-%m-%dT%H:%M:%S'),
            'last_seen_epoch_ms': now_ms,
            'ua':                 (ua or '')[:160],
            'running':            bool(payload.get('running')),
            'sensor_enabled':     bool(payload.get('sensor_enabled')),
            'auto_start':         bool(payload.get('auto_start')),
            'heading_deg':        payload.get('heading_deg'),
            'step_len_m':         payload.get('step_len_m'),
            'detected_steps':     int(payload.get('detected_steps') or 0),
            'sent_steps':         int(payload.get('sent_steps') or 0),
            'heading_jitter_deg': payload.get('heading_jitter_deg'),
            'last_sensor_at':     payload.get('last_sensor_at') or None,
            'connected':          True,
        })
    return _mobile_snapshot()


def _local_ips() -> list:
    ips: set = set()
    try:
        _, _, host_ips = socket.gethostbyname_ex(socket.gethostname())
        ips = {ip for ip in host_ips if ip and not ip.startswith('127.')}
    except Exception:
        pass
    return sorted(ips)


def _body() -> dict:
    """Safe JSON body parse — never raises."""
    return request.get_json(force=True, silent=True) or {}


# ── Flask app ─────────────────────────────────────────────────────────────────

UI_DIR   = resource_path('ui')
DIST_DIR = resource_path('web', 'dist')

app = Flask(__name__, static_folder=None)
app.config['PROPAGATE_EXCEPTIONS'] = False
app.config['JSON_SORT_KEYS'] = False


@app.after_request
def _cors(response):
    """Allow Vite dev server (port 5173) and the app's own origin."""
    origin = request.headers.get('Origin', '')
    if '127.0.0.1' in origin or 'localhost' in origin:
        response.headers['Access-Control-Allow-Origin']  = origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Cache-Control']                = 'no-cache'
    return response


@app.errorhandler(404)
def _e404(_e):
    return jsonify(error='Not found'), 404


@app.errorhandler(Exception)
def _e500(exc):
    return jsonify(error=str(exc)), 500


# ── Static / SPA ──────────────────────────────────────────────────────────────

def _spa_root() -> pathlib.Path:
    """Return the directory to serve the SPA from."""
    return DIST_DIR if DIST_DIR.exists() else UI_DIR


@app.get('/')
def root():
    return send_from_directory(str(_spa_root()), 'index.html')


@app.get('/mobile')
def mobile():
    fname = 'mobile_walker.html'
    # Check dist first (future React port), fall back to legacy ui/
    for src in [DIST_DIR, UI_DIR]:
        if src.exists() and (src / fname).exists():
            return send_from_directory(str(src), fname)
    abort(404)


@app.get('/assets/<path:filename>')
def assets(filename):
    """Vite hashed asset files (JS bundles, CSS, fonts, images)."""
    d = DIST_DIR / 'assets'
    if not d.exists():
        abort(404)
    return send_from_directory(str(d), filename)


@app.get('/<path:filename>')
def static_files(filename):
    """Serve any known static file; fall back to index.html for the SPA router."""
    root = _spa_root()
    target = root / filename
    if target.exists() and target.is_file():
        return send_from_directory(str(root), filename)
    # SPA client-side routing fallback
    return send_from_directory(str(root), 'index.html')


# ── Scan ──────────────────────────────────────────────────────────────────────

@app.get('/api/modules')
def api_modules():
    return jsonify([m.meta() for m in sc.MODULES])


@app.get('/api/scan/<module_id>')
def api_scan_one(module_id):
    return jsonify(sc.run_module(module_id))


@app.post('/api/scan')
def api_scan_multi():
    ids = _body().get('modules') or [m.id for m in sc.MODULES]
    return jsonify({mid: sc.run_module(mid) for mid in ids})


# ── Server info ───────────────────────────────────────────────────────────────

@app.get('/api/server/info')
def api_server_info():
    port = request.host.split(':')[-1] if ':' in request.host else '8765'
    urls = [f'http://{ip}:{port}/mobile' for ip in _local_ips()]
    return jsonify({'mobile_urls': urls})


# ── Mobile assist ─────────────────────────────────────────────────────────────

@app.get('/api/mobile/state')
def api_mobile_state():
    return jsonify(_mobile_snapshot())


@app.post('/api/mobile/ping')
def api_mobile_ping():
    state = _update_mobile(_body(), request.headers.get('User-Agent', ''))
    return jsonify({'status': 'ok', 'mobile': state})


# ── Site walk ─────────────────────────────────────────────────────────────────

@app.get('/api/walk/state')
def api_walk_state():
    return jsonify(WALK.state())


@app.get('/api/walk/report')
def api_walk_report():
    return jsonify(WALK.report())


@app.get('/api/live/ssids')
def api_live_ssids():
    return jsonify(WALK.live_scan())


@app.post('/api/walk/start')
def api_walk_start():
    interval = _body().get('interval_sec', 2.0)
    return jsonify(WALK.start(interval))


@app.post('/api/walk/stop')
def api_walk_stop():
    return jsonify(WALK.stop())


@app.post('/api/walk/checkpoint')
def api_walk_checkpoint():
    label = _body().get('label') or 'Checkpoint'
    try:
        return jsonify({'status': 'ok', 'checkpoint': WALK.add_checkpoint(label)})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/walk/rename')
def api_walk_rename():
    body  = _body()
    sid   = body.get('id')
    label = body.get('label') or ''
    if sid is None:
        return jsonify({'status': 'error', 'error': 'Missing checkpoint id'}), 400
    updated = WALK.rename_checkpoint(sid, label)
    if not updated:
        return jsonify({'status': 'error', 'error': 'Checkpoint not found'}), 404
    return jsonify({'status': 'ok', 'checkpoint': updated})


@app.post('/api/walk/move')
def api_walk_move():
    body      = _body()
    direction = (body.get('direction') or '').upper().strip()
    step_m    = body.get('step_m', 1.0)
    label     = body.get('label') or ''
    try:
        cp = WALK.move_and_capture(direction=direction, step_m=step_m, label=label)
        return jsonify({'status': 'ok', 'checkpoint': cp, 'state': WALK.state()})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/walk/auto-step')
def api_walk_auto_step():
    body        = _body()
    heading_deg = body.get('heading_deg')
    step_m      = body.get('step_m', 0.75)
    label       = body.get('label') or ''
    if heading_deg is None:
        return jsonify({'status': 'error', 'error': 'Missing heading_deg'}), 400
    try:
        cp = WALK.auto_step_and_capture(heading_deg=heading_deg, step_m=step_m, label=label)
        return jsonify({'status': 'ok', 'checkpoint': cp, 'state': WALK.state()})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


# ── Localization ──────────────────────────────────────────────────────────────

@app.get('/api/localize/state')
def api_localize_state():
    return jsonify(LOCALIZE.state())


@app.get('/api/localize/references')
def api_localize_references():
    return jsonify({'references': LOCALIZE.list_references()})


@app.post('/api/localize/reference/start')
def api_localize_ref_start():
    body     = _body()
    name     = body.get('name') or ''
    interval = body.get('interval_sec', 2.0)
    try:
        return jsonify({'status': 'ok',
                        'state': LOCALIZE.start_reference(name=name, interval_sec=interval)})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/localize/reference/stop')
def api_localize_ref_stop():
    try:
        return jsonify({'status': 'ok',
                        'state': LOCALIZE.stop_reference(),
                        'references': LOCALIZE.list_references()})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/localize/replay/start')
def api_localize_replay_start():
    body         = _body()
    reference_id = body.get('reference_id')
    interval     = body.get('interval_sec', 2.0)
    if reference_id is None:
        return jsonify({'status': 'error', 'error': 'Missing reference_id'}), 400
    try:
        state = LOCALIZE.start_replay(reference_id=reference_id, interval_sec=interval)
        return jsonify({'status': 'ok', 'state': state})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/localize/replay/stop')
def api_localize_replay_stop():
    try:
        return jsonify({'status': 'ok', 'state': LOCALIZE.stop_replay()})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/localize/reference/delete')
def api_localize_ref_delete():
    reference_id = _body().get('reference_id')
    if reference_id is None:
        return jsonify({'status': 'error', 'error': 'Missing reference_id'}), 400
    removed = LOCALIZE.delete_reference(reference_id)
    if not removed:
        return jsonify({'status': 'error', 'error': 'Reference not found'}), 404
    return jsonify({'status': 'ok',
                    'references': LOCALIZE.list_references(),
                    'state': LOCALIZE.state()})


# ── Storage ───────────────────────────────────────────────────────────────────

@app.get('/api/storage/list')
def api_storage_list():
    return jsonify(STORAGE.list_artifacts())


@app.post('/api/storage/save-walk')
def api_storage_save_walk():
    name     = _body().get('name') or ''
    artifact = STORAGE.save_walk(WALK.export_session_payload(name=name), name=name)
    return jsonify({'status': 'ok', 'artifact': artifact,
                    'artifacts': STORAGE.list_artifacts()})


@app.post('/api/storage/load-walk')
def api_storage_load_walk():
    filename = _body().get('filename') or ''
    if not filename:
        return jsonify({'status': 'error', 'error': 'Missing filename'}), 400
    try:
        state = WALK.import_session_payload(STORAGE.load_walk(filename))
        return jsonify({'status': 'ok', 'state': state, 'report': WALK.report()})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/storage/save-references')
def api_storage_save_refs():
    name     = _body().get('name') or ''
    artifact = STORAGE.save_references(
        LOCALIZE.export_references_payload(name=name), name=name)
    return jsonify({'status': 'ok', 'artifact': artifact,
                    'artifacts': STORAGE.list_artifacts()})


@app.post('/api/storage/load-references')
def api_storage_load_refs():
    body     = _body()
    filename = body.get('filename') or ''
    replace  = bool(body.get('replace'))
    if not filename:
        return jsonify({'status': 'error', 'error': 'Missing filename'}), 400
    try:
        state = LOCALIZE.import_references_payload(
            STORAGE.load_references(filename), replace=replace)
        return jsonify({'status': 'ok', 'state': state,
                        'references': LOCALIZE.list_references()})
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/storage/save-bundle')
def api_storage_save_bundle():
    body               = _body()
    name               = body.get('name') or ''
    reset_after_export = bool(body.get('reset_after_export'))
    bundle = {
        'kind':              'survey_bundle',
        'name':              name or 'survey-bundle',
        'saved_at':          time.strftime('%Y-%m-%dT%H:%M:%S'),
        'walk_session':      WALK.export_session_payload(name=name or 'walk-session'),
        'reference_library': LOCALIZE.export_references_payload(
                                 name=name or 'reference-library'),
    }
    artifact = STORAGE.save_bundle(bundle, name=name)
    resp: dict = {'status': 'ok', 'artifact': artifact,
                  'artifacts': STORAGE.list_artifacts()}
    if reset_after_export:
        resp.update({
            'walk_state':     WALK.reset_session(),
            'walk_report':    WALK.report(),
            'localize_state': LOCALIZE.reset_session(),
            'references':     LOCALIZE.list_references(),
            'reset_applied':  True,
        })
    return jsonify(resp)


@app.post('/api/storage/load-bundle')
def api_storage_load_bundle():
    body     = _body()
    filename = body.get('filename') or ''
    replace  = bool(body.get('replace_references'))
    if not filename:
        return jsonify({'status': 'error', 'error': 'Missing filename'}), 400
    try:
        bundle = STORAGE.load_bundle(filename)
        WALK.import_session_payload(bundle.get('walk_session') or {})
        LOCALIZE.import_references_payload(
            bundle.get('reference_library') or {}, replace=replace)
        return jsonify({
            'status':         'ok',
            'walk_state':     WALK.state(),
            'walk_report':    WALK.report(),
            'localize_state': LOCALIZE.state(),
            'references':     LOCALIZE.list_references(),
        })
    except Exception as exc:
        return jsonify({'status': 'error', 'error': str(exc)}), 400


@app.post('/api/storage/reset-site-walk')
def api_storage_reset_walk():
    return jsonify({
        'status':         'ok',
        'walk_state':     WALK.reset_session(),
        'walk_report':    WALK.report(),
        'localize_state': LOCALIZE.reset_session(),
        'references':     LOCALIZE.list_references(),
    })


@app.post('/api/storage/reset-and-delete')
def api_storage_reset_delete():
    removed = STORAGE.delete_all_artifacts()
    return jsonify({
        'status':         'ok',
        'removed':        removed,
        'walk_state':     WALK.reset_session(),
        'walk_report':    WALK.report(),
        'localize_state': LOCALIZE.reset_session(),
        'references':     LOCALIZE.list_references(),
        'artifacts':      STORAGE.list_artifacts(),
    })


# ── Entry point ───────────────────────────────────────────────────────────────

def _find_free_port(start: int = 8765) -> int:
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return start


def main():
    parser = argparse.ArgumentParser(description='WiFi Survey Pro — local web app')
    parser.add_argument('--port',       type=int, default=0,
                        help='Port to listen on (default: auto-detect from 8765)')
    parser.add_argument('--no-browser', action='store_true',
                        help='Do not open the browser automatically')
    args = parser.parse_args()

    port = args.port if args.port else _find_free_port()
    url  = f'http://127.0.0.1:{port}'

    print()
    print('  ╔══════════════════════════════════════════╗')
    print('  ║       WiFi Survey Pro  —  Starting       ║')
    print('  ╚══════════════════════════════════════════╝')
    print(f'  Listening on  {url}')
    print('  Press Ctrl+C to stop.')
    print()

    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    # Werkzeug dev server — threaded, local-only, no hot-reload needed.
    app.run(host='127.0.0.1', port=port, threaded=True, use_reloader=False)


if __name__ == '__main__':
    main()
