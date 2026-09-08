import pathlib
import sys
import unittest

root = pathlib.Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
suite = unittest.defaultTestLoader.discover(str(root / 'tests/performance'), pattern='test_*.py')
raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
