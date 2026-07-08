import json
import pathlib
import re
import time
from typing import Dict, List, Optional


class SurveyStorage:
    """Filesystem storage for walk sessions, reference sets, and backup bundles."""

    def __init__(self, root: Optional[pathlib.Path] = None):
        base = pathlib.Path(root) if root else pathlib.Path(__file__).parent / 'survey_data'
        self.root = base
        self.walks_dir = self.root / 'walks'
        self.references_dir = self.root / 'references'
        self.bundles_dir = self.root / 'bundles'
        self._ensure_dirs()

    def _ensure_dirs(self):
        self.walks_dir.mkdir(parents=True, exist_ok=True)
        self.references_dir.mkdir(parents=True, exist_ok=True)
        self.bundles_dir.mkdir(parents=True, exist_ok=True)

    def _now_slug(self):
        return time.strftime('%Y%m%d_%H%M%S')

    def _slugify(self, value: str, fallback: str) -> str:
        text = (value or '').strip().lower()
        text = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
        return text or fallback

    def _write_json(self, path: pathlib.Path, payload: Dict):
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding='utf-8')
        return path

    def _read_json(self, path: pathlib.Path) -> Dict:
        return json.loads(path.read_text(encoding='utf-8'))

    def _artifact_meta(self, path: pathlib.Path) -> Dict:
        stat = path.stat()
        return {
            'filename': path.name,
            'size_bytes': stat.st_size,
            'modified_at': time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(stat.st_mtime)),
        }

    def list_artifacts(self) -> Dict[str, List[Dict]]:
        def collect(directory: pathlib.Path) -> List[Dict]:
            items = []
            for path in sorted(directory.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
                items.append(self._artifact_meta(path))
            return items

        return {
            'walks': collect(self.walks_dir),
            'references': collect(self.references_dir),
            'bundles': collect(self.bundles_dir),
        }

    def save_walk(self, payload: Dict, name: str = '') -> Dict:
        slug = self._slugify(name, 'walk')
        path = self.walks_dir / f'{self._now_slug()}_{slug}.json'
        self._write_json(path, payload)
        return self._artifact_meta(path)

    def load_walk(self, filename: str) -> Dict:
        return self._read_json(self.walks_dir / pathlib.Path(filename).name)

    def save_references(self, payload: Dict, name: str = '') -> Dict:
        slug = self._slugify(name, 'references')
        path = self.references_dir / f'{self._now_slug()}_{slug}.json'
        self._write_json(path, payload)
        return self._artifact_meta(path)

    def load_references(self, filename: str) -> Dict:
        return self._read_json(self.references_dir / pathlib.Path(filename).name)

    def save_bundle(self, payload: Dict, name: str = '') -> Dict:
        slug = self._slugify(name, 'bundle')
        path = self.bundles_dir / f'{self._now_slug()}_{slug}.json'
        self._write_json(path, payload)
        return self._artifact_meta(path)

    def load_bundle(self, filename: str) -> Dict:
        return self._read_json(self.bundles_dir / pathlib.Path(filename).name)

    def delete_all_artifacts(self) -> Dict[str, int]:
        removed = {'walks': 0, 'references': 0, 'bundles': 0}

        for path in self.walks_dir.glob('*.json'):
            try:
                path.unlink()
                removed['walks'] += 1
            except OSError:
                pass

        for path in self.references_dir.glob('*.json'):
            try:
                path.unlink()
                removed['references'] += 1
            except OSError:
                pass

        for path in self.bundles_dir.glob('*.json'):
            try:
                path.unlink()
                removed['bundles'] += 1
            except OSError:
                pass

        return removed
