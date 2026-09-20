import pathlib
import subprocess
import sys
import unittest

root = pathlib.Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(root / 'scripts/generate-agent-state-schema.py'), '--check'], check=True)
sys.dont_write_bytecode = True
sys.path.insert(0, str(root / 'packages/agent-state/python'))
suite = unittest.defaultTestLoader.discover(str(root / 'packages/agent-state/tests'), pattern='test_*.py')
raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
