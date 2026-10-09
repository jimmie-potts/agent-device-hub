"""The retained atlas and diagram checks work with no Work Guide tree."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class Independence(unittest.TestCase):
    def test_atlas_without_work_guide(self):
        scratch = ROOT / '.local' / 'scratch' / 'diagram-test'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            root = Path(directory)
            for name in ('diagrams', 'system-design', 'skins'):
                shutil.copytree(ROOT / 'docs' / name, root / 'docs' / name,
                                ignore=shutil.ignore_patterns('__pycache__'))
            for command in (['python3', 'docs/system-design/build.py', '--check'],
                            ['python3', 'docs/system-design/check.py']):
                result = subprocess.run(command, cwd=root, text=True, capture_output=True,
                                        env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
