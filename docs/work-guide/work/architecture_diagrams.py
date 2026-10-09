"""Temporary compatibility import; docs/diagrams owns the retained views."""
from pathlib import Path
import importlib.util

path = Path(__file__).resolve().parents[2] / 'diagrams' / 'architecture_diagrams.py'
spec = importlib.util.spec_from_file_location('retained_architecture_diagrams', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
globals().update({key: value for key, value in vars(module).items() if not key.startswith('_')})
if __name__ == '__main__':
    render()
