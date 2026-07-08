import math
import statistics
import threading
import time

import scanner as sc


class WalkSurveyManager:
    """Collects periodic WiFi signal samples while the user walks a site."""

    def __init__(self):
        self.lock = threading.Lock()
        self.active = False
        self.interval_sec = 2.0
        self.started_at = None
        self.ended_at = None
        self.samples = []
        self.next_id = 1
        self._thread = None
        self._stop_event = threading.Event()
        self.last_error = None
        self.pos_x = 0.0
        self.pos_y = 0.0

    def _now_iso(self):
        return time.strftime('%Y-%m-%dT%H:%M:%S')

    def _direction_delta(self, direction, step_m):
        step = float(step_m)
        d = (direction or '').strip().upper()
        if d == 'N':
            return 0.0, -step
        if d == 'S':
            return 0.0, step
        if d == 'E':
            return step, 0.0
        if d == 'W':
            return -step, 0.0
        raise ValueError('Direction must be one of N, E, S, W')

    def _apply_move(self, direction, step_m):
        dx, dy = self._direction_delta(direction, step_m)
        with self.lock:
            self.pos_x = round(self.pos_x + dx, 3)
            self.pos_y = round(self.pos_y + dy, 3)
            return self.pos_x, self.pos_y

    def _apply_heading_step(self, heading_deg, step_m):
        heading = float(heading_deg) % 360.0
        step = float(step_m)
        rad = math.radians(heading)

        # 0 deg is North, clockwise positive.
        dx = math.sin(rad) * step
        dy = -math.cos(rad) * step
        with self.lock:
            self.pos_x = round(self.pos_x + dx, 3)
            self.pos_y = round(self.pos_y + dy, 3)
            return self.pos_x, self.pos_y

    def _capture_raw_sample(self, label='', is_checkpoint=False, movement=None):
        iface = sc.run_module('interface')
        if iface.get('status') == 'error':
            raise RuntimeError(iface.get('error') or 'Failed to read interface data')

        d = iface.get('data') or {}
        with self.lock:
            pos_x = self.pos_x
            pos_y = self.pos_y

        movement = movement or {}
        sample = {
            'id': None,
            'timestamp': self._now_iso(),
            'ssid': d.get('ssid'),
            'bssid': d.get('bssid'),
            'channel': d.get('channel'),
            'band': d.get('band'),
            'radio_type': d.get('radio_type'),
            'signal_pct': d.get('signal'),
            'signal_dbm': d.get('signal_dbm'),
            'rx_mbps': d.get('receive_rate'),
            'tx_mbps': d.get('transmit_rate'),
            'location_label': (label or '').strip(),
            'is_checkpoint': bool(is_checkpoint),
            'signal_quality': d.get('signal_quality'),
            'signal_quality_level': d.get('signal_quality_level'),
            'map_x_m': pos_x,
            'map_y_m': pos_y,
            'direction_hint': movement.get('direction'),
            'step_m': movement.get('step_m'),
            'heading_deg': movement.get('heading_deg'),
            'source': movement.get('source'),
        }
        return sample

    def _append_sample(self, sample):
        with self.lock:
            sample['id'] = self.next_id
            self.next_id += 1
            self.samples.append(sample)
            return sample

    def _loop(self):
        while not self._stop_event.is_set():
            try:
                sample = self._capture_raw_sample()
                self._append_sample(sample)
                self.last_error = None
            except Exception as exc:
                self.last_error = str(exc)
            self._stop_event.wait(self.interval_sec)

    def start(self, interval_sec=2.0):
        interval = max(0.5, float(interval_sec))
        with self.lock:
            self.active = True
            self.interval_sec = interval
            self.started_at = self._now_iso()
            self.ended_at = None
            self.samples = []
            self.next_id = 1
            self.last_error = None
            self.pos_x = 0.0
            self.pos_y = 0.0
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

        try:
            self._append_sample(self._capture_raw_sample(label='Start', is_checkpoint=True))
        except Exception as exc:
            self.last_error = str(exc)
        return self.state()

    def stop(self):
        self._stop_event.set()
        t = self._thread
        if t and t.is_alive():
            t.join(timeout=2.0)
        with self.lock:
            self.active = False
            self.ended_at = self._now_iso()
        return self.state()

    def add_checkpoint(self, label='Checkpoint'):
        sample = self._capture_raw_sample(label=label or 'Checkpoint', is_checkpoint=True)
        return self._append_sample(sample)

    def move_and_capture(self, direction, step_m=1.0, label=''):
        step = max(0.1, float(step_m))
        d = (direction or '').strip().upper()
        self._apply_move(d, step)
        marker = (label or f'Move {d} {step:g}m').strip()
        sample = self._capture_raw_sample(
            label=marker,
            is_checkpoint=True,
            movement={'direction': d, 'step_m': step, 'source': 'manual'},
        )
        return self._append_sample(sample)

    def auto_step_and_capture(self, heading_deg, step_m=0.75, label=''):
        step = max(0.1, float(step_m))
        heading = float(heading_deg)
        self._apply_heading_step(heading, step)
        marker = (label or f'Auto step {heading:.0f} deg {step:g}m').strip()
        sample = self._capture_raw_sample(
            label=marker,
            is_checkpoint=True,
            movement={'heading_deg': heading, 'step_m': step, 'source': 'auto-phone'},
        )
        return self._append_sample(sample)

    def rename_checkpoint(self, sample_id, label):
        sid = int(sample_id)
        with self.lock:
            for sample in self.samples:
                if sample['id'] == sid and sample.get('is_checkpoint'):
                    sample['location_label'] = (label or '').strip()
                    return sample
        return None

    def state(self):
        with self.lock:
            checkpoints = [
                {
                    'id': s['id'],
                    'timestamp': s.get('timestamp'),
                    'label': s.get('location_label') or f'Checkpoint {s["id"]}',
                    'signal_dbm': s.get('signal_dbm'),
                    'signal_pct': s.get('signal_pct'),
                    'channel': s.get('channel'),
                    'map_x_m': s.get('map_x_m'),
                    'map_y_m': s.get('map_y_m'),
                    'direction_hint': s.get('direction_hint'),
                    'step_m': s.get('step_m'),
                    'heading_deg': s.get('heading_deg'),
                    'source': s.get('source'),
                }
                for s in self.samples
                if s.get('is_checkpoint')
            ]
            return {
                'active': self.active,
                'interval_sec': self.interval_sec,
                'started_at': self.started_at,
                'ended_at': self.ended_at,
                'sample_count': len(self.samples),
                'checkpoints': checkpoints,
                'latest_sample': self.samples[-1] if self.samples else None,
                'last_error': self.last_error,
                'position': {'x_m': self.pos_x, 'y_m': self.pos_y},
            }

    def report(self):
        with self.lock:
            samples = list(self.samples)
            active = self.active
            started = self.started_at
            ended = self.ended_at
            interval = self.interval_sec

        dbm_values = [s['signal_dbm'] for s in samples if isinstance(s.get('signal_dbm'), (int, float))]
        rx_values = []
        tx_values = []
        for s in samples:
            try:
                if s.get('rx_mbps') is not None:
                    rx_values.append(float(s['rx_mbps']))
            except (TypeError, ValueError):
                pass
            try:
                if s.get('tx_mbps') is not None:
                    tx_values.append(float(s['tx_mbps']))
            except (TypeError, ValueError):
                pass

        def _stats(values):
            if not values:
                return None
            return {
                'min': round(min(values), 2),
                'max': round(max(values), 2),
                'avg': round(statistics.mean(values), 2),
                'median': round(statistics.median(values), 2),
                'stdev': round(statistics.pstdev(values), 2) if len(values) > 1 else 0.0,
            }

        below_67 = len([v for v in dbm_values if v < -67])
        below_70 = len([v for v in dbm_values if v < -70])
        below_75 = len([v for v in dbm_values if v < -75])
        total = len(dbm_values)

        by_location = {}
        for s in samples:
            lbl = (s.get('location_label') or '').strip()
            if not lbl:
                continue
            by_location.setdefault(lbl, []).append(s)

        location_summary = []
        for label, vals in by_location.items():
            l_dbm = [v['signal_dbm'] for v in vals if isinstance(v.get('signal_dbm'), (int, float))]
            if l_dbm:
                location_summary.append({
                    'label': label,
                    'count': len(vals),
                    'min_dbm': round(min(l_dbm), 2),
                    'max_dbm': round(max(l_dbm), 2),
                    'avg_dbm': round(statistics.mean(l_dbm), 2),
                })

        location_summary.sort(key=lambda x: x['avg_dbm'])

        scan_snapshot = sc.run_module('channel_survey')
        active_scan = []
        if scan_snapshot.get('status') != 'error':
            aps = (scan_snapshot.get('data') or {}).get('aps', [])
            active_scan = sorted(
                [
                    {
                        'ssid': ap.get('ssid'),
                        'bssid': ap.get('bssid'),
                        'channel': ap.get('channel'),
                        'band': ap.get('band'),
                        'signal_dbm': ap.get('signal_dbm'),
                        'signal': ap.get('signal'),
                        'is_mine': ap.get('is_mine', False),
                    }
                    for ap in aps
                ],
                key=lambda x: x.get('signal_dbm') if x.get('signal_dbm') is not None else -100,
                reverse=True,
            )

        return {
            'session': {
                'active': active,
                'started_at': started,
                'ended_at': ended,
                'interval_sec': interval,
                'sample_count': len(samples),
            },
            'signal_dbm': _stats(dbm_values),
            'rx_mbps': _stats(rx_values),
            'tx_mbps': _stats(tx_values),
            'coverage': {
                'below_minus_67_count': below_67,
                'below_minus_70_count': below_70,
                'below_minus_75_count': below_75,
                'below_minus_67_pct': round((below_67 / total * 100), 1) if total else 0.0,
                'below_minus_70_pct': round((below_70 / total * 100), 1) if total else 0.0,
                'below_minus_75_pct': round((below_75 / total * 100), 1) if total else 0.0,
            },
            'samples': samples,
            'location_summary': location_summary,
            'active_scan': active_scan,
            'last_error': self.last_error,
        }

    def live_scan(self):
        data = sc.run_module('channel_survey')
        if data.get('status') == 'error':
            return {'status': 'error', 'error': data.get('error'), 'aps': [], 'channels': {}}

        aps = (data.get('data') or {}).get('aps', [])
        channel_counts = {}
        for ap in aps:
            ch = str(ap.get('channel') or '?')
            channel_counts[ch] = channel_counts.get(ch, 0) + 1

        slim = [
            {
                'ssid': ap.get('ssid'),
                'bssid': ap.get('bssid'),
                'channel': ap.get('channel'),
                'band': ap.get('band'),
                'signal': ap.get('signal'),
                'signal_dbm': ap.get('signal_dbm'),
                'is_mine': ap.get('is_mine', False),
            }
            for ap in aps
        ]
        slim.sort(key=lambda x: x.get('signal_dbm') if x.get('signal_dbm') is not None else -100, reverse=True)
        return {
            'status': 'ok',
            'timestamp': self._now_iso(),
            'total_aps': len(slim),
            'channels': channel_counts,
            'aps': slim,
        }

    def export_session_payload(self, name=''):
        with self.lock:
            samples = list(self.samples)
            payload = {
                'kind': 'walk_session',
                'name': (name or '').strip() or (self.started_at or 'walk-session'),
                'saved_at': self._now_iso(),
                'session': {
                    'active': self.active,
                    'interval_sec': self.interval_sec,
                    'started_at': self.started_at,
                    'ended_at': self.ended_at,
                    'sample_count': len(samples),
                },
                'position': {'x_m': self.pos_x, 'y_m': self.pos_y},
                'samples': samples,
            }
        return payload

    def import_session_payload(self, payload):
        if not isinstance(payload, dict):
            raise ValueError('Invalid walk session payload')
        if payload.get('kind') not in (None, 'walk_session'):
            raise ValueError('Payload is not a walk session')

        session = payload.get('session') or {}
        samples = payload.get('samples') or []
        position = payload.get('position') or {}

        with self.lock:
            if self.active:
                raise RuntimeError('Stop active walk session before loading another session')
            self.interval_sec = max(0.5, float(session.get('interval_sec', 2.0) or 2.0))
            self.started_at = session.get('started_at')
            self.ended_at = session.get('ended_at')
            self.samples = list(samples)
            self.next_id = max([int(s.get('id', 0) or 0) for s in self.samples] + [0]) + 1
            self.pos_x = round(float(position.get('x_m', 0.0) or 0.0), 3)
            self.pos_y = round(float(position.get('y_m', 0.0) or 0.0), 3)
            self.last_error = None

        return self.state()

    def reset_session(self):
        self._stop_event.set()
        t = self._thread
        if t and t.is_alive():
            t.join(timeout=2.0)

        with self.lock:
            self.active = False
            self.interval_sec = 2.0
            self.started_at = None
            self.ended_at = None
            self.samples = []
            self.next_id = 1
            self.last_error = None
            self.pos_x = 0.0
            self.pos_y = 0.0

        self._thread = None
        return self.state()
