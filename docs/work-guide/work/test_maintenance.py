"""Offline regression check for independent history and architecture updates."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest


class GuideMaintenance(unittest.TestCase):
    def test_overview_uses_creation_dates_and_keeps_all_open_defects(self):
        from guide_status import overview_keys
        def issue(created, *labels, state='OPEN', updated='2026-10-01T00:00:00Z'):
            return dict(state=state, createdAt=created, updatedAt=updated,
                        labels=[{'name': name} for name in labels])
        issues = {
            'H1': issue('2026-09-01T00:00:00Z', 'bug', 'priority:p1'),
            'N2': issue('2026-09-23T00:00:00Z', 'bug', 'blocked', 'deferred'),
            'P3': issue('2026-09-22T00:00:00Z', 'bug', state='CLOSED'),
            'H4': issue('2026-09-24T00:00:00Z', 'status:review'),
        }
        selected = overview_keys(issues, '2026-09-24T01:00:00Z')
        self.assertEqual(selected['new'], ['H4', 'N2', 'H1'])
        self.assertEqual(selected['week'], ['H4', 'N2'])
        self.assertEqual(selected['defects'], ['H1', 'N2'])
        self.assertEqual(selected['current'], ['H4'])

    def test_roadmap_order_does_not_claim_blocked_work_is_ready(self):
        source = Path(__file__).resolve().parent.parent
        document = (source / 'outputs/agent-device-work-guides.html').read_text()
        self.assertFalse('class="node ready"' in document, 'Roadmap still claims readiness')
        self.assertFalse('ready for selection now' in document)
        self.assertFalse('Now · ready or independent' in document)

    def test_status_and_parallel_candidates_respect_gates(self):
        from guide_status import issue_status, scheduling_state

        def issue(state='OPEN', reason=None, *labels):
            return {'state': state, 'stateReason': reason,
                    'labels': [{'name': label} for label in labels]}

        self.assertEqual(issue_status(issue('CLOSED', 'not_planned')), 'closed')
        self.assertEqual(issue_status(issue('CLOSED', None)), 'closed')
        self.assertEqual(issue_status(issue('CLOSED', 'completed', 'blocked')), 'completed')
        self.assertEqual(issue_status(issue('OPEN', None, 'status:in-progress')), 'in-progress')
        self.assertEqual(scheduling_state(issue('OPEN', None, 'blocked'), []), 'blocked')
        self.assertEqual(scheduling_state(issue('OPEN', None, 'deferred'), []), 'deferred')
        self.assertEqual(scheduling_state(issue('OPEN', None, 'status:review'), []), 'active')
        self.assertEqual(scheduling_state(issue(), [{'state': 'OPEN'}]), 'blocked')
        self.assertEqual(scheduling_state(issue(), [{'state': 'CLOSED'}]), 'candidate')

    def test_status_only_issue_reads_do_not_claim_comments_were_refreshed(self):
        source = Path(__file__).resolve().parent / 'backlogs'
        references = {
            'agent-device-hub-issues.json': (10, 86, 196, 200, 207, 210, 212),
            'codex-nanoleaf-issues.json': (31, 84),
            'divoom-app-upgrade-issues.json': (38, 47, 68, 72),
        }
        for filename, numbers in references.items():
            issues = json.loads((source / filename).read_text())
            for number in numbers:
                with self.subTest(issue=number, file=filename):
                    issue = next(row for row in issues if row['number'] == number)
                    self.assertEqual(issue['comments'], [])
                    self.assertFalse(issue['commentsRefreshed'])

    def test_parallel_recommendation_is_withheld_when_a_blocker_appears(self):
        source = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory(prefix='guide-blocker-') as directory:
            candidate = Path(directory) / 'guide'
            shutil.copytree(source, candidate, ignore=shutil.ignore_patterns(
                '*.png', '*.pdf', '__pycache__', 'guide-verification.json'))
            path = candidate / 'work/backlogs/hub-native-deps.json'
            native = json.loads(path.read_text())
            issue = next(row for row in native['data']['repository']['issues']['nodes'] if row['number'] == 218)
            issue['blockedBy']['nodes'].append({
                'number': 11, 'state': 'OPEN',
                'repository': {'nameWithOwner': 'jimmie-potts/divoom-app-upgrade'}})
            issue['blockedBy']['totalCount'] += 1
            path.write_text(json.dumps(native))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            document = (candidate / 'outputs/agent-device-work-guides.html').read_text()
            next_section = document.split('id="next-steps"', 1)[1].split('</section>', 1)[0]
            self.assertNotIn('data-key="H218"', next_section)
            self.assertNotIn('data-key="P61"', next_section)
            blockers = document.split('id="work-blockers"', 1)[1].split('</section>', 1)[0]
            self.assertIn('data-key="H218"', blockers)
            self.assertIn('Waiting for divoom-app-upgrade #11.', blockers)

    def test_issue_links_explain_completion_without_relying_on_color(self):
        from html.parser import HTMLParser

        class Links(HTMLParser):
            def __init__(self):
                super().__init__()
                self.links, self.current = {}, None

            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == 'a' and 'data-issue' in attrs:
                    self.current = [attrs, '']

            def handle_data(self, text):
                if self.current:
                    self.current[1] += text

            def handle_endtag(self, tag):
                if tag == 'a' and self.current:
                    self.links.setdefault(self.current[0]['data-issue'], []).append(self.current)
                    self.current = None

        source = Path(__file__).resolve().parent.parent
        links = Links()
        links.feed((source / 'outputs/agent-device-work-guides.html').read_text())
        for attrs, text in links.links['P34']:
            self.assertEqual(attrs.get('data-status'), 'completed')
            self.assertIn('Completed', text)
            self.assertIn('✓', text)
        for attrs, text in links.links['N41']:
            self.assertEqual(attrs.get('data-status'), 'completed')
            self.assertIn('Completed', text)
        for attrs, text in links.links['N92']:
            self.assertEqual(attrs.get('data-status'), 'open')
            self.assertIn('Open', text)
        for attrs, text in links.links['H50']:
            self.assertEqual(attrs.get('data-status'), 'completed')
            self.assertIn('Completed', text)
            self.assertNotIn('blocked', text)

    def test_checkpoint_dependency_is_external_to_primary_coverage(self):
        source = Path(__file__).resolve().parent.parent
        backlogs = source / 'work/backlogs'
        coverage = json.loads((backlogs / 'guide-coverage.json').read_text())
        primary = [key for keys in coverage.values() for key in keys]
        issue_rows = json.loads((backlogs / 'agent-device-hub-issues.json').read_text())
        is_open = any(i['number'] == 83 and i['state'] == 'OPEN' for i in issue_rows)
        self.assertEqual(primary.count('H83'), int(is_open))
        if is_open:
            self.assertIn('H83', coverage['development-workflow'])
        native = json.loads((backlogs / 'hub-native-deps.json').read_text())
        for issue in native['data']['repository']['issues']['nodes']:
            if issue['number'] == 83:
                endpoints = {(d['repository']['nameWithOwner'], d['number'])
                             for d in issue['blockedBy']['nodes']}
                self.assertIn(('jimmie-potts/agent-skills', 33), endpoints)
        html = (source / 'outputs/agent-device-work-guides.html').read_text()
        self.assertIn('https://github.com/jimmie-potts/agent-skills/issues/33', html)
        with tempfile.TemporaryDirectory(prefix='guide-external-') as directory:
            candidate = Path(directory) / 'guide'
            shutil.copytree(source, candidate, ignore=shutil.ignore_patterns(
                '*.png', '*.pdf', '__pycache__', 'guide-verification.json'))
            # An external reference must not inflate the three-repository totals.
            coverage['development-workflow'].append('X33')
            (candidate / 'work/backlogs/guide-coverage.json').write_text(json.dumps(coverage))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Coverage mismatch', result.stderr)

    def test_refreshed_sequences_follow_native_prerequisites(self):
        import importlib.util
        source = Path(__file__).resolve().parent
        spec = importlib.util.spec_from_file_location('guide_timeline', source / 'timeline.py')
        timeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(timeline)
        positions = {key: node['x'] for _, nodes in timeline.TRACKS
                     for node in nodes for key in node['issues']}
        native = json.loads((source / 'backlogs/device-native-deps.json').read_text())
        rows = native['data']['n']['issues']['nodes']
        for issue in (i for i in rows if i['number'] in (26, 53, 55)):
            target = issue['number']
            for dependency in issue['blockedBy']['nodes']:
                self.assertEqual(dependency['repository']['nameWithOwner'],
                                 'jimmie-potts/codex-nanoleaf')
                if dependency['state'] == 'OPEN':
                    self.assertLess(positions[f'N{dependency["number"]}'], positions[f'N{target}'])
        hub = json.loads((source / 'backlogs/hub-native-deps.json').read_text())
        for adoption in hub['data']['repository']['issues']['nodes']:
            if adoption['number'] == 43:
                for dependency in adoption['blockedBy']['nodes']:
                    if dependency['state'] == 'OPEN' and dependency['number'] == 55:
                        self.assertEqual(dependency['repository']['nameWithOwner'],
                                         'jimmie-potts/codex-nanoleaf')
                        self.assertLess(positions['N55'], positions['H43'])

    def test_changed_tracks_match_native_dependencies(self):
        import timeline
        source=Path(__file__).resolve().parent/'backlogs'
        native_h=json.loads((source/'hub-native-deps.json').read_text())['data']['repository']['issues']['nodes']
        native_n=json.loads((source/'device-native-deps.json').read_text())['data']['n']['issues']['nodes']
        prefixes={'jimmie-potts/codex-nanoleaf':'N','jimmie-potts/agent-device-hub':'H'}
        starts={'N52','N53','N54','N55','H85','H86'}
        expected=set()
        for prefix,issues in [('H',native_h),('N',native_n)]:
            for issue in issues:
                for blocker in issue['blockedBy']['nodes']:
                    key=prefixes.get(blocker['repository']['nameWithOwner'],'?')+str(blocker['number'])
                    if key in starts and blocker['state'] == 'OPEN':
                        expected.add((key,prefix+str(issue['number'])))
        actual=set()
        for _,items in timeline.TRACKS:
            for a,b in zip(items,items[1:]):
                actual.update((left,right) for left in a['issues'] for right in b['issues'] if left in starts)
        nodes = {item['id']: item for _, items in timeline.TRACKS for item in items}
        for source, target, _ in timeline.CROSS:
            actual.update((left, right) for left in nodes[source]['issues']
                          for right in nodes[target]['issues'] if left in starts)
        self.assertEqual(actual,expected)

    def test_linux_acceptance_keeps_comment_references_without_private_content(self):
        source = Path(__file__).resolve().parent / 'backlogs'
        issues = json.loads((source / 'codex-nanoleaf-issues.json').read_text())
        for number in (54, 55):
            issue = next(row for row in issues if row['number'] == number)
            self.assertTrue(issue['comments'], f'Keep acceptance references for #{number}')
            for comment in issue['comments']:
                self.assertEqual(set(comment), {'url', 'createdAt', 'updatedAt'})
                self.assertTrue(comment['url'].startswith(
                    f'https://github.com/jimmie-potts/codex-nanoleaf/issues/{number}#issuecomment-'))

    def test_changed_diagram_definition_needs_regeneration(self):
        source = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory(prefix='guide-diagram-drift-') as directory:
            candidate = Path(directory) / 'guide'
            shutil.copytree(source, candidate, ignore=shutil.ignore_patterns(
                '*.png', '*.pdf', '__pycache__', 'guide-verification.json'))
            definitions = candidate / 'work/architecture_diagrams.py'
            # Edit one definition and leave every saved specification, receipt and render alone.
            anchor = '\nassert len({d[\'id\'] for d in DIAGRAMS})'
            text = definitions.read_text()
            self.assertEqual(text.count(anchor), 1)
            definitions.write_text(text.replace(anchor, (
                "\nnext(d for d in DIAGRAMS if d['id'] == 'seq-nanoleaf-command')['spec']['meta']['title'] += ' (edited)'"
                + anchor)))
            build = [sys.executable, str(candidate / 'work/build_guide.py')]
            result = subprocess.run(build, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Stale specification for seq-nanoleaf-command', result.stderr)
            archify = Path(os.environ.get('ARCHIFY_DIR', Path.home() / '.agents/skills/archify'))
            if not (archify / 'bin/archify.mjs').exists():
                self.skipTest('Archify is not installed; regeneration half not run')
            render = subprocess.run([sys.executable, str(definitions)], capture_output=True, text=True)
            self.assertEqual(render.returncode, 0, render.stdout + render.stderr)
            result = subprocess.run(build, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            viewer = (candidate / 'outputs/architecture/seq-nanoleaf-command.html').read_text()
            self.assertIn('(edited)', viewer)

    def test_later_history_preserves_reviewed_architecture(self):
        source = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory(prefix='guide-maintenance-') as directory:
            candidate = Path(directory) / 'guide'
            shutil.copytree(source, candidate, ignore=shutil.ignore_patterns(
                '*.png', '*.pdf', '__pycache__', 'guide-verification.json'))
            history_path = candidate / 'work/history/github-history.json'
            history = json.loads(history_path.read_text())
            # A later delivery can change all main heads without changing the
            # architecture files. This is synthetic history, never published.
            for repo in history['repositories'].values():
                repo['headSha'] = '0' * 40
            history_path.write_text(json.dumps(history))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            html = (candidate / 'outputs/agent-device-work-guides.html').read_text()
            self.assertNotIn('still the current main heads', html)
            sources = json.loads((candidate / 'work/architecture/source-receipts.json').read_text())
            for revision in sources['sourceRevisions'].values():
                self.assertIn(revision, html)


if __name__ == '__main__':
    unittest.main()
