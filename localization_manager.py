import math
import threading
import time
from typing import Callable, Dict, List, Optional

import scanner as sc


class LocalizationManager:
    """Reference/replay Wi-Fi fingerprint localization with no extra hardware."""

    def __init__(self, position_provider: Optional[Callable[[], Optional[Dict[str, float]]]] = None, 
                 checkpoint_provider: Optional[Callable[[], Optional[List[Dict]]]] = None):
        self.lock = threading.Lock()
        self.position_provider = position_provider
        self.checkpoint_provider = checkpoint_provider

        self.references: List[Dict] = []
        self._next_reference_id = 1

        self.reference_active = False
        self.reference_interval_sec = 2.0
        self.reference_name = ""
        self.reference_started_at = None
        self.reference_points: List[Dict] = []

        self.replay_active = False
        self.replay_interval_sec = 2.0
        self.replay_reference_id = None
        self.replay_started_at = None
        self.replay_points: List[Dict] = []
        self.replay_latest_estimate = None
        self.replay_last_index = None

        self.last_error = None

        self._stop_event = threading.Event()
        self._thread = None

    def _now_iso(self):
        return time.strftime('%Y-%m-%dT%H:%M:%S')

    def _normalize_dbm(self, value):
        try:
            v = float(value)
            return round(v, 1)
        except (TypeError, ValueError):
            return None

    def _capture_fingerprint(self):
        survey = sc.run_module('channel_survey')
        if survey.get('status') == 'error':
            raise RuntimeError(survey.get('error') or 'Failed to read channel_survey')

        aps = (survey.get('data') or {}).get('aps', [])

        by_bssid = {}
        for ap in aps:
            bssid = (ap.get('bssid') or '').strip().lower()
            dbm = self._normalize_dbm(ap.get('signal_dbm'))
            if not bssid or dbm is None:
                continue
            if bssid not in by_bssid or dbm > by_bssid[bssid]:
                by_bssid[bssid] = dbm

        top_aps = sorted(
            [
                {
                    'bssid': ap.get('bssid'),
                    'ssid': ap.get('ssid'),
                    'channel': ap.get('channel'),
                    'signal_dbm': self._normalize_dbm(ap.get('signal_dbm')),
                }
                for ap in aps
                if self._normalize_dbm(ap.get('signal_dbm')) is not None
            ],
            key=lambda x: x.get('signal_dbm', -100),
            reverse=True,
        )[:16]

        return {
            'timestamp': self._now_iso(),
            'fingerprint': by_bssid,
            'ap_count': len(by_bssid),
            'top_aps': top_aps,
        }

    def _capture_position(self):
        if not self.position_provider:
            return None
        try:
            pos = self.position_provider() or {}
            x = float(pos.get('x_m', 0.0))
            y = float(pos.get('y_m', 0.0))
            return {'x_m': round(x, 3), 'y_m': round(y, 3)}
        except Exception:
            return None

    def _capture_checkpoints(self):
        """Capture current checkpoint sequence from walk manager."""
        if not self.checkpoint_provider:
            return []
        try:
            checkpoints = self.checkpoint_provider() or []
            return list(checkpoints)
        except Exception:
            return []

    def _reference_step(self):
        fp = self._capture_fingerprint()
        point = {
            'seq': len(self.reference_points) + 1,
            'timestamp': fp['timestamp'],
            'fingerprint': fp['fingerprint'],
            'ap_count': fp['ap_count'],
            'top_aps': fp['top_aps'],
            'position': self._capture_position(),
            'checkpoints': self._capture_checkpoints(),
        }
        self.reference_points.append(point)

    def _distance_score(self, ref_fp, cur_fp):
        keys = set(ref_fp.keys()) | set(cur_fp.keys())
        if not keys:
            return {'distance': 9999.0, 'overlap': 0, 'union': 0, 'overlap_ratio': 0.0}

        overlap = 0
        weighted_sum = 0.0
        weight_total = 0.0

        for key in keys:
            rv = ref_fp.get(key)
            cv = cur_fp.get(key)

            if rv is not None and cv is not None:
                overlap += 1
                diff = abs(rv - cv)
            else:
                # Missing AP in either vector. Penalize, but less than large dbm deltas.
                diff = 12.0

            # Stronger APs carry more weight in localization.
            anchor = rv if rv is not None else cv
            strength = max(-90.0, min(-30.0, float(anchor)))
            weight = 1.0 + ((strength + 90.0) / 60.0)
            weighted_sum += diff * weight
            weight_total += weight

        distance = weighted_sum / max(1.0, weight_total)
        return {
            'distance': round(distance, 3),
            'overlap': overlap,
            'union': len(keys),
            'overlap_ratio': round(overlap / len(keys), 3),
        }

    def _estimate_location(self, cur_fp):
        with self.lock:
            ref = next((r for r in self.references if r['id'] == self.replay_reference_id), None)
            prev_idx = self.replay_last_index

        if not ref:
            raise RuntimeError('Reference set not found')

        candidates = []
        for i, point in enumerate(ref.get('points', [])):
            score = self._distance_score(point.get('fingerprint', {}), cur_fp)
            base = score['distance']
            if prev_idx is not None:
                # Temporal continuity penalty reduces sudden teleports.
                base += min(20.0, abs(i - prev_idx) * 0.4)
            candidates.append((i, point, score, base))

        if not candidates:
            raise RuntimeError('Reference set has no points')

        candidates.sort(key=lambda x: x[3])
        idx, point, score, adjusted = candidates[0]

        confidence = max(0.0, min(100.0, 100.0 - (adjusted * 7.5) + (score['overlap_ratio'] * 12.0)))
        progress = 0.0
        if len(ref['points']) > 1:
            progress = idx / (len(ref['points']) - 1)

        # Extract checkpoint info from matched point and next points
        matched_checkpoint = None
        next_checkpoint = None
        reference_checkpoints = []
        
        # Get matched checkpoint (most recent checkpoint at or before matched index)
        for i in range(idx, -1, -1):
            cp_list = ref['points'][i].get('checkpoints', [])
            if cp_list:
                matched_checkpoint = cp_list[-1]  # Most recent checkpoint
                break
        
        # Get next checkpoint (first checkpoint after matched index)
        for i in range(idx + 1, len(ref['points'])):
            cp_list = ref['points'][i].get('checkpoints', [])
            if cp_list:
                next_checkpoint = cp_list[0]
                break
        
        # Build unique checkpoint sequence from all reference points
        seen_ids = set()
        for point_data in ref['points']:
            for cp in point_data.get('checkpoints', []):
                cp_id = cp.get('id')
                if cp_id and cp_id not in seen_ids:
                    reference_checkpoints.append(cp)
                    seen_ids.add(cp_id)

        estimate = {
            'timestamp': self._now_iso(),
            'reference_id': ref['id'],
            'reference_name': ref['name'],
            'matched_seq': point.get('seq'),
            'matched_index': idx,
            'reference_point_count': len(ref['points']),
            'progress': round(progress, 3),
            'confidence': round(confidence, 1),
            'distance_score': score['distance'],
            'overlap_ratio': score['overlap_ratio'],
            'position': point.get('position'),
            'top_aps': point.get('top_aps', [])[:8],
            'matched_checkpoint': matched_checkpoint,
            'next_checkpoint': next_checkpoint,
            'reference_checkpoints': reference_checkpoints,
        }
        return estimate

    def _replay_step(self):
        fp = self._capture_fingerprint()
        estimate = self._estimate_location(fp['fingerprint'])

        with self.lock:
            self.replay_latest_estimate = estimate
            self.replay_last_index = estimate['matched_index']
            self.replay_points.append({
                'timestamp': fp['timestamp'],
                'fingerprint_ap_count': fp['ap_count'],
                'estimate': estimate,
            })

    def _loop(self):
        while not self._stop_event.is_set():
            try:
                if self.reference_active:
                    self._reference_step()
                if self.replay_active:
                    self._replay_step()
                self.last_error = None
            except Exception as exc:
                self.last_error = str(exc)

            wait = 1.0
            with self.lock:
                if self.reference_active and self.replay_active:
                    wait = min(self.reference_interval_sec, self.replay_interval_sec)
                elif self.reference_active:
                    wait = self.reference_interval_sec
                elif self.replay_active:
                    wait = self.replay_interval_sec
            self._stop_event.wait(max(0.5, wait))

    def _ensure_thread(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _maybe_stop_thread(self):
        if self.reference_active or self.replay_active:
            return
        self._stop_event.set()
        t = self._thread
        if t and t.is_alive():
            t.join(timeout=1.5)

    def list_references(self):
        with self.lock:
            refs = [
                {
                    'id': r['id'],
                    'name': r['name'],
                    'created_at': r['created_at'],
                    'point_count': len(r.get('points', [])),
                    'avg_ap_count': r.get('avg_ap_count', 0),
                    'has_positions': bool(r.get('has_positions', False)),
                }
                for r in self.references
            ]
        refs.sort(key=lambda x: x['id'])
        return refs

    def get_reference(self, reference_id):
        rid = int(reference_id)
        with self.lock:
            for r in self.references:
                if r['id'] == rid:
                    return r
        return None

    def start_reference(self, name='', interval_sec=2.0):
        interval = max(0.5, float(interval_sec))
        with self.lock:
            if self.replay_active:
                raise RuntimeError('Stop replay mode before recording a reference')
            self.reference_active = True
            self.reference_interval_sec = interval
            self.reference_name = (name or f'Reference {self._next_reference_id}').strip()
            self.reference_started_at = self._now_iso()
            self.reference_points = []
            self.last_error = None

        self._ensure_thread()

        # Capture first point immediately.
        try:
            self._reference_step()
        except Exception as exc:
            with self.lock:
                self.last_error = str(exc)

        return self.state()

    def stop_reference(self):
        with self.lock:
            if not self.reference_active:
                return self.state()

            points = list(self.reference_points)
            name = self.reference_name
            started_at = self.reference_started_at
            created_at = self._now_iso()
            rid = self._next_reference_id

            ap_counts = [p.get('ap_count', 0) for p in points]
            avg_ap_count = round(sum(ap_counts) / len(ap_counts), 1) if ap_counts else 0.0
            has_positions = any(p.get('position') for p in points)

            self.references.append({
                'id': rid,
                'name': name,
                'created_at': created_at,
                'started_at': started_at,
                'avg_ap_count': avg_ap_count,
                'has_positions': has_positions,
                'points': points,
            })
            self._next_reference_id += 1

            self.reference_active = False
            self.reference_name = ''
            self.reference_started_at = None
            self.reference_points = []

        self._maybe_stop_thread()
        return self.state()

    def start_replay(self, reference_id, interval_sec=2.0):
        rid = int(reference_id)
        interval = max(0.5, float(interval_sec))

        with self.lock:
            if self.reference_active:
                raise RuntimeError('Stop reference recording before replay mode')
            if not any(r['id'] == rid for r in self.references):
                raise RuntimeError('Reference set not found')

            self.replay_active = True
            self.replay_interval_sec = interval
            self.replay_reference_id = rid
            self.replay_started_at = self._now_iso()
            self.replay_points = []
            self.replay_latest_estimate = None
            self.replay_last_index = None
            self.last_error = None

        self._ensure_thread()

        try:
            self._replay_step()
        except Exception as exc:
            with self.lock:
                self.last_error = str(exc)

        return self.state()

    def stop_replay(self):
        with self.lock:
            self.replay_active = False
            self.replay_interval_sec = 2.0
            self.replay_reference_id = None
            self.replay_started_at = None
            self.replay_last_index = None
        self._maybe_stop_thread()
        return self.state()

    def delete_reference(self, reference_id):
        rid = int(reference_id)
        with self.lock:
            before = len(self.references)
            self.references = [r for r in self.references if r['id'] != rid]
            removed = before != len(self.references)
            if self.replay_reference_id == rid:
                self.replay_active = False
                self.replay_reference_id = None
                self.replay_started_at = None
                self.replay_latest_estimate = None
                self.replay_points = []
        self._maybe_stop_thread()
        return removed

    def state(self):
        with self.lock:
            replay_reference = None
            if self.replay_reference_id is not None:
                replay_reference = next((r for r in self.references if r['id'] == self.replay_reference_id), None)

            return {
                'reference': {
                    'active': self.reference_active,
                    'name': self.reference_name,
                    'interval_sec': self.reference_interval_sec,
                    'started_at': self.reference_started_at,
                    'point_count': len(self.reference_points),
                },
                'replay': {
                    'active': self.replay_active,
                    'interval_sec': self.replay_interval_sec,
                    'reference_id': self.replay_reference_id,
                    'reference_name': replay_reference.get('name') if replay_reference else None,
                    'started_at': self.replay_started_at,
                    'sample_count': len(self.replay_points),
                    'latest_estimate': self.replay_latest_estimate,
                },
                'reference_count': len(self.references),
                'last_error': self.last_error,
            }

    def export_references_payload(self, name=''):
        with self.lock:
            return {
                'kind': 'reference_library',
                'name': (name or '').strip() or 'reference-library',
                'saved_at': self._now_iso(),
                'references': list(self.references),
                'next_reference_id': self._next_reference_id,
            }

    def import_references_payload(self, payload, replace=False):
        if not isinstance(payload, dict):
            raise ValueError('Invalid reference payload')
        if payload.get('kind') not in (None, 'reference_library'):
            raise ValueError('Payload is not a reference library')

        incoming = list(payload.get('references') or [])
        next_id = int(payload.get('next_reference_id') or 1)

        with self.lock:
            if self.reference_active or self.replay_active:
                raise RuntimeError('Stop active localization tasks before importing references')

            if replace:
                self.references = incoming
            else:
                max_existing = max([int(r.get('id', 0) or 0) for r in self.references] + [0])
                merged = list(self.references)
                for ref in incoming:
                    cloned = dict(ref)
                    max_existing += 1
                    cloned['id'] = max_existing
                    merged.append(cloned)
                self.references = merged

            current_max = max([int(r.get('id', 0) or 0) for r in self.references] + [0])
            self._next_reference_id = max(next_id, current_max + 1)
            self.last_error = None

        return self.state()

    def reset_session(self):
        self._stop_event.set()
        t = self._thread
        if t and t.is_alive():
            t.join(timeout=1.5)

        with self.lock:
            self.references = []
            self._next_reference_id = 1

            self.reference_active = False
            self.reference_interval_sec = 2.0
            self.reference_name = ''
            self.reference_started_at = None
            self.reference_points = []

            self.replay_active = False
            self.replay_interval_sec = 2.0
            self.replay_reference_id = None
            self.replay_started_at = None
            self.replay_points = []
            self.replay_latest_estimate = None
            self.replay_last_index = None

            self.last_error = None

        self._thread = None
        return self.state()
