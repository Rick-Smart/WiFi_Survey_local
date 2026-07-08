"""
app.py  —  WiFi Survey Pro
Starts a local HTTP server and opens the browser-based UI.
No external dependencies — uses Python stdlib only.

Usage:
    python app.py               # Launch GUI in browser
    python app.py --port 9000   # Use a specific port
    python app.py --no-browser  # Start server only (headless / scripting)
"""

import argparse
import json
import pathlib
import socket
import socketserver
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

import scanner as sc
from localization_manager import LocalizationManager
from survey_storage import SurveyStorage
from walk_manager import WalkSurveyManager


def app_root_dir() -> pathlib.Path:
    if getattr(sys, 'frozen', False):
        return pathlib.Path(sys.executable).resolve().parent
    return pathlib.Path(__file__).resolve().parent


def resource_path(*parts: str) -> pathlib.Path:
    bundle_root = pathlib.Path(getattr(sys, '_MEIPASS', app_root_dir()))
    return bundle_root.joinpath(*parts)


APP_ROOT = app_root_dir()
UI_FILE = resource_path('ui', 'index.html')
MOBILE_UI_FILE = resource_path('ui', 'mobile_walker.html')
APP_JS_FILE = resource_path('ui', 'app.js')
STYLES_FILE = resource_path('ui', 'styles.css')


def get_local_ipv4_candidates():
    ips = set()
    try:
        _, _, host_ips = socket.gethostbyname_ex(socket.gethostname())
        for ip in host_ips:
            if ip and not ip.startswith('127.'):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


WALK = WalkSurveyManager()
LOCALIZE = LocalizationManager(
    position_provider=lambda: (WALK.state().get('position') or {'x_m': 0.0, 'y_m': 0.0}),
    checkpoint_provider=lambda: WALK.state().get('checkpoints') or []
)
STORAGE = SurveyStorage(root=APP_ROOT / 'survey_data')
MOBILE_LOCK = threading.Lock()
MOBILE_STATE = {
    'connected': False,
    'last_seen_at': None,
    'last_seen_epoch_ms': 0,
    'running': False,
    'sensor_enabled': False,
    'auto_start': False,
    'heading_deg': None,
    'step_len_m': None,
    'detected_steps': 0,
    'sent_steps': 0,
    'heading_jitter_deg': None,
    'last_sensor_at': None,
    'ua': None,
}


def _now_iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S')


def mobile_state_snapshot() -> dict:
    now_ms = int(time.time() * 1000)
    with MOBILE_LOCK:
        st = dict(MOBILE_STATE)
    last_seen_ms = int(st.get('last_seen_epoch_ms') or 0)
    age_ms = max(0, now_ms - last_seen_ms) if last_seen_ms else 0
    st['age_ms'] = age_ms
    st['connected'] = bool(last_seen_ms and age_ms <= 6000)
    return st


def update_mobile_state(payload: dict, ua: str) -> dict:
    now_ms = int(time.time() * 1000)
    with MOBILE_LOCK:
        MOBILE_STATE['last_seen_at'] = _now_iso()
        MOBILE_STATE['last_seen_epoch_ms'] = now_ms
        MOBILE_STATE['ua'] = (ua or '')[:160]
        MOBILE_STATE['running'] = bool(payload.get('running'))
        MOBILE_STATE['sensor_enabled'] = bool(payload.get('sensor_enabled'))
        MOBILE_STATE['auto_start'] = bool(payload.get('auto_start'))
        MOBILE_STATE['heading_deg'] = payload.get('heading_deg')
        MOBILE_STATE['step_len_m'] = payload.get('step_len_m')
        MOBILE_STATE['detected_steps'] = int(payload.get('detected_steps') or 0)
        MOBILE_STATE['sent_steps'] = int(payload.get('sent_steps') or 0)
        MOBILE_STATE['heading_jitter_deg'] = payload.get('heading_jitter_deg')
        MOBILE_STATE['last_sensor_at'] = payload.get('last_sensor_at') or None
        MOBILE_STATE['connected'] = True
    return mobile_state_snapshot()


