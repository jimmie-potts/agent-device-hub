"""Nightly collection must never expose a partial refresh."""
from pathlib import Path
import json
import tempfile
import unittest


class NightlyInputs(unittest.TestCase):
    def test_failed_second_helper_preserves_all_candidate_inputs(self):
        from nightly_inputs import collect
        with tempfile.TemporaryDirectory() as directory:
            guide = Path(directory) / 'guide'
            work = guide / 'work'
            (work / 'backlogs').mkdir(parents=True)
            (work / 'history').mkdir()
            (work / 'backlogs' / 'snapshot.json').write_text('old backlog')
            (work / 'history' / 'github-history.json').write_text('old history')
            def run(script):
                if script.name == 'refresh_backlogs.py':
                    (script.parent / 'backlogs' / 'snapshot.json').write_text('partial')
                else:
                    raise RuntimeError('history read failed')
            with self.assertRaisesRegex(RuntimeError, 'history read failed'):
                collect(guide, run=run)
            self.assertEqual((work / 'backlogs' / 'snapshot.json').read_text(), 'old backlog')
            self.assertEqual((work / 'history' / 'github-history.json').read_text(), 'old history')


    def test_timestamp_only_read_is_no_change_but_real_input_updates_time(self):
        from nightly_inputs import collect
        with tempfile.TemporaryDirectory() as directory:
            guide = Path(directory) / 'guide'
            work = guide / 'work'
            (work / 'backlogs').mkdir(parents=True)
            (work / 'history').mkdir()
            snapshot = {'startedAt': 'old-start', 'refreshedAt': 'old-end'}
            original = json.dumps(snapshot)
            (work / 'backlogs/snapshot.json').write_text(original)
            (work / 'backlogs/example.json').write_text('old input')
            (work / 'history/github-history.json').write_text('old history')
            def run(script):
                (script.parent / 'backlogs/snapshot.json').write_text(json.dumps(
                    {'startedAt': 'new-start', 'refreshedAt': 'new-end'}))
            self.assertFalse(collect(guide, run=run))
            self.assertEqual((work / 'backlogs/snapshot.json').read_text(), original)
            def changed(script):
                run(script)
                (script.parent / 'backlogs/example.json').write_text('new input')
            self.assertTrue(collect(guide, run=changed))
            self.assertEqual(json.loads((work / 'backlogs/snapshot.json').read_text())['refreshedAt'], 'new-end')

    def test_only_exact_rolling_branch_is_removed_from_pr_inventory(self):
        from nightly_inputs import remove_rolling_pr
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / 'backlogs').mkdir()
            rows = [{'number': 1, 'title': 'Nightly guide refresh', 'head': {'ref': 'human-work'}},
                    {'number': 2, 'title': 'anything', 'head': {'ref': 'guide/nightly-refresh'}}]
            (work / 'backlogs/agent-device-hub-prs.json').write_text(json.dumps(rows))
            (work / 'backlogs/snapshot.json').write_text(json.dumps(
                {'repositories': {'agent-device-hub': {'openPRs': 2}}}))
            remove_rolling_pr(work)
            self.assertEqual(json.loads((work / 'backlogs/agent-device-hub-prs.json').read_text()), rows[:1])
            self.assertEqual(json.loads((work / 'backlogs/snapshot.json').read_text())['repositories']['agent-device-hub']['openPRs'], 1)


if __name__ == '__main__':
    unittest.main()
