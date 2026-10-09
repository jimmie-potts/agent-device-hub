"""Synthetic documentation drift checks; no network or installed services."""
import tempfile
import unittest
from pathlib import Path
import check_docs_drift as drift


class DocumentationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/real.py').write_text('')
        (self.root / 'package.json').write_text('{"scripts":{"build":"true"}}')

    def check(self, text):
        return drift.check_document(self.root, 'README.md', text, {'scripts/'})

    def test_missing_commands_report_lines(self):
        errors = self.check('npm run missing\npython3 scripts/gone.py\nnode scripts/gone.mjs')
        self.assertEqual([e['line'] for e in errors], [1, 2, 3])
        self.assertTrue(all(e['file'] == 'README.md' for e in errors))

    def test_existing_commands_and_paths(self):
        self.assertEqual(self.check('`npm run build`\npython3 scripts/real.py\n`scripts/real.py`'), [])

    def test_globs_placeholders_generated_and_retired(self):
        self.assertEqual(self.check('`scripts/*.py` `.local/output.json` `scripts/<name>.py` '
                                   '`scripts/old.py` (retired) `https://example.test/x`'), [])
        self.assertEqual(len(self.check('`scripts/*.missing`')), 1)

    def test_missing_inline_path(self):
        self.assertIn('scripts/missing.py', self.check('Read `scripts/missing.py`.')[0]['message'])

    def test_changed_and_unchanged_pins(self):
        pins = [{'document': 'diagram', 'repo': 'hub', 'pin': 'old', 'paths': ['a', 'b']}]
        result = drift.evaluate(pins, lambda *args: ('new', {'b', 'c'}, None))
        self.assertEqual(result[0]['changed'], ['b'])
        self.assertEqual(result[0]['status'], 'changed')
        self.assertEqual(drift.evaluate(pins, lambda *args: ('new', {'c'}, None))[0]['status'], 'unchanged')

    def test_failed_comparison_is_not_unchanged(self):
        pins = [{'document': 'diagram', 'repo': 'hub', 'pin': 'old', 'paths': ['a']}]
        result = drift.evaluate(pins, lambda *args: ('new', None, 'comparison unavailable'))
        self.assertEqual(result[0]['status'], 'not checked')

    def test_rename_and_incomplete_compare(self):
        data = {'files': [{'filename': 'new', 'previous_filename': 'old'}]}
        self.assertEqual(drift.compare_files(data), {'old', 'new'})
        with self.assertRaises(ValueError):
            drift.compare_files({'files': [{'filename': str(i)} for i in range(300)]})
        with self.assertRaises(ValueError):
            drift.compare_files({})

    def test_report_order_is_stable(self):
        pins = [{'document': n, 'repo': 'hub', 'pin': 'old', 'paths': ['a']} for n in ['z', 'a']]
        self.assertEqual([r['document'] for r in drift.evaluate(pins, lambda *args: ('new', set(), None))], ['a', 'z'])

    def test_directory_pin_includes_changed_children_only(self):
        pins = [{'document': 'current', 'repo': 'hub', 'pin': 'old', 'paths': ['src/']}]
        result = drift.evaluate(pins, lambda *args: ('new', {'src/a.ts', 'src-extra/b.ts'}, None))
        self.assertEqual(result[0]['changed'], ['src/a.ts'])


if __name__ == '__main__':
    unittest.main()
