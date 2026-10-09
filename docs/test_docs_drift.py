"""Synthetic documentation drift checks; no network or installed services."""
import tempfile
import unittest
import subprocess
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
        self.assertEqual(len(self.check('python3 missing.py\nnode missing.mjs')), 2)
        self.assertEqual(self.check('python3 -m unittest\nnode --test'), [])

    def test_existing_commands_and_paths(self):
        self.assertEqual(self.check('`npm run build`\npython3 scripts/real.py\n`scripts/real.py`'), [])

    def test_globs_placeholders_generated_and_retired(self):
        self.assertEqual(self.check('`scripts/*.py` `.local/output.json` `scripts/<name>.py` '
                                   '`scripts/old.py` (retired) `scripts/output/` (generated) '
                                   '`https://example.test/x`'), [])
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
        data = {'status': 'ahead', 'files': [{'filename': 'new', 'previous_filename': 'old'}]}
        self.assertEqual(drift.compare_files(data), {'old', 'new'})
        with self.assertRaises(ValueError):
            drift.compare_files({'status': 'ahead', 'files': [{'filename': str(i)} for i in range(300)]})
        with self.assertRaises(ValueError):
            drift.compare_files({})

    def test_report_order_is_stable(self):
        pins = [{'document': n, 'repo': 'hub', 'pin': 'old', 'paths': ['a']} for n in ['z', 'a']]
        self.assertEqual([r['document'] for r in drift.evaluate(pins, lambda *args: ('new', set(), None))], ['a', 'z'])

    def test_directory_pin_includes_changed_children_only(self):
        pins = [{'document': 'current', 'repo': 'hub', 'pin': 'old', 'paths': ['src/']}]
        result = drift.evaluate(pins, lambda *args: ('new', {'src/a.ts', 'src-extra/b.ts'}, None))
        self.assertEqual(result[0]['changed'], ['src/a.ts'])

    def test_relative_owner_path_and_flag_only_example(self):
        self.assertEqual(drift.check_document(self.root, 'scripts/README.md',
                         '`scripts/real.py` `real.py` `npm run -s`', {'scripts/'}), [])

    def test_local_git_rename_and_missing_revision(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.root), *args], text=True,
                                           stderr=subprocess.DEVNULL).strip()
        git('init')
        git('config', 'user.email', 'fixture@example.invalid')
        git('config', 'user.name', 'Documentation fixture')
        git('add', '.')
        git('commit', '-m', 'base')
        pin = git('rev-parse', 'HEAD')
        git('mv', 'scripts/real.py', 'scripts/renamed.py')
        git('commit', '-m', 'rename')
        compare = drift.Comparisons(self.root, offline=True)
        head, paths, error = compare(drift.HUB, pin)
        self.assertEqual(head, git('rev-parse', 'HEAD'))
        self.assertIsNone(error)
        self.assertEqual(paths, {'scripts/real.py', 'scripts/renamed.py'})
        self.assertIsNotNone(compare(drift.HUB, 'missing-revision')[2])

    def test_unsupported_ancestry_and_malformed_file_responses(self):
        for data in [None, [], 'invalid', {'status': 'behind', 'files': []},
                     {'status': 'diverged', 'files': []}, {'status': 'ahead', 'files': [None]},
                     {'status': 'ahead', 'files': [{'filename': None}]},
                     {'status': 'ahead', 'files': [{'filename': 'a', 'previous_filename': []}]}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                drift.compare_files(data)
        self.assertEqual(drift.compare_files({'status': 'identical', 'files': []}), set())

    def test_malformed_repository_and_head_are_not_checked(self):
        for responses in [[None], [[]], [{}], [{'default_branch': 'main'}, None],
                          [{'default_branch': 'main'}, {'sha': []}],
                          [{'default_branch': 'main'}, {'sha': 'not-a-sha'}]]:
            compare = drift.Comparisons(self.root)
            responses = iter(responses)
            compare.api = lambda route: next(responses)
            self.assertIsNotNone(compare('codex-nanoleaf', 'a' * 40)[2])

    def test_revision_cannot_be_a_git_option(self):
        compare = drift.Comparisons(self.root)
        self.assertIsNotNone(compare(drift.HUB, '--output=unexpected')[2])
        self.assertFalse((self.root / 'unexpected').exists())

    def test_flagged_commands_and_command_globs(self):
        self.assertEqual(len(self.check('`node --test scripts/missing.mjs`')), 1)
        self.assertEqual(self.check('`python3 scripts/*.py`'), [])
        self.assertEqual(len(self.check('`python3 scripts/*.missing`')), 1)
        self.assertEqual(len(self.check('node --test --test-name-pattern "two words" scripts/missing.mjs')), 1)
        self.assertEqual(self.check('node --eval "console.log(1)"\npython3 -m unittest'), [])
        self.assertEqual(self.check('python3 scripts/real.py scripts/output.json'), [])

    def test_malformed_compare_reaches_not_checked_boundary(self):
        for data in [None, [], {'status': [], 'files': []}, {'status': 'ahead', 'files': [None]}, {'status': 'behind', 'files': []}]:
            compare = drift.Comparisons(self.root)
            responses = iter([{'default_branch': 'main'}, {'sha': 'b' * 40}, data])
            compare.api = lambda route: next(responses)
            self.assertIsNotNone(compare('codex-nanoleaf', 'a' * 40)[2])


if __name__ == '__main__':
    unittest.main()