# ─────────────────────────────────────────────────────────────────────────────
# HTTP handler
# ─────────────────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass  # suppress default per-request logging

    # ── helpers ───────────────────────────────────────────────────

    def _send(self, body: bytes, content_type='text/html', status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        # Allow the page to call its own server (same origin is fine, but
        # include CORS header as a safety net for some browser configs)
        self.send_header('Access-Control-Allow-Origin', f'http://127.0.0.1:{self.server.server_address[1]}')
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, status=200):
        body = json.dumps(data, default=str).encode()
        self._send(body, 'application/json', status)

    def _not_found(self):
        self._send(b'Not found', 'text/plain', 404)

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length) or b'{}'
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    # ── GET ───────────────────────────────────────────────────────

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path.rstrip('/')

        if path in ('', '/index.html'):
            try:
                html = UI_FILE.read_bytes()
                self._send(html, 'text/html; charset=utf-8')
            except FileNotFoundError:
                self._send(b'<h1>ui/index.html not found</h1>', 'text/html', 500)
            return

        if path == '/mobile':
            try:
                html = MOBILE_UI_FILE.read_bytes()
                self._send(html, 'text/html; charset=utf-8')
            except FileNotFoundError:
                self._send(b'<h1>ui/mobile_walker.html not found</h1>', 'text/html', 500)
            return

        if path == '/app.js':
            try:
                content = APP_JS_FILE.read_bytes()
                self._send(content, 'application/javascript; charset=utf-8')
            except FileNotFoundError:
                self._send(b'/* ui/app.js not found */', 'application/javascript', 500)
            return

        if path == '/styles.css':
            try:
                content = STYLES_FILE.read_bytes()
                self._send(content, 'text/css; charset=utf-8')
            except FileNotFoundError:
                self._send(b'/* ui/styles.css not found */', 'text/css', 500)
            return

        if path == '/api/modules':
            self._json([m.meta() for m in sc.MODULES])
            return

        if path == '/api/server/info':
            host_header = self.headers.get('Host', '')
            port = self.server.server_address[1]
            if ':' in host_header:
                try:
                    port = int(host_header.rsplit(':', 1)[1])
                except ValueError:
                    pass
            candidates = [f'http://{ip}:{port}/mobile' for ip in get_local_ipv4_candidates()]
            self._json({'mobile_urls': candidates})
            return

        if path == '/api/mobile/state':
            self._json(mobile_state_snapshot())
            return

        if path == '/api/walk/state':
            self._json(WALK.state())
            return

        if path == '/api/localize/state':
            self._json(LOCALIZE.state())
            return

        if path == '/api/localize/references':
            self._json({'references': LOCALIZE.list_references()})
            return

        if path == '/api/storage/list':
            self._json(STORAGE.list_artifacts())
            return

        if path == '/api/walk/report':
            self._json(WALK.report())
            return

        if path == '/api/live/ssids':
            self._json(WALK.live_scan())
            return

        if path.startswith('/api/scan/'):
            module_id = path.split('/')[-1]
            result = sc.run_module(module_id)
            self._json(result)
            return

        self._not_found()

    # ── POST ──────────────────────────────────────────────────────

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        if path == '/api/scan':
            body   = self._read_json_body()
            ids    = body.get('modules') or [m.id for m in sc.MODULES]
            results = {mid: sc.run_module(mid) for mid in ids}
            self._json(results)
            return

        if path == '/api/mobile/ping':
            body = self._read_json_body()
            state = update_mobile_state(body, self.headers.get('User-Agent', ''))
            self._json({'status': 'ok', 'mobile': state})
            return

        if path == '/api/walk/start':
            body = self._read_json_body()
            interval = body.get('interval_sec', 2.0)
            self._json(WALK.start(interval))
            return

        if path == '/api/walk/stop':
            self._json(WALK.stop())
            return

        if path == '/api/walk/checkpoint':
            body = self._read_json_body()
            label = body.get('label') or 'Checkpoint'
            try:
                self._json({'status': 'ok', 'checkpoint': WALK.add_checkpoint(label)})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=500)
            return

        if path == '/api/walk/rename':
            body = self._read_json_body()
            sid = body.get('id')
            label = body.get('label') or ''
            if sid is None:
                self._json({'status': 'error', 'error': 'Missing checkpoint id'}, status=400)
                return
            updated = WALK.rename_checkpoint(sid, label)
            if not updated:
                self._json({'status': 'error', 'error': 'Checkpoint not found'}, status=404)
                return
            self._json({'status': 'ok', 'checkpoint': updated})
            return

        if path == '/api/walk/move':
            body = self._read_json_body()
            direction = (body.get('direction') or '').upper().strip()
            step_m = body.get('step_m', 1.0)
            label = body.get('label') or ''
            try:
                checkpoint = WALK.move_and_capture(direction=direction, step_m=step_m, label=label)
                self._json({'status': 'ok', 'checkpoint': checkpoint, 'state': WALK.state()})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        if path == '/api/walk/auto-step':
            body = self._read_json_body()
            heading_deg = body.get('heading_deg')
            step_m = body.get('step_m', 0.75)
            label = body.get('label') or ''
            if heading_deg is None:
                self._json({'status': 'error', 'error': 'Missing heading_deg'}, status=400)
                return
            try:
                checkpoint = WALK.auto_step_and_capture(heading_deg=heading_deg, step_m=step_m, label=label)
                self._json({'status': 'ok', 'checkpoint': checkpoint, 'state': WALK.state()})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        if path == '/api/localize/reference/start':
            body = self._read_json_body()
            name = body.get('name') or ''
            interval = body.get('interval_sec', 2.0)
            try:
                self._json({'status': 'ok', 'state': LOCALIZE.start_reference(name=name, interval_sec=interval)})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        if path == '/api/localize/reference/stop':
            try:
                self._json({'status': 'ok', 'state': LOCALIZE.stop_reference(), 'references': LOCALIZE.list_references()})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        if path == '/api/localize/replay/start':
            body = self._read_json_body()
            reference_id = body.get('reference_id')
            interval = body.get('interval_sec', 2.0)
            if reference_id is None:
                self._json({'status': 'error', 'error': 'Missing reference_id'}, status=400)
                return
            try:
                state = LOCALIZE.start_replay(reference_id=reference_id, interval_sec=interval)
                self._json({'status': 'ok', 'state': state})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        if path == '/api/localize/replay/stop':
            try:
                self._json({'status': 'ok', 'state': LOCALIZE.stop_replay()})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        if path == '/api/localize/reference/delete':
            body = self._read_json_body()
            reference_id = body.get('reference_id')
            if reference_id is None:
                self._json({'status': 'error', 'error': 'Missing reference_id'}, status=400)
                return
            removed = LOCALIZE.delete_reference(reference_id)
            if not removed:
                self._json({'status': 'error', 'error': 'Reference not found'}, status=404)
                return
            self._json({'status': 'ok', 'references': LOCALIZE.list_references(), 'state': LOCALIZE.state()})
            return

        if path == '/api/storage/save-walk':
            body = self._read_json_body()
            name = body.get('name') or ''
            artifact = STORAGE.save_walk(WALK.export_session_payload(name=name), name=name)
            self._json({'status': 'ok', 'artifact': artifact, 'artifacts': STORAGE.list_artifacts()})
            return

        if path == '/api/storage/load-walk':
            body = self._read_json_body()
            filename = body.get('filename') or ''
            if not filename:
                self._json({'status': 'error', 'error': 'Missing filename'}, status=400)
                return
            try:
                payload = STORAGE.load_walk(filename)
                state = WALK.import_session_payload(payload)
                self._json({'status': 'ok', 'state': state, 'report': WALK.report()})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        if path == '/api/storage/save-references':
            body = self._read_json_body()
            name = body.get('name') or ''
            artifact = STORAGE.save_references(LOCALIZE.export_references_payload(name=name), name=name)
            self._json({'status': 'ok', 'artifact': artifact, 'artifacts': STORAGE.list_artifacts()})
            return

        if path == '/api/storage/load-references':
            body = self._read_json_body()
            filename = body.get('filename') or ''
            replace = bool(body.get('replace'))
            if not filename:
                self._json({'status': 'error', 'error': 'Missing filename'}, status=400)
                return
            try:
                payload = STORAGE.load_references(filename)
                state = LOCALIZE.import_references_payload(payload, replace=replace)
                self._json({'status': 'ok', 'state': state, 'references': LOCALIZE.list_references()})
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        if path == '/api/storage/save-bundle':
            body = self._read_json_body()
            name = body.get('name') or ''
            reset_after_export = bool(body.get('reset_after_export'))
            bundle = {
                'kind': 'survey_bundle',
                'name': name or 'survey-bundle',
                'saved_at': WALK._now_iso(),
                'walk_session': WALK.export_session_payload(name=name or 'walk-session'),
                'reference_library': LOCALIZE.export_references_payload(name=name or 'reference-library'),
            }
            artifact = STORAGE.save_bundle(bundle, name=name)
            payload = {'status': 'ok', 'artifact': artifact, 'artifacts': STORAGE.list_artifacts()}
            if reset_after_export:
                payload['walk_state'] = WALK.reset_session()
                payload['walk_report'] = WALK.report()
                payload['localize_state'] = LOCALIZE.reset_session()
                payload['references'] = LOCALIZE.list_references()
                payload['reset_applied'] = True
            self._json(payload)
            return

        if path == '/api/storage/reset-site-walk':
            walk_state = WALK.reset_session()
            localize_state = LOCALIZE.reset_session()
            self._json({
                'status': 'ok',
                'walk_state': walk_state,
                'walk_report': WALK.report(),
                'localize_state': localize_state,
                'references': LOCALIZE.list_references(),
            })
            return

        if path == '/api/storage/reset-and-delete':
            walk_state = WALK.reset_session()
            localize_state = LOCALIZE.reset_session()
            removed = STORAGE.delete_all_artifacts()
            self._json({
                'status': 'ok',
                'removed': removed,
                'walk_state': walk_state,
                'walk_report': WALK.report(),
                'localize_state': localize_state,
                'references': LOCALIZE.list_references(),
                'artifacts': STORAGE.list_artifacts(),
            })
            return

        if path == '/api/storage/load-bundle':
            body = self._read_json_body()
            filename = body.get('filename') or ''
            replace = bool(body.get('replace_references'))
            if not filename:
                self._json({'status': 'error', 'error': 'Missing filename'}, status=400)
                return
            try:
                bundle = STORAGE.load_bundle(filename)
                WALK.import_session_payload(bundle.get('walk_session') or {})
                LOCALIZE.import_references_payload(bundle.get('reference_library') or {}, replace=replace)
                self._json({
                    'status': 'ok',
                    'walk_state': WALK.state(),
                    'walk_report': WALK.report(),
                    'localize_state': LOCALIZE.state(),
                    'references': LOCALIZE.list_references(),
                })
            except Exception as exc:
                self._json({'status': 'error', 'error': str(exc)}, status=400)
            return

        self._not_found()

    # ── OPTIONS (preflight) ───────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    """Handle each request in its own thread so slow scans don't block the UI."""
    daemon_threads = True


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def find_free_port(start: int = 8765) -> int:
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
    parser.add_argument('--port',       type=int, default=0,    help='Port to listen on (default: auto)')
    parser.add_argument('--no-browser', action='store_true',    help='Do not open the browser automatically')
    args = parser.parse_args()

    port = args.port if args.port else find_free_port()
    url  = f'http://127.0.0.1:{port}'

    server = ThreadedHTTPServer(('127.0.0.1', port), Handler)

    print()
    print('  ╔══════════════════════════════════════════╗')
    print('  ║       WiFi Survey Pro  —  Starting       ║')
    print('  ╚══════════════════════════════════════════╝')
    print(f'  Listening on  {url}')
    print('  Press Ctrl+C to stop.')
    print()

    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Stopped.')


if __name__ == '__main__':
    main()
