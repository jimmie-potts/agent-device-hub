import pathlib
import sys
import unittest

root = pathlib.Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(root / 'packages/event-contracts/python'))
suite = unittest.defaultTestLoader.discover(str(root / 'packages/event-contracts/tests'), pattern='test_*.py')
raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
