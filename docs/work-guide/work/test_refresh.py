"""Offline regression tests for the nightly history reader and change report."""
from pathlib import Path
import copy
import json
import tempfile
import unittest

import refresh_history


class HistoryTests(unittest.TestCase):
    def test_paginated_history_shape(self):
        calls = []
        def reader(endpoint):
            calls.append(endpoint)
            if endpoint == 'repos/jimmie-potts/example':
                return dict(created_at='2026-01-01T00:00:00Z', pushed_at='2026-01-03T00:00:00Z', default_branch='main')
            if endpoint.endswith('/commits/main'):
                return {'sha': 'pinned'}
            if '/commits?' in endpoint:
                return [dict(sha='pinned', commit=dict(committer={'date': '2026-01-03T00:00:00Z'}, message='Title\nbody'))]
            if '/pulls?' in endpoint:
                return [dict(number=2, title='Merged', created_at='2026-01-02T00:00:00Z', html_url='https://example/2', base={'ref':'main'}, state='closed', merged_at='2026-01-03T00:00:00Z')]
            if '/issues?' in endpoint:
                return [dict(number=1, title='Done', created_at='2026-01-01T00:00:00Z', closed_at='2026-01-03T00:00:00Z', state='closed', state_reason='completed', html_url='https://example/1'), dict(number=2, pull_request={})]
            raise AssertionError(endpoint)
        value = refresh_history.build_history({'source':'recorded', 'repositories':{'example':{}}}, reader, 'today')
        self.assertEqual(value, {'fetchedAt':'today', 'source':'recorded', 'repositories': {'example': {
            'createdAt':'2026-01-01T00:00:00Z', 'pushedAt':'2026-01-03T00:00:00Z', 'defaultBranch':'main', 'headSha':'pinned',
            'mainCommitCount':1, 'firstCommitAt':'2026-01-03T00:00:00Z',
            'mainCommits':[{'sha':'pinned', 'date':'2026-01-03T00:00:00Z', 'message':'Title'}],
            'mergedPRs':[{'number':2,'title':'Merged','createdAt':'2026-01-02T00:00:00Z','url':'https://example/2','base':'main','mergedAt':'2026-01-03T00:00:00Z'}],
            'openPRs':[], 'closedIssues':[{'number':1,'title':'Done','closedAt':'2026-01-03T00:00:00Z','createdAt':'2026-01-01T00:00:00Z','stateReason':'completed','url':'https://example/1'}],
            'openIssueCount':0, 'issueCreatedRange':['2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'], 'issuesCreatedByDay':{'2026-01-01':1}}}})
        self.assertTrue(any('sha=pinned&' in call for call in calls))

    def test_committed_history_parity_from_saved_record_fixture(self):
        # The committed archive records all fields consumed by the history
        # reader except individual open issue identities/times. Reconstruct
        # those from its recorded daily counts and exact creation range.
        # This is a schema/parity fixture, not a claim of a new GitHub read.
        from collections import Counter
        from urllib.parse import urlsplit, parse_qs
        path = Path(__file__).parent / 'history' / 'github-history.json'
        expected = json.loads(path.read_text())
        fixtures = {}
        for name, saved in expected['repositories'].items():
            base = f'repos/jimmie-potts/{name}'
            fixtures[base] = dict(created_at=saved['createdAt'], pushed_at=saved['pushedAt'], default_branch=saved['defaultBranch'])
            fixtures[f"{base}/commits/{saved['defaultBranch']}"] = {'sha':saved['headSha']}
            fixtures[f'{base}/commits'] = [dict(sha=row['sha'], commit=dict(committer={'date':row['date']}, message=row['message'])) for row in saved['mainCommits']]
            pulls = []
            for state, field in (('open','openPRs'), ('closed','mergedPRs')):
                pulls.extend(dict(number=row['number'],title=row['title'],created_at=row['createdAt'],html_url=row['url'],base={'ref':row['base']},state=state,merged_at=row.get('mergedAt')) for row in saved[field])
            fixtures[f'{base}/pulls'] = list(reversed(pulls))
            issues = [dict(number=row['number'],title=row['title'],closed_at=row['closedAt'],created_at=row['createdAt'],state_reason=row['stateReason'],html_url=row['url'],state='closed') for row in saved['closedIssues']]
            closed_counts = Counter(row['created_at'][:10] for row in issues)
            number = max((row['number'] for row in issues), default=0) + 1
            for day, count in saved['issuesCreatedByDay'].items():
                for _ in range(count - closed_counts[day]):
                    created = next((value for value in saved['issueCreatedRange'] if value.startswith(day)), day + 'T12:00:00Z')
                    issues.append(dict(number=number,created_at=created,state='open'))
                    number += 1
            # Include a PR returned by /issues: it must not enter issue history.
            fixtures[f'{base}/issues'] = list(reversed(issues)) + [{'pull_request':{},'number':999999}]
        def reader(endpoint):
            parsed = urlsplit(endpoint)
            response = fixtures[parsed.path]
            if not isinstance(response, list):
                return copy.deepcopy(response)
            query = parse_qs(parsed.query)
            start = (int(query['page'][0])-1) * int(query['per_page'][0])
            return copy.deepcopy(response[start:start+int(query['per_page'][0])])
        actual = refresh_history.build_history(expected, reader, expected['fetchedAt'])
        canonical = copy.deepcopy(expected)
        for repository in canonical['repositories'].values():
            for field in ('mergedPRs', 'openPRs', 'closedIssues'):
                repository[field].sort(key=lambda row: row['number'])
        self.assertEqual(actual, canonical)
        self.assertEqual(json.dumps(actual, indent=2, ensure_ascii=False) + '\n', json.dumps(canonical, indent=2, ensure_ascii=False) + '\n')
        # Historical hand edits used inconsistent list order. The first
        # generated refresh must disclose each reordered array.
        for name, repository in expected['repositories'].items():
            for field in ('mergedPRs', 'openPRs', 'closedIssues'):
                if repository[field] != canonical['repositories'][name][field]:
                    self.assertIn(f'{name} {field}: order normalized', refresh_history.history_differences(expected, actual))

    def test_rolling_pull_is_excluded_by_branch_only(self):
        metadata = dict(created_at='2026-01-01', pushed_at='2026-01-02', default_branch='main')
        def reader(endpoint):
            if endpoint == 'repos/jimmie-potts/example': return metadata
            if endpoint.endswith('/commits/main'): return {'sha':'head'}
            if '/commits?' in endpoint: return [dict(sha='head',commit=dict(committer={'date':'2026-01-01'},message='initial'))]
            if '/issues?' in endpoint: return []
            if '/pulls?' in endpoint:
                return [dict(number=number,title='Nightly guide refresh',created_at='2026-01-01',html_url=f'https://example/{number}',base={'ref':'main'},state='open',merged_at=None,head={'ref':branch}) for number, branch in [(1,'guide/nightly-refresh'),(2,'another-branch')]]
            raise AssertionError(endpoint)
        result = refresh_history.repository('example', reader)
        self.assertEqual([row['number'] for row in result['openPRs']], [2])

    def test_push_time_only_preserves_whole_observation(self):
        from unittest.mock import patch
        previous = dict(source='fixture', fetchedAt='yesterday', repositories={'example':dict(headSha='head',pushedAt='yesterday')})
        current = copy.deepcopy(previous)
        current['fetchedAt'] = 'today'
        current['repositories']['example']['pushedAt'] = 'today'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'history.json'
            original = json.dumps(previous) + '\n'
            path.write_text(original)
            with patch.object(refresh_history, 'build_history', return_value=current):
                self.assertEqual(refresh_history.refresh(path), previous)
            self.assertEqual(path.read_text(), original)
            current['repositories']['example']['headSha'] = 'new-head'
            with patch.object(refresh_history, 'build_history', return_value=current):
                self.assertEqual(refresh_history.refresh(path), current)
            self.assertEqual(json.loads(path.read_text()), current)
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_two_pages_and_failure_preserves_previous_file(self):
        calls = []
        def reader(endpoint):
            calls.append(endpoint)
            return list(range(100)) if endpoint.endswith('page=1') else [100]
        self.assertEqual(refresh_history.pages('items?state=all', reader), list(range(101)))
        self.assertEqual(calls, ['items?state=all&per_page=100&page=1', 'items?state=all&per_page=100&page=2'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'history.json'
            original = '{"source":"fixture","repositories":{"example":{}}}\n'
            path.write_text(original)
            def failure(endpoint):
                raise RuntimeError('fixture failed repository read')
            with self.assertRaisesRegex(RuntimeError, 'failed repository read'):
                refresh_history.refresh(path, failure, 'today')
            self.assertEqual(path.read_text(), original)


class ReportTests(unittest.TestCase):
    def test_change_report_names_story_changes_and_direction_failure(self):
        import refresh_report
        import recommendations
        body = 'Scope.\n\n## Guide\n\n**Topic:** work-guide\n'
        entry = dict(status='insufficient', missing='owner choice', assessed=dict(policy='fixture@123', evidence='fixture'))
        assessed = body + '\n' + recommendations.render(entry, '2026-01-01', recommendations.fingerprint(body))
        def issue(number, title, state='OPEN', labels=(), text=body):
            return dict(number=number, title=title, state=state, labels=[{'name':x} for x in labels], body=text)
        before = {'agent-device-hub':[issue(1,'Old title',labels=['status:ready'],text=assessed), issue(2,'Closing')]}
        after = {'agent-device-hub':[issue(1,'New title',labels=['status:review'],text=assessed.replace('Scope.', 'Changed scope.')), issue(2,'Closing',state='CLOSED'), issue(3,'New story',text=body.replace('work-guide', 'shared-codex')), issue(4,'Needs definition',text=assessed)]}
        result = refresh_report.render_report(before, after, refreshed_at='2026-01-02T03:00:00Z', direction_errors=['SEQUENCE cites H2, which is closed'], retired_warnings=['H3: retired wording'])
        for expected in ('Opened: H3 — New story', 'Closed: H2 — Closing', 'Retitled: H1 — Old title → New title', 'Relabelled: H1 — status:ready → status:review', 'work-guide: 2 → 2', 'shared-codex: 0 → 1', 'H1 — insufficient → stale', 'H3 — absent → not yet assessed', 'H4 — absent → insufficient', 'needs owner rewrite of guide_direction.py', 'SEQUENCE cites H2', 'H3: retired wording', '2026-01-02T03:00:00Z'):
            self.assertIn(expected, result)

    def test_absence_does_not_claim_closure_and_direction_pass_is_explicit(self):
        import refresh_report
        old = {'agent-device-hub':[dict(number=1,title='Unretained',state='OPEN',labels=[],body='')]}
        result = refresh_report.render_report(old, {'agent-device-hub':[]}, refreshed_at='today')
        self.assertIn('Missing from snapshot (closure unverified): H1',result)
        self.assertNotIn('Closed: H1', result)
        self.assertIn('Direction check: passed', result)

    def test_history_only_closure_does_not_invent_label_removal(self):
        from refresh_report import load_snapshots, render_report
        from refresh_backlogs import REPOS
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / 'backlogs').mkdir()
            (work / 'history').mkdir()
            for repo in REPOS:
                (work / 'backlogs' / f'{repo}-issues.json').write_text('[]')
            history = {'repositories': {repo: {'closedIssues': []} for repo in REPOS}}
            history['repositories']['agent-device-hub']['closedIssues'] = [
                {'number': 1, 'title': 'Closed story', 'closedAt': '2026-09-26T01:00:00Z'}]
            (work / 'history/github-history.json').write_text(json.dumps(history))
            before = {'agent-device-hub': [{'number': 1, 'title': 'Closed story', 'state': 'OPEN',
                      'body': '', 'labels': [{'name': 'maintenance'}]}]}
            report = render_report(before, load_snapshots(work / 'backlogs'), refreshed_at='now')
            self.assertIn('Closed: H1', report)
            self.assertNotIn('Relabelled: H1', report)


if __name__ == '__main__':
    unittest.main()
