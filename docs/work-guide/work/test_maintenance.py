"""Offline regression check for independent history and architecture updates."""
from pathlib import Path
import json
import re
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SKINS = Path(__file__).resolve().parents[2] / 'skins'


def copy_guide(directory):
    """A disposable guide copy with the shared skin files beside it, as in the repository."""
    candidate = Path(directory) / 'guide'
    shutil.copytree(Path(__file__).resolve().parent.parent, candidate, ignore=shutil.ignore_patterns(
        '*.png', '*.pdf', '__pycache__', 'guide-verification.json'))
    shutil.copytree(SKINS, Path(directory) / 'skins', ignore=shutil.ignore_patterns('__pycache__'))
    return candidate


def token_check():
    sys.path.insert(0, str(SKINS))
    import check_tokens
    return check_tokens


class GuideMaintenance(unittest.TestCase):
    def test_styles_take_colors_from_tokens(self):
        result = subprocess.run([sys.executable, str(SKINS / 'check_tokens.py')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_token_check_names_each_color_literal(self):
        check = token_check()
        source = ("# Nanoleaf #121 follows #118 in a comment, not a color\n"
                  "CSS = '.a{color:#123456;white-space:nowrap;border:1px solid var(--edge)}.b{fill:rgba(1,2,3,.5)}'\n"
                  "HTML = '<path stroke=\"red\" fill=\"currentColor\"/><a href=\"#top\">Hub #32</a>'\n")
        self.assertEqual(check.color_literals(source, '.py'), [(2, '#123456'), (2, 'rgba(1,2,3,.5)'), (3, 'red')])
        self.assertEqual(check.color_literals('/* #fff */\n.a{outline:1px solid Black;color:transparent}', '.css'), [(2, 'Black')])
        # Fragment ids that happen to look like hex are not colors; a hex attribute value still is.
        self.assertEqual(check.color_literals('.a{fill:url(#fade)}<a href="#dead">x</a><use href=\'#cafe\'/>', '.css'), [])
        self.assertEqual(check.color_literals("document.querySelector('#face');root.querySelectorAll(\"#bead\");", '.js'), [])
        self.assertEqual(check.color_literals("paint('#ffcc00');tint(\"#bead\")", '.js'), [(1, '#bead'), (1, '#ffcc00')])
        self.assertEqual(check.color_literals('<path fill="#abc" stroke="#face"/>', '.css'), [(1, '#abc'), (1, '#face')])
        with tempfile.TemporaryDirectory(prefix='guide-tokens-') as directory:
            root = Path(directory)
            docs = SKINS.parent
            for path in check.sources():
                target = root / 'docs' / path.relative_to(docs)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
            for name in ('fixed.css', 'neon-geometry-wars.css', 'check_tokens.py'):
                shutil.copyfile(SKINS / name, root / 'docs/skins' / name)
            reading = root / 'docs/work-guide/work/guide_reading.css'
            reading.write_text(reading.read_text() + '.probe{background:#123456}\n')
            result = subprocess.run([sys.executable, str(root / 'docs/skins/check_tokens.py')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1, result.stdout)
            line = reading.read_text().count('\n')
            self.assertIn(f'docs/work-guide/work/guide_reading.css:{line}: color literal #123456', result.stdout)

    def test_skin_contract_rejects_drift(self):
        check = token_check()
        with tempfile.TemporaryDirectory(prefix='guide-skin-') as directory:
            skin = Path(directory) / 'neon-geometry-wars.css'
            text = (SKINS / skin.name).read_text()
            self.assertEqual(check.token_file_problems(SKINS / skin.name, {'dark': check.ROLES, 'light': check.COLOR_ROLES,
                                                                           'fallback': check.COLOR_ROLES, 'print': check.COLOR_ROLES}), [])
            fallback = text.index('prefers-color-scheme:light')
            text = text[:fallback] + text[fallback:].replace('--pending:#a21caf;', '--pending:#a21cae;', 1)
            text = text.replace('--radius:2px;', '--radius:2px;--repo-hub:#22d3ee;', 1).replace('--focus:#ffffff;', '', 1)
            skin.write_text(text + '.stray::after{content:""}\n')
            problems = '\n'.join(check.token_file_problems(skin, {'dark': check.ROLES, 'light': check.COLOR_ROLES,
                                                                  'fallback': check.COLOR_ROLES, 'print': check.COLOR_ROLES}))
            for expected in ('fallback must match the light block', 'sets unknown or fixed token --repo-hub',
                             'dark block lacks --focus', 'decoration outside html[data-skin="neon-geometry-wars"]: .stray::after'):
                self.assertIn(expected, problems)

    def test_stylesheet_rewrites_must_match(self):
        with tempfile.TemporaryDirectory(prefix='guide-rewrite-') as directory:
            candidate = copy_guide(directory)
            build = candidate / 'work/build_guide.py'
            text = build.read_text()
            self.assertEqual(text.count('.guide summary:hover{'), 2)
            build.write_text(text.replace('.guide summary:hover{background', '.guide>summary:hover{background', 1))
            result = subprocess.run([sys.executable, str(build), '--validate-inputs'], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Stylesheet rewrite target missing: .guide summary:hover{', result.stderr)

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
        import guide_section as GD
        with tempfile.TemporaryDirectory(prefix='guide-blocker-') as directory:
            candidate = copy_guide(directory)
            backlog = candidate / 'work/backlogs/agent-device-hub-issues.json'
            rows = json.loads(backlog.read_text())
            issue = next(row for row in rows if row['state'] == 'OPEN')
            key = f"H{issue['number']}"
            section = GD.read(issue['body'])
            issue['body'], _ = GD.upsert(issue['body'], dict(topic=section['topic'], note=section['note'],
                workaround=section['workaround'], highlight=dict(kind='next step', reason='Fixture candidate.'), extends=[]))
            issue['labels'] = [label for label in issue['labels'] if label['name'] not in
                               ('blocked', 'deferred', 'status:in-progress', 'status:review')]
            backlog.write_text(json.dumps(rows))
            path = candidate / 'work/backlogs/hub-native-deps.json'
            native = json.loads(path.read_text())
            record = next(row for row in native['data']['repository']['issues']['nodes'] if row['number'] == issue['number'])
            record['blockedBy'] = dict(nodes=[], totalCount=0, pageInfo={'hasNextPage': False})
            path.write_text(json.dumps(native))
            command = [sys.executable, str(candidate / 'work/build_guide.py')]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = candidate / 'outputs/agent-device-work-guides.html'
            baseline = output.read_text().split('id="next-steps"', 1)[1].split('</section>', 1)[0]
            self.assertIn(f'data-key="{key}"', baseline)
            pixoo = json.loads((candidate / 'work/backlogs/divoom-app-upgrade-issues.json').read_text())
            blocker = next(row for row in pixoo if row['state'] == 'OPEN')
            record['blockedBy']['nodes'].append({'number': blocker['number'], 'state': 'OPEN',
                'repository': {'nameWithOwner': 'jimmie-potts/divoom-app-upgrade'}})
            record['blockedBy']['totalCount'] = 1
            path.write_text(json.dumps(native))
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            document = output.read_text()
            next_section = document.split('id="next-steps"', 1)[1].split('</section>', 1)[0]
            self.assertNotIn(f'data-key="{key}"', next_section)
            self.assertNotIn('data-key="P61"', next_section)
            blockers = document.split('id="work-blockers"', 1)[1].split('</section>', 1)[0]
            self.assertIn(f'data-key="{key}"', blockers)
            self.assertIn(f"Waiting for divoom-app-upgrade #{blocker['number']}.", blockers)

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
        for attrs, text in links.links['N47']:
            self.assertEqual(attrs.get('data-status'), 'open')
            self.assertIn('Open', text)
        for attrs, text in links.links['H50']:
            self.assertEqual(attrs.get('data-status'), 'completed')
            self.assertIn('Completed', text)
            self.assertNotIn('blocked', text)

    def test_checkpoint_dependency_is_external_to_primary_coverage(self):
        import guide_section as GD
        source = Path(__file__).resolve().parent.parent
        backlogs = source / 'work/backlogs'
        issue_rows = json.loads((backlogs / 'agent-device-hub-issues.json').read_text())
        row83 = next((row for row in issue_rows if row['number'] == 83), None)
        is_open = bool(row83 and row83['state'] == 'OPEN')
        if is_open:
            state = GD.read(row83['body'])
            self.assertEqual(state['state'], 'assigned')
            self.assertEqual(state['topic'], 'development-workflow')
        native = json.loads((backlogs / 'hub-native-deps.json').read_text())
        for issue in native['data']['repository']['issues']['nodes']:
            if issue['number'] == 83:
                endpoints = {(d['repository']['nameWithOwner'], d['number'])
                             for d in issue['blockedBy']['nodes']}
                self.assertIn(('jimmie-potts/agent-skills', 33), endpoints)
        html = (source / 'outputs/agent-device-work-guides.html').read_text()
        self.assertIn('https://github.com/jimmie-potts/agent-skills/issues/33', html)
        with tempfile.TemporaryDirectory(prefix='guide-external-') as directory:
            candidate = copy_guide(directory)
            # An open story with no valid Guide topic must fail the build, naming the story.
            path = candidate / 'work/backlogs/agent-device-hub-issues.json'
            rows = json.loads(path.read_text())
            row = next(row for row in rows if row['state'] == 'OPEN')
            self.assertIn('**Topic:**', row['body'])
            row['body'] = re.sub(r'\*\*Topic:\*\* [^\n]+', '**Topic:** not-a-real-topic', row['body'], count=1)
            path.write_text(json.dumps(rows))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(f'H{row["number"]}', result.stderr)
            self.assertIn('unknown topic', result.stderr)

    def test_unplaced_track_row_remains_visible_without_guessing(self):
        with tempfile.TemporaryDirectory(prefix='guide-tracks-') as directory:
            candidate = copy_guide(directory)
            # A row left out of every track would otherwise vanish from its guide.
            paths = candidate / 'work/guide_paths.py'
            text = paths.read_text()
            self.assertEqual(text.count("'P61']"), 1)
            paths.write_text(text.replace("'P61']", ']'))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(any('P61' in line.split(': ', 2)[-1].split(', ')
                                for line in result.stderr.splitlines() if 'Track placement pending:' in line))
            document = (candidate / 'outputs/agent-device-work-guides.html').read_text()
            pending = document.split('Track placement pending</h3>', 1)[1].split('</table>', 1)[0]
            self.assertIn('data-issue="P61"', pending)

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
        with tempfile.TemporaryDirectory(prefix='guide-diagram-drift-') as directory:
            candidate = copy_guide(directory)
            definitions = candidate / 'work/architecture_diagrams.py'
            # Edit one definition and leave every saved specification, receipt and render alone.
            anchor = '\nassert len({d[\'id\'] for d in DIAGRAMS})'
            text = definitions.read_text()
            self.assertEqual(text.count(anchor), 1)
            definitions.write_text(text.replace(anchor, (
                "\nnext(d for d in DIAGRAMS if d['id'] == 'seq-nanoleaf-command')['spec']['meta']['title'] += ' (edited)'"
                + anchor)))
            build = [sys.executable, str(candidate / 'work/build_guide.py')]
            # Check this late assertion even when Direction independently blocks output.
            result = subprocess.run([*build, '--validate-inputs'], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Stale specification for seq-nanoleaf-command', result.stderr)
            archify = Path(os.environ.get('ARCHIFY_DIR', Path.home() / '.agents/skills/archify'))
            if not (archify / 'bin/archify.mjs').exists():
                # The stale-specification assertion above is mandatory. The optional
                # local round trip requires the separately installed renderer.
                print('Optional Archify regeneration not exercised: tool is not installed.', file=sys.stderr)
                return
            render = subprocess.run([sys.executable, str(definitions)], capture_output=True, text=True)
            self.assertEqual(render.returncode, 0, render.stdout + render.stderr)
            result = subprocess.run(build, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            viewer = (candidate / 'outputs/architecture/seq-nanoleaf-command.html').read_text()
            self.assertIn('(edited)', viewer)

    def test_later_history_preserves_reviewed_architecture(self):
        with tempfile.TemporaryDirectory(prefix='guide-maintenance-') as directory:
            candidate = copy_guide(directory)
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

    def test_open_story_without_a_guide_section_fails_the_build_naming_it(self):
        with tempfile.TemporaryDirectory(prefix='guide-missing-topic-') as directory:
            candidate = copy_guide(directory)
            path = candidate / 'work/backlogs/agent-device-hub-issues.json'
            rows = json.loads(path.read_text())
            row = next(row for row in rows if row['state'] == 'OPEN')
            row['body'] = re.sub(r'\n## Guide\n.*', '', row['body'] or '', flags=re.S)
            self.assertNotIn('## Guide', row['body'])
            path.write_text(json.dumps(rows))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(f'H{row["number"]}', result.stderr)
            self.assertIn('unassigned', result.stderr)

    def test_hostile_guide_text_renders_literally_in_the_build(self):
        import guide_section as GD
        hostile = '<img src=x onerror=alert(1)> & "q" [[not-a-link]]'
        with tempfile.TemporaryDirectory(prefix='guide-hostile-') as directory:
            candidate = copy_guide(directory)
            path = candidate / 'work/backlogs/agent-device-hub-issues.json'
            rows = json.loads(path.read_text())
            row = next(row for row in rows if row['state'] == 'OPEN')
            state = GD.read(row['body'])
            new, outcome = GD.upsert(row['body'], dict(topic=state['topic'], note=hostile,
                                                        highlight=dict(kind='decision', reason=hostile)))
            self.assertEqual(outcome, 'updated')
            row['body'] = new
            path.write_text(json.dumps(rows))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            document = (candidate / 'outputs/agent-device-work-guides.html').read_text()
            self.assertNotIn(hostile, document, 'Hostile text must be escaped, not passed through raw')
            self.assertIn('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;', document)

    def test_each_highlight_kind_renders_in_its_opening_list(self):
        import guide_section as GD
        import guide_status as GS
        with tempfile.TemporaryDirectory(prefix='guide-highlight-') as directory:
            candidate = copy_guide(directory)
            issues = {}
            for prefix, repo in (('H', 'agent-device-hub'), ('N', 'codex-nanoleaf'), ('P', 'divoom-app-upgrade')):
                for r in json.loads((candidate / f'work/backlogs/{repo}-issues.json').read_text()):
                    issues[f'{prefix}{r["number"]}'] = r
            dependencies = GS.load_dependencies(candidate / 'work/backlogs', issues)
            path = candidate / 'work/backlogs/agent-device-hub-issues.json'
            rows = json.loads(path.read_text())
            targets = {'next step': None, 'decision': None, 'later': None}
            for row in rows:
                key = f'H{row["number"]}'
                if row['state'] != 'OPEN' or GS.scheduling_state(row, dependencies.get(key, [])) != 'candidate':
                    continue
                state = GD.read(row['body'])
                if state['state'] == 'assigned' and not state['highlight']:
                    for kind in targets:
                        if targets[kind] is None:
                            targets[kind] = row
                            break
            self.assertTrue(all(targets.values()), 'Need three unhighlighted open candidate stories as fixtures')
            for kind, row in targets.items():
                new, outcome = GD.upsert(row['body'], dict(topic=GD.read(row['body'])['topic'],
                                                           highlight=dict(kind=kind, reason=f'Fixture {kind} reason.')))
                self.assertEqual(outcome, 'updated')
                row['body'] = new
            path.write_text(json.dumps(rows))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            document = (candidate / 'outputs/agent-device-work-guides.html').read_text()
            sections = {'next step': 'next-steps', 'decision': 'work-blockers', 'later': 'later-work'}
            for kind, row in targets.items():
                section = document.split(f'id="{sections[kind]}"', 1)[1].split('</section>', 1)[0]
                self.assertIn(f'data-key="H{row["number"]}"', section, kind)
                self.assertIn(f'Fixture {kind} reason.', section)


class GuideSections(unittest.TestCase):
    def setUp(self):
        import guide_section
        self.G = guide_section
        self.topics = frozenset({'work-guide', 'shared-codex'})

    def test_each_key_parses_from_a_fixture(self):
        body = '## Outcome\n\nA fixture story.\n'
        new, outcome = self.G.upsert(body, dict(topic='work-guide', note='A one-line note with [[H1]] link.',
                                                workaround='Restart the service.',
                                                highlight=dict(kind='next step', reason='Do this next.')),
                                     topics=self.topics)
        self.assertEqual(outcome, 'created')
        self.assertTrue(new.startswith(body.rstrip('\n')), 'Other story text is byte-identical')
        result = self.G.read(new, self.topics)
        self.assertEqual(result, dict(state='assigned', topic='work-guide', note='A one-line note with [[H1]] link.',
                                      workaround='Restart the service.', highlight=dict(kind='next step', reason='Do this next.'), extends=[]))
        # Idempotent: rerunning the same entry writes nothing.
        again, outcome = self.G.upsert(new, dict(topic='work-guide', note='A one-line note with [[H1]] link.',
                                                 workaround='Restart the service.',
                                                 highlight=dict(kind='next step', reason='Do this next.')), topics=self.topics)
        self.assertEqual((again, outcome), (new, 'unchanged'))

    def test_missing_or_unknown_topic_is_invalid(self):
        self.assertEqual(self.G.read('## Guide\n\n**Note:** hi\n', self.topics)['state'], 'invalid')
        self.assertEqual(self.G.read('## Guide\n\n**Topic:** not-a-real-topic\n', self.topics)['state'], 'invalid')
        with self.assertRaises(ValueError):
            self.G.upsert('## Outcome\n\nFixture.\n', dict(topic='not-a-real-topic'), topics=self.topics)

    def test_story_without_a_section_is_unassigned(self):
        result = self.G.read('## Outcome\n\nNo Guide section here.\n', self.topics)
        self.assertEqual(result, dict(state='unassigned'))

    def test_bad_highlight_syntax_is_invalid(self):
        for bad in ('whatever', 'next step', 'nextstep, reason', 'next step reason'):
            with self.subTest(bad=bad):
                result = self.G.read(f'## Guide\n\n**Topic:** work-guide\n**Highlight:** {bad}\n', self.topics)
                self.assertEqual(result['state'], 'invalid')

    def test_hostile_text_is_literal(self):
        hostile = '<img src=x onerror=alert(1)> & "q" [[H1]] | `tick`'
        new, _ = self.G.upsert('## Outcome\n\nFixture.\n', dict(topic='work-guide', note=hostile, workaround=hostile,
                                                                 highlight=dict(kind='decision', reason=hostile)), topics=self.topics)
        result = self.G.read(new, self.topics)
        self.assertEqual(result['note'], hostile)
        self.assertEqual(result['workaround'], hostile)
        self.assertEqual(result['highlight']['reason'], hostile)
        # The section itself carries the raw text; HTML embedding escapes it (see build_guide.py).
        self.assertIn(hostile, new)

    def test_only_one_section_is_allowed(self):
        body = '## Guide\n\n**Topic:** work-guide\n\n## Guide\n\n**Topic:** shared-codex\n'
        self.assertEqual(self.G.read(body, self.topics)['state'], 'invalid')

    def test_retired_inputs_are_gone(self):
        root = Path(__file__).resolve().parent
        self.assertFalse((root / 'guide_details.py').exists())
        self.assertFalse((root / 'backlogs' / 'guide-coverage.json').exists())
        import guide_paths
        for name in ('DETAILS', 'NEXT_STEPS', 'DECISIONS', 'OWNER_LATER', 'WORKAROUNDS'):
            self.assertFalse(hasattr(guide_paths, name), f'guide_paths.{name} should be retired')


def recommendation_entry(session='Orchestrate', cheaper=True, **changes):
    """A synthetic assessor entry; the assessment content is fixture text only."""
    investigate = session == 'Investigate first'
    host = lambda model, delegate, reviewers: dict(model=model, thinking='high', session=session,
                                                   subagents='One read-only scout per repository.' if session in ('Orchestrate', 'Pair') else 'None',
                                                   reviewers=None if investigate else reviewers,
                                                   delegate=delegate, availability='Provisional: fixture availability')
    entry = dict(repo='agent-device-hub', number=900, status='recommended', answer='one fixture session.',
                 hosts=dict(claude=host('Opus (`opus`)', 'read-only `sonnet` scouts', dict(model='Sonnet (`sonnet`)')),
                            codex=host('Sol (`gpt-6-sol`)', 'read-only Luna (`gpt-6-luna`) scouts', dict(model='Luna (`gpt-6-luna`)', level='high'))),
                 no_cheaper='the fixture has no smaller start.',
                 question='Does the fixture question have an answer?', why='fixture reasons.', reassess='the fixture changes.',
                 assessed=dict(date='2026-09-24', policy='agent-skills@3e009e6', evidence='fixture evidence'))
    if cheaper:
        entry['cheaper'] = dict(covers='the fixture part A', limit='Open the PR for part A only.',
                                hosts=dict(claude=dict(model='Sonnet (`sonnet`)', thinking='medium', session='One-shot'),
                                           codex=dict(model='Luna (`gpt-6-luna`)', thinking='medium', session='One-shot')))
    entry.update(changes)
    return entry


STORY = '## Outcome\n\nA fixture story.\n\n## Work assessment\n\n- **Complexity: medium.** Fixture.\n- **Uncertainty: low.** Fixture.\n- **Impact: high.** Fixture.\n'


class Recommendations(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        import recommendations
        self.R = recommendations

    def written(self, entry=None, body=STORY):
        return self.R.upsert(body, entry or recommendation_entry(), '2026-09-30')[0]

    def section(self, body):
        return body[body.index('## Execution recommendation'):]

    def test_both_hosts_prompts_and_starts_are_extracted(self):
        result = self.R.read(self.written())
        self.assertEqual(result['state'], 'recommended')
        self.assertEqual(result['label'], 'Orchestrate · Opus high / Sol high')
        self.assertEqual((result['hosts']['claude']['identifier'], result['hosts']['codex']['identifier']), ('opus', 'gpt-6-sol'))
        self.assertEqual(result['date'], '2026-09-24')
        for start in ('recommended', 'cheaper'):
            for host in ('claude', 'codex'):
                self.assertIn('https://github.com/jimmie-potts/agent-device-hub/issues/900', result['prompts'][start][host])
        self.assertIn('I started this session on Opus at high effort', result['prompts']['recommended']['claude'])
        self.assertIn('on gpt-6-sol at high reasoning', result['prompts']['recommended']['codex'])
        self.assertIn('on Sonnet at medium effort', result['prompts']['cheaper']['claude'])
        without = self.R.read(self.written(recommendation_entry(cheaper=False)))
        self.assertIsNone(without['prompts']['cheaper'], 'A missing cheaper start is absent, never invented')
        self.assertEqual(without['cheaper'], 'none recorded; the fixture has no smaller start.')
        self.assertEqual(result['hosts']['claude']['reviewers'], 'Two fresh read-only Sonnet (`sonnet`) reviewers, one for Standards and one for Specification')
        self.assertEqual(result['hosts']['codex']['reviewers'], 'Two fresh read-only Luna (`gpt-6-luna`) reviewers at `high`, one for Standards and one for Specification')
        # A section written before the canonical Reviewers row reads as unavailable, not guessed.
        self.assertEqual(self.R.read(re.sub(r'\| Reviewers \|[^\n]*\n', '', self.written()))['state'], 'unavailable')
        self.assertIsNone(self.R.brief(without)['prompts']['cheaper'])

    def test_work_surface_is_optional_validated_and_badged(self):
        unmarked = self.R.read(self.written())
        self.assertIsNone(unmarked['work_surface'], 'A story without the line is not classified')
        self.assertNotIn('work_surface', self.R.brief(unmarked))
        self.assertIn('data-surface="none">Not classified</span>', self.R.label_html('H900', unmarked))
        for value in self.R.WORK_SURFACES:
            with self.subTest(value=value):
                marked = self.R.read(self.written(recommendation_entry(work_surface=value)))
                self.assertEqual(marked['work_surface'], value)
                self.assertEqual(self.R.brief(marked)['work_surface'], value)
                self.assertIn(f'data-surface="{value}">{value}</span>', self.R.label_html('H900', marked))
        invalid = self.written().replace('**Start with:** one fixture session.', '**Start with:** one fixture session.\n**Work surface:** Frontend')
        result = self.R.read(invalid)
        self.assertEqual(result['state'], 'unavailable')
        self.assertIn('Work surface', result['reason'])

    def test_unreadable_sections_render_assessment_unavailable(self):
        body = self.written()
        section = self.section(body)
        cases = {
            'missing host': body.replace('| Model | Opus (`opus`) | Sol (`gpt-6-sol`) |', '| Model | Opus (`opus`) | |'),
            'missing Codex prompt': body.replace('**Prompt (Codex):**', '**Unknown (Codex):**'),
            'duplicate section': body + '\n' + section,
            'unknown key': body.replace('**Why:**', '**Rationale:**'),
            'unknown session type': body.replace('| Session type | Orchestrate |', '| Session type | Swarm |'),
            'unknown row': body.replace('| Thinking level |', '| Temperature |'),
            'unlabeled availability': body.replace('| Availability | Provisional: fixture', '| Availability | fixture'),
            'stray text': body.replace('**Why:**', 'Some prose.\n\n**Why:**'),
            'cheaper line without prompts': self.written(recommendation_entry(cheaper=False)).replace('**Cheaper start:** none recorded;', '**Cheaper start:** a guess;'),
            'missing reviewers row': re.sub(r'\| Reviewers \|[^\n]*\n', '', body),
            'reviewers on an investigation': self.written(recommendation_entry('Investigate first', cheaper=False)).replace('| Reviewers | None | None |', '| Reviewers | Two Sonnet | None |'),
            'no reviewers on an implementation': re.sub(r'\| Reviewers \|[^\n]*\n', '| Reviewers | None | None |\n', body),
            'invalid work surface': body.replace('**Start with:** one fixture session.', '**Start with:** one fixture session.\n**Work surface:** Frontend'),
        }
        for name, text in cases.items():
            with self.subTest(case=name):
                result = self.R.read(text)
                self.assertEqual(result['state'], 'unavailable', result)
                self.assertEqual(result['label'], 'Assessment unavailable')
                self.assertEqual(set(self.R.brief(result)), {'state', 'label', 'ratings', 'reason'})

    def test_freshness_and_missing_sections(self):
        body = self.written()
        self.assertEqual(self.R.read(STORY)['state'], 'unassessed')
        self.assertEqual(self.R.read(STORY)['label'], 'Not yet assessed')
        # Whitespace and line endings are normalized; story text is not.
        self.assertEqual(self.R.read(body.replace('\n', '\r\n') + '\n\n')['state'], 'recommended')
        edited = self.R.read(body.replace('A fixture story.', 'A changed story.'))
        self.assertEqual(edited['state'], 'stale')
        self.assertEqual(edited['label'], 'Needs reassessment (story text changed after 2026-09-24)')
        self.assertNotIn('prompts', self.R.brief(edited), 'A stale story never supplies a custom prompt')
        # Prompt text sits inside the section and outside the fingerprint.
        hand_edit = body.replace('Open the PR for part A only.', 'Open the PR for part A only, please.')
        self.assertEqual(self.R.read(hand_edit)['state'], 'recommended')
        self.assertIn('please', self.R.read(hand_edit)['prompts']['cheaper']['claude'])

    def test_guide_placement_does_not_stale_a_recommendation(self):
        import guide_section as GD
        topics = {'work-guide', 'devices'}
        body = self.written()
        # A Guide section added or edited after assessment is placement metadata, not scope.
        placed = GD.upsert(body, dict(topic='work-guide', note='Read this first.'), topics=topics)[0]
        moved = GD.upsert(placed, dict(topic='devices', note='Now read this elsewhere.'), topics=topics)[0]
        ahead = body.replace('## Execution recommendation', '## Guide\n\n**Topic:** devices\n\n## Execution recommendation')
        for name, text in (('added', placed), ('edited', moved), ('ahead of the section', ahead)):
            with self.subTest(case=name):
                result = self.R.read(text)
                self.assertEqual((result['state'], result['date']), ('recommended', '2026-09-24'))
        # A scope edit still stales it, with or without a Guide section.
        self.assertEqual(self.R.read(moved.replace('A fixture story.', 'A changed story.'))['state'], 'stale')
        self.assertEqual(self.R.read(moved.replace('**Complexity: medium.**', '**Complexity: high.**'))['state'], 'stale')
        # A revised assessment after a placement change keeps the recorded date.
        kept, outcome = self.R.upsert(placed, recommendation_entry(why='revised reasons.', assessed=dict(date='2026-10-01', policy='agent-skills@3e009e6', evidence='fixture evidence')), '2026-10-05')
        self.assertEqual(outcome, 'updated')
        self.assertEqual((self.R.read(kept)['state'], self.R.read(kept)['date']), ('recommended', '2026-09-24'))

    def test_provisional_availability_and_unchanged_ratings(self):
        entry = recommendation_entry()
        entry['hosts']['claude']['availability'] = 'Verified: fixture host evidence'
        result = self.R.read(self.written(entry))
        self.assertTrue(result['hosts']['claude']['verified'])
        self.assertFalse(result['hosts']['codex']['verified'], 'Provisional availability stays unverified')
        self.assertEqual(result['ratings'], {'Complexity': 'medium', 'Uncertainty': 'low', 'Impact': 'high'})
        self.assertIn('**Impact: high.** Fixture.', self.written(entry), 'The high-impact rating text is untouched')

    def test_parent_and_child_are_assessed_independently(self):
        parent = self.R.read(self.written(recommendation_entry('Orchestrate')))
        child_entry = recommendation_entry('One-shot', number=901)
        for host in child_entry['hosts'].values():
            host['model'] = 'Sonnet (`sonnet`)' if 'opus' in host['model'] else 'Luna (`gpt-6-luna`)'
            host['thinking'] = 'medium'
        child = self.R.read(self.written(child_entry, STORY.replace('A fixture story.', 'A child story of #900.')))
        self.assertEqual(parent['label'], 'Orchestrate · Opus high / Sol high')
        self.assertEqual(child['label'], 'One-shot · Sonnet medium / Luna medium')
        self.assertIn('/issues/901', child['prompts']['recommended']['claude'])

    def test_incomplete_entries_are_refused_with_a_reason(self):
        no_reviewers = recommendation_entry('One-shot', cheaper=False)
        no_reviewers['hosts']['codex']['reviewers'] = None
        with self.assertRaisesRegex(ValueError, 'two final reviewers'):
            self.R.upsert(STORY, no_reviewers, '2026-09-30')
        no_reason = recommendation_entry(cheaper=False)
        del no_reason['no_cheaper']
        with self.assertRaisesRegex(ValueError, 'why none is recorded'):
            self.R.upsert(STORY, no_reason, '2026-09-30')

    def test_insufficient_story_names_what_is_missing(self):
        entry = dict(repo='agent-device-hub', number=902, status='insufficient', missing='the owner has not chosen the bulbs.',
                     reassess='the owner records the bulbs.', work_surface='Unknown',
                     assessed=dict(date='2026-09-24', policy='agent-skills@3e009e6', evidence='fixture'))
        result = self.R.read(self.written(entry))
        self.assertEqual((result['state'], result['label']), ('insufficient', 'Insufficient information'))
        self.assertEqual(result['missing'], 'the owner has not chosen the bulbs.')
        self.assertEqual(result['work_surface'], 'Unknown')
        self.assertEqual(self.R.brief(result)['work_surface'], 'Unknown')
        self.assertNotIn('prompts', self.R.brief(result))
        with_table = self.written(entry).replace('**Missing:**', '| | Claude Code | Codex |\n| --- | --- | --- |\n\n**Missing:**')
        self.assertEqual(self.R.read(with_table)['state'], 'unavailable')

    def test_hostile_text_is_literal_everywhere(self):
        hostile = '<img src=x onerror=alert(1)> & "q" [[H1]] | `tick` ```'
        entry = recommendation_entry(answer=hostile, why=hostile, reassess=hostile, question=hostile)
        entry['hosts']['claude'].update(model=f'{hostile} (`opus`)', subagents=hostile, availability='Provisional: ' + hostile, delegate=hostile)
        entry['assessed']['evidence'] = hostile
        body = self.written(entry)
        result = self.R.read(body)
        self.assertEqual(result['state'], 'recommended', result.get('reason'))
        self.assertEqual(result['answer'], hostile)
        self.assertEqual(result['hosts']['claude']['subagents'], hostile)
        self.assertEqual(result['hosts']['claude']['model'], hostile)
        self.assertIn(hostile, result['prompts']['recommended']['claude'], 'A prompt containing fences survives its block')
        shown = self.R.brief(result)
        self.assertEqual(shown['prompts'], result['prompts'], 'Prompts reach the page verbatim')
        self.assertIn('<img src=x onerror=alert(1)>', shown['answer'], 'Display text stays literal; the page sets it as text')
        self.assertEqual(self.R.display('Sonnet (`sonnet`) [#252](https://example.test/252)'), 'Sonnet (sonnet) #252')
        label = self.R.label_html('H900', result)
        self.assertNotIn('<img', label)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; [[H1]]', label)

    def test_upsert_is_idempotent_and_touches_only_its_section(self):
        first, outcome = self.R.upsert(STORY, recommendation_entry(), '2026-09-30')
        self.assertEqual(outcome, 'created')
        self.assertEqual(first.count('## Execution recommendation'), 1)
        self.assertTrue(first.startswith(STORY.rstrip('\n')), 'Other story text is byte-identical')
        again, outcome = self.R.upsert(first, recommendation_entry(), '2026-10-05')
        self.assertEqual((again, outcome), (first, 'unchanged'))
        # A new assessment of unchanged story text keeps the recorded date.
        revised, outcome = self.R.upsert(first, recommendation_entry(why='revised reasons.', assessed=dict(date='2026-10-01', policy='agent-skills@3e009e6', evidence='fixture evidence')), '2026-10-05')
        self.assertEqual(outcome, 'updated')
        self.assertEqual(self.R.read(revised)['date'], '2026-09-24')
        self.assertEqual(revised.replace('revised reasons.', 'fixture reasons.'), first)
        # Changed story text takes the new assessment date and replaces only the section.
        story = first.replace('A fixture story.', 'A changed story.')
        replaced, outcome = self.R.upsert(story, recommendation_entry(assessed=dict(date='2026-10-01', policy='agent-skills@3e009e6', evidence='fixture evidence')), '2026-10-05')
        self.assertEqual(outcome, 'updated')
        self.assertEqual(self.R.read(replaced)['date'], '2026-10-01')
        self.assertEqual(self.R.without_section(replaced), self.R.without_section(story))
        # Sections that follow keep their place.
        middle = STORY + '\n## Execution recommendation\n\nold text\n\n## Later\n\nKeep me.\n'
        updated, outcome = self.R.upsert(middle, recommendation_entry(), '2026-09-30')
        self.assertTrue(updated.endswith('\n## Later\n\nKeep me.\n'))
        self.assertEqual(self.R.read(updated)['state'], 'recommended')

    def test_derived_assessment_is_added_once_and_existing_ratings_win(self):
        story = '## Outcome\n\nNo ratings yet.\n'
        assessment = '## Work assessment\n\nDelivery-pass assessment, 2026-09-24.\n\n- **Complexity: low.** Fixture.'
        entry = recommendation_entry(assessment=assessment)
        body, outcome = self.R.upsert(story, entry, '2026-09-30')
        self.assertEqual(outcome, 'created')
        self.assertLess(body.index('## Work assessment'), body.index('## Execution recommendation'))
        self.assertEqual(self.R.upsert(body, entry, '2026-09-30'), (body, 'unchanged'))
        with self.assertRaises(ValueError):
            self.R.upsert(STORY.replace('## Work assessment', '## Assessment and readiness'), entry, '2026-09-30')

    def test_prompts_follow_one_template_per_session_type_and_host(self):
        reviews = {'claude': "use two fresh read-only Sonnet reviewers for deliver-work's required Standards and Specification reviews.",
                   'codex': "use two fresh read-only gpt-6-luna reviewers at high reasoning for deliver-work's required Standards and Specification reviews."}
        expected = {'One-shot': 'Run as a one-shot session: implement it yourself without worker subagents, and ',
                    'Pair': 'Run as a paired session: delegate the implementation to one',
                    'Orchestrate': 'Run as an orchestrating session: break the work down, delegate',
                    'Investigate first': "Read-only: don't change files, branches or GitHub. Answer this question: Does the fixture question have an answer?"}
        for session, phrase in expected.items():
            entry = recommendation_entry(session, cheaper=False)
            result = self.R.read(self.written(entry))
            self.assertEqual(result['state'], 'recommended', result.get('reason'))
            for host, word in (('claude', 'effort'), ('codex', 'reasoning level')):
                with self.subTest(session=session, host=host):
                    text = result['prompts']['recommended'][host]
                    self.assertEqual(text, self.R.prompt(entry, host, 'recommended', '2026-09-24'), 'The saved prompt round-trips')
                    self.assertIn(phrase, text)
                    self.assertIn(f'take the {word} as stated rather than guessing it', text)
                    self.assertIn("The issue's Execution recommendation (assessed 2026-09-24) is the basis", text)
                    self.assertEqual(text.endswith("If deliver-work isn't available here, say so and stop."), session != 'Investigate first')
                    self.assertEqual(text.endswith("If a skill this investigation needs isn't available here, say so and stop."), session == 'Investigate first')
                    self.assertEqual(text.startswith('Investigate '), session == 'Investigate first')
                    self.assertEqual(reviews[host] in text, session != 'Investigate first', 'Implementing prompts authorize the two reviewers')
                    self.assertNotIn('effort level', text.replace('take the effort as stated', ''))

    def test_apply_rereads_writes_changed_sections_and_reads_back(self):
        store = {'body': STORY}
        writes = []
        reader = lambda repo, number: dict(state='open', body=store['body'])
        def writer(repo, number, body):
            writes.append(body)
            store['body'] = body
        entry = recommendation_entry()
        first = self.R.apply([entry], '2026-09-30', False, reader=reader, writer=writer)
        self.assertEqual((first[0]['outcome'], first[0]['readback'], len(writes)), ('created', 'recommended', 1))
        second = self.R.apply([entry], '2026-09-30', False, reader=reader, writer=writer)
        self.assertEqual((second[0]['outcome'], len(writes)), ('unchanged', 1), 'Unchanged content writes nothing')
        dry = self.R.apply([recommendation_entry(why='new')], '2026-09-30', True, reader=reader, writer=writer)
        self.assertEqual((dry[0]['outcome'], len(writes)), ('updated', 1), 'A dry run writes nothing')
        # A story edited between the read and the write is left alone.
        reads = iter([dict(state='open', body=store['body']), dict(state='open', body=store['body'] + '\nNew owner text.')])
        raced = self.R.apply([recommendation_entry(why='newer')], '2026-09-30', False, reader=lambda *a: next(reads), writer=writer)
        self.assertEqual((raced[0]['outcome'], len(writes)), ('error', 1))

    def test_two_consecutive_builds_produce_identical_html(self):
        with tempfile.TemporaryDirectory(prefix='guide-repeat-') as directory:
            candidate = copy_guide(directory)
            outputs = []
            for _ in range(2):
                result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                outputs.append((candidate / 'outputs/agent-device-work-guides.html').read_bytes())
            self.assertEqual(outputs[0], outputs[1])


class Direction(unittest.TestCase):
    """The dated direction narrative and the computed leverage table (#290)."""

    @staticmethod
    def graph():
        def issue(state='OPEN', *labels):
            return {'state': state, 'stateReason': 'completed' if state == 'CLOSED' else None, 'title': 'x',
                    'labels': [{'name': label} for label in labels]}
        def record(key, state='OPEN'):
            repo = {'H': 'jimmie-potts/agent-device-hub', 'N': 'jimmie-potts/codex-nanoleaf', 'P': 'jimmie-potts/divoom-app-upgrade'}[key[0]]
            return {'number': int(key[1:]), 'state': state, 'repository': {'nameWithOwner': repo}}
        issues = {'H1': issue(), 'H2': issue(), 'H3': issue(), 'H4': issue('OPEN', 'deferred'), 'H5': issue(),
                  'N6': issue(), 'H7': issue('CLOSED'), 'P8': issue(), 'H9': issue('OPEN', 'status:review')}
        dependencies = {
            'H2': [record('H1'), record('H2')],            # direct; a self-referencing record never counts
            'H3': [record('H2'), record('H9')],            # transitive from H1; also names H9
            'H4': [record('H1')],                          # a deferred dependent still counts
            'H5': [record('H4')],                          # reached through the deferred story
            'N6': [record('H3'), record('H5', 'CLOSED')],  # cross-repository chain; a CLOSED record for an open issue is not followed
            'H9': [record('H3')],                          # cycle: H3 <-> H9
            'P8': [record('H7', 'CLOSED'), {'number': 1, 'state': 'OPEN', 'repository': {'nameWithOwner': 'jimmie-potts/agent-skills'}}],
            'H1': [], 'H7': [record('H1')],                # a closed dependent never counts
        }
        return issues, dependencies

    def test_leverage_counts_direct_and_transitive_open_dependents(self):
        from guide_status import leverage
        issues, dependencies = self.graph()
        result = leverage(issues, dependencies)
        self.assertEqual(set(result), {key for key, issue in issues.items() if issue['state'] == 'OPEN'})
        self.assertEqual(result['H1']['direct'], ['H2', 'H4'])
        self.assertEqual(result['H1']['total'], ['H2', 'H3', 'H4', 'H5', 'H9', 'N6'])
        self.assertEqual(result['H4'], dict(direct=['H5'], total=['H5']))
        self.assertEqual(result['H2'], dict(direct=['H3'], total=['H3', 'H9', 'N6']), 'H2 does not depend on itself')
        self.assertEqual(result['H5'], dict(direct=[], total=[]), 'A record marked CLOSED does not count even for an open issue')
        # A cycle counts each story once and never the blocker itself.
        self.assertEqual(result['H3'], dict(direct=['H9', 'N6'], total=['H9', 'N6']))
        self.assertEqual(result['H9'], dict(direct=['H3'], total=['H3', 'N6']))
        # A closed record and an external repository are not counted.
        self.assertEqual(result['P8'], dict(direct=[], total=[]))
        self.assertNotIn('H7', result)

    def test_leverage_rows_rank_by_total_and_mark_decisions_and_review(self):
        import guide_direction as GDIR
        from guide_status import leverage, scheduling_state
        issues, dependencies = self.graph()
        rows = GDIR.leverage_rows(leverage(issues, dependencies), issues,
                                  lambda key: scheduling_state(issues[key], dependencies.get(key, [])),
                                  decisions={'H1'}, owner_later={'H4'})
        self.assertEqual([(row['key'], row['direct'], row['total']) for row in rows],
                         [('H1', 2, 6), ('H2', 1, 3), ('H3', 2, 2), ('H9', 1, 2), ('H4', 1, 1)])
        by_key = {row['key']: row for row in rows}
        self.assertEqual((by_key['H1']['label'], by_key['H1']['marks']), ('Candidate', ['decision, no code']))
        # The blocked state wins over the review label, as everywhere else; the label still marks the row.
        self.assertEqual((by_key['H9']['label'], by_key['H9']['marks']), ('Blocked', ['in review']))
        self.assertEqual((by_key['H4']['label'], by_key['H4']['marks']), ('Later by owner', []))
        self.assertEqual(by_key['H2']['label'], 'Blocked')
        self.assertEqual(by_key['H1']['dependents'], ['H2', 'H3', 'H4', 'H5', 'H9', 'N6'])

    def test_check_names_the_stale_key(self):
        import guide_direction as GDIR
        from unittest import mock
        issues = {'H1': {'state': 'OPEN'}, 'H2': {'state': 'CLOSED'}}
        lists = dict(STANDING=[('s', 't', ['H2'])], BECOMING=[('b', ['H1'])], SEQUENCE=[(['H1'], 'w')], IMPROVEMENTS=[('i', ['H1'])], DELIVERED_SINCE=[])
        with mock.patch.multiple(GDIR, **lists):
            GDIR.check(issues)
            with mock.patch.object(GDIR, 'SEQUENCE', [(['H1', 'H2'], 'w')]):
                with self.assertRaisesRegex(AssertionError, 'SEQUENCE cites H2, which is closed in the snapshot'):
                    GDIR.check(issues)
                with mock.patch.object(GDIR, 'DELIVERED_SINCE', [('2026-09-25', ['H2'], 'landed')]):
                    GDIR.check(issues)
                with mock.patch.object(GDIR, 'DELIVERED_SINCE', [('2026-09-25', ['H1'], 'not yet')]):
                    with self.assertRaisesRegex(AssertionError, 'DELIVERED_SINCE lists H1, which is still open'):
                        GDIR.check(issues)
            for name in ('STANDING', 'IMPROVEMENTS'):
                with mock.patch.object(GDIR, name, [('a', 'b', ['H404'])] if name == 'STANDING' else [('a', ['H404'])]):
                    with self.assertRaisesRegex(AssertionError, f'{name} cites H404, which is not in the snapshot'):
                        GDIR.check(issues)

    def test_an_unknown_cited_key_stops_the_build_before_rendering(self):
        with tempfile.TemporaryDirectory(prefix='guide-direction-unknown-') as directory:
            candidate = copy_guide(directory)
            output = candidate / 'outputs/agent-device-work-guides.html'
            output.unlink()
            module = candidate / 'work/guide_direction.py'
            module.write_text(module.read_text() + "\nSEQUENCE.append((['H99999'], 'fixture'))\n")
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('SEQUENCE cites H99999, which is not in the snapshot', result.stderr)
            self.assertFalse(output.exists(), 'A stale direction text must stop the build before the guide is written')

    def test_a_closed_sequence_key_fails_the_build_until_recorded_as_delivered(self):
        with tempfile.TemporaryDirectory(prefix='guide-direction-closed-') as directory:
            candidate = copy_guide(directory)
            module = candidate / 'work/guide_direction.py'
            issues = json.loads((candidate / 'work/backlogs/agent-device-hub-issues.json').read_text())
            closed = next(row for row in issues if row['number'] == 252)
            self.assertEqual((closed['state'], closed['stateReason']), ('CLOSED', 'completed'), 'H252 is the closed fixture')
            original = module.read_text()
            module.write_text(original + "\nSEQUENCE.append((['H252'], 'fixture'))\n")
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('SEQUENCE cites H252, which is closed in the snapshot; move it to DELIVERED_SINCE', result.stderr)
            module.write_text(original + "\nSEQUENCE.append((['H252'], 'fixture'))\nDELIVERED_SINCE.append(('2026-09-26', ['H252'], 'Fixture landed.'))\n")
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            section = (candidate / 'outputs/agent-device-work-guides.html').read_text().split('id="direction"', 1)[1].split('</details>', 1)[0]
            delivered = section.split('direction-delivered', 1)[1]
            self.assertIn('Fixture landed.', delivered)
            self.assertIn('data-issue="H252"', delivered)
            self.assertIn('data-status="completed"', delivered)

    def test_hostile_direction_text_renders_literally(self):
        hostile = '<img src=x onerror=alert(1)> & "q" [[H241]]'
        with tempfile.TemporaryDirectory(prefix='guide-direction-hostile-') as directory:
            candidate = copy_guide(directory)
            module = candidate / 'work/guide_direction.py'
            module.write_text(module.read_text() + f"\nSTANDING.append(({hostile!r}, {hostile!r}, ['H241']))\nBECOMING.append(({hostile!r}, []))\nSEQUENCE.append((['H20'], {hostile!r}))\nIMPROVEMENTS.append(({hostile!r}, []))\nDELIVERED_SINCE.append(({hostile!r}, ['H252'], {hostile!r}))\n")
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            document = (candidate / 'outputs/agent-device-work-guides.html').read_text()
            self.assertNotIn(hostile, document)
            self.assertEqual(document.count('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; [[H241]]'), 7, 'every prose field of every list is escaped')

    def test_committed_guide_carries_the_direction_section(self):
        import guide_direction as GDIR
        document = (Path(__file__).resolve().parent.parent / 'outputs/agent-device-work-guides.html').read_text()
        self.assertEqual(document.count('<details class="reference direction" id="direction">'), 1)
        section = document.split('id="direction"', 1)[1].split('</details>', 1)[0]
        self.assertIn(f'Direction written {GDIR.AS_OF} against hub <code>{GDIR.REVISION}</code>', section)
        self.assertIn('<table class="leverage">', section)
        for name, keys in GDIR.cited().items():
            for key in keys:
                self.assertIn(f'data-issue="{key}"', section, f'{name} key {key} renders as an issue link')
        self.assertNotIn('data-count', section.split('<div class="guide-body">', 1)[0], 'The section adds nothing to issue counts')


def mark_ideas(candidate, picks):
    """Mark saved open stories as ideas in a guide copy. `picks` maps a key to
    (reason, extends); the story keeps its own topic. Returns the saved topics."""
    import guide_section as GD
    topics = {}
    for prefix, repo in (('H', 'agent-device-hub'), ('N', 'codex-nanoleaf'), ('P', 'divoom-app-upgrade')):
        path = candidate / f'work/backlogs/{repo}-issues.json'
        rows = json.loads(path.read_text())
        for row in rows:
            key = f'{prefix}{row["number"]}'
            if key in picks:
                state = GD.read(row['body'])
                reason, extends = picks[key]
                row['body'], _ = GD.upsert(row['body'], dict(topic=state['topic'], note=state['note'], workaround=state['workaround'],
                                                             highlight=dict(kind='idea', reason=reason), extends=extends))
                topics[key] = state['topic']
        path.write_text(json.dumps(rows))
    return topics


def marked_ideas(candidate):
    """Open stories a guide copy already marks as ideas, keyed to their topics."""
    import guide_section as GD
    from guide_paths import ALIASES
    topics = {}
    for prefix, repo in (('H', 'agent-device-hub'), ('N', 'codex-nanoleaf'), ('P', 'divoom-app-upgrade')):
        for row in json.loads((candidate / f'work/backlogs/{repo}-issues.json').read_text()):
            if row['state'] != 'OPEN':
                continue
            state = GD.read(row['body'])
            if state['state'] == 'assigned' and (state.get('highlight') or {}).get('kind') == 'idea':
                topics[f'{prefix}{row["number"]}'] = ALIASES.get(state['topic'], state['topic'])
    return topics


def build(candidate):
    return subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')], capture_output=True, text=True)


class Ideas(unittest.TestCase):
    """The idea highlight, its Extends keys, the Ideas section and the derived Later ideas (#308)."""

    def setUp(self):
        import guide_section
        self.G = guide_section
        self.topics = frozenset({'work-guide', 'shared-codex'})

    def test_an_idea_highlight_with_extends_parses_and_renders(self):
        entry = dict(topic='work-guide', highlight=dict(kind='idea', reason='Recent work made this cheap.'), extends=['H67', 'N47'])
        new, outcome = self.G.upsert('## Outcome\n\nFixture.\n', entry, topics=self.topics)
        self.assertEqual(outcome, 'created')
        self.assertIn('**Highlight:** idea, Recent work made this cheap.\n**Extends:** H67, N47', new)
        self.assertEqual(self.G.read(new, self.topics, keys={'H67', 'N47'}),
                         dict(state='assigned', topic='work-guide', note=None, workaround=None,
                              highlight=dict(kind='idea', reason='Recent work made this cheap.'), extends=['H67', 'N47']))
        self.assertEqual(self.G.upsert(new, entry, topics=self.topics), (new, 'unchanged'))
        # Spacing around the commas is free; the key form is not.
        spaced = self.G.read('## Guide\n\n**Topic:** work-guide\n**Highlight:** idea, r\n**Extends:** H67 ,N47\n', self.topics)
        self.assertEqual(spaced['extends'], ['H67', 'N47'])

    def test_extends_without_an_idea_unknown_or_malformed_is_unreadable(self):
        base = '## Guide\n\n**Topic:** work-guide\n'
        cases = {
            'without a highlight': base + '**Extends:** H67\n',
            'beside next step': base + '**Highlight:** next step, r\n**Extends:** H67\n',
            'lowercase key': base + '**Highlight:** idea, r\n**Extends:** h67\n',
            'unknown prefix': base + '**Highlight:** idea, r\n**Extends:** X67\n',
            'number zero': base + '**Highlight:** idea, r\n**Extends:** H0\n',
            'semicolon': base + '**Highlight:** idea, r\n**Extends:** H67; N47\n',
            'issue URL': base + '**Highlight:** idea, r\n**Extends:** #67\n',
            'trailing comma': base + '**Highlight:** idea, r\n**Extends:** H67,\n',
            'duplicate': base + '**Highlight:** idea, r\n**Extends:** H67, H67\n',
            'idea without reason': base + '**Highlight:** idea\n',
        }
        for name, body in cases.items():
            with self.subTest(name):
                self.assertEqual(self.G.read(body, self.topics)['state'], 'invalid')
        unknown = self.G.read(base + '**Highlight:** idea, r\n**Extends:** H67, H99999\n', self.topics, keys={'H67'})
        self.assertEqual(unknown['state'], 'invalid')
        self.assertIn('H99999', unknown['reason'])
        with self.assertRaises(ValueError):
            self.G.upsert('## Outcome\n\nFixture.\n', dict(topic='work-guide', highlight=dict(kind='later', reason='r'), extends=['H67']), topics=self.topics)

    def test_the_build_fails_naming_a_story_with_an_unreadable_idea(self):
        cases = {'extends without idea': ('**Extends:** H67', None), 'unknown key': ('**Highlight:** idea, r\n**Extends:** H99999', 'H99999'),
                 'malformed line': ('**Highlight:** idea, r\n**Extends:** H67 and N47', None)}
        for name, (lines, named) in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory(prefix='guide-idea-invalid-') as directory:
                candidate = copy_guide(directory)
                path = candidate / 'work/backlogs/agent-device-hub-issues.json'
                rows = json.loads(path.read_text())
                row = next(row for row in rows if row['number'] == 25)
                self.assertEqual(row['state'], 'OPEN')
                row['body'] = re.sub(r'(\n## Guide\n\n\*\*Topic:\*\* [^\n]+)', lambda match: match.group(1) + '\n' + lines, row['body'])
                path.write_text(json.dumps(rows))
                result = build(candidate)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('H25 (', result.stderr)
                if named:
                    self.assertIn(named, result.stderr)

    def test_a_sequence_story_marked_as_an_idea_fails_the_direction_check(self):
        import guide_direction as GDIR
        from unittest import mock
        issues = {'H1': {'state': 'OPEN'}, 'H2': {'state': 'OPEN'}}
        lists = dict(STANDING=[], BECOMING=[], SEQUENCE=[(['H1'], 'w')], IMPROVEMENTS=[], DELIVERED_SINCE=[])
        with mock.patch.multiple(GDIR, **lists):
            GDIR.check(issues, {'H2'})
            with self.assertRaisesRegex(AssertionError, 'SEQUENCE cites H1, whose story carries an idea highlight'):
                GDIR.check(issues, {'H1', 'H2'})
        key = GDIR.cited()['SEQUENCE'][2]
        with tempfile.TemporaryDirectory(prefix='guide-idea-sequence-') as directory:
            candidate = copy_guide(directory)
            output = candidate / 'outputs/agent-device-work-guides.html'
            output.unlink()
            mark_ideas(candidate, {key: ('Fixture.', [])})
            result = build(candidate)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(f'SEQUENCE cites {key}, whose story carries an idea highlight', result.stderr)
            self.assertFalse(output.exists(), 'The check stops the build before the guide is written')

    def test_the_section_groups_ideas_by_topic_and_direction_derives_later_ideas(self):
        import guide_direction as GDIR
        from guide_paths import TOPICS
        sequence = set(GDIR.cited()['SEQUENCE'])
        hostile = '<img src=x onerror=alert(1)> & "q" [[H1]]'
        picks = {'N47': ('Combined layout as the first shared pool.', []), 'H11': (hostile, ['N47', 'H252']),
                 'H39': ('Song-change lighting.', ['H175']), 'P11': ('A Pixoo idea.', []), 'H254': ('A second skin.', ['H85'])}
        self.assertFalse(sequence & set(picks))
        with tempfile.TemporaryDirectory(prefix='guide-ideas-') as directory:
            candidate = copy_guide(directory)
            topics = mark_ideas(candidate, picks)
            self.assertEqual(set(topics), set(picks))
            # Stories the snapshot already marks as ideas stay in the section beside the fixture picks.
            topics = {**marked_ideas(candidate), **topics}
            outputs = []
            for _ in range(2):
                result = build(candidate)
                self.assertEqual(result.returncode, 0, result.stderr)
                outputs.append((candidate / 'outputs/agent-device-work-guides.html').read_text())
            self.assertEqual(outputs[0], outputs[1], 'Two consecutive builds are identical')
            document = outputs[0]
        rank = {topic: index for index, (topic, *_) in enumerate(TOPICS)}
        expected = sorted(topics, key=lambda key: (rank[topics[key]], key[0], int(key[1:])))
        section = document.split('<details class="reference ideas" id="ideas">', 1)[1].split('</details>', 1)[0]
        self.assertEqual(re.findall(r'<li class="idea" data-key="([HNP]\d+)"', section), expected)
        self.assertEqual(re.findall(r'<section class="ideas-topic" data-topic="([^"]+)"', section),
                         sorted(set(topics.values()), key=rank.get), 'One group per topic, in guide order')
        self.assertIn(f'{len(topics)} marked', section)
        self.assertIn('ideas-empty" hidden', section)
        row = section.split('data-key="H11"', 1)[1].split('</li>', 1)[0]
        self.assertIn('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; [[H1]]', row)
        self.assertNotIn(hostile, document)
        self.assertEqual(re.findall(r'data-issue="([HNP]\d+)"', row.split('idea-extends', 1)[1]), ['N47', 'H252'], 'Extends keys render as issue links')
        self.assertIn('data-status="completed"', row.split('idea-extends', 1)[1], 'A closed Extends key keeps its status')
        self.assertIn('data-state="deferred">Deferred<', row, 'The scheduling state is shown, never promoted')
        later = document.split('id="direction-ideas"', 1)[1].split('</section>', 1)[0]
        self.assertEqual(re.findall(r'<li data-key="([HNP]\d+)"', later), expected, 'Later ideas equals the marked set, in the same order')
        self.assertIn('href="#ideas"', later)
        self.assertIn(f'<a href="#ideas" data-section="ideas"><span class="nav-number">I</span><span>Ideas</span><span class="nav-count" data-ideas-count aria-label="{len(topics)} marked ideas">{len(topics):02}</span></a>', document)
        meta = json.loads(document.split('<script id="snapshot-data" type="application/json">', 1)[1].split('</script>', 1)[0])
        self.assertEqual(meta['ideas'], dict(count=len(topics), keys=expected, countedInIssueTotals=False))
        self.assertNotIn('data-count', section.split('<div class="guide-body">', 1)[0], 'The section adds nothing to issue counts')

    def test_a_refresh_keeps_every_closed_extends_target(self):
        import refresh_backlogs
        def story(number, body, state='OPEN'):
            return {'number': number, 'state': state, 'body': body}
        idea = '## Guide\n\n**Topic:** work-guide\n**Highlight:** idea, r\n**Extends:** {}\n'
        saved = {'agent-device-hub': [story(292, idea.format('H291, N92, H67')), story(67, '## Guide\n\n**Topic:** desktop-controls\n'),
                                      story(10, idea.format('H404'), state='CLOSED'), story(11, '## Guide\n\n**Topic:** nope\n**Extends:** H405\n')],
                 'codex-nanoleaf': [story(158, idea.format('H292, N44'))],
                 'divoom-app-upgrade': [story(91, idea.format('H291, P1'))]}
        # Held keys are not fetched again; a closed story's or an unreadable section's Extends is not followed.
        self.assertEqual(refresh_backlogs.extends_targets(saved),
                         {'agent-device-hub': [291], 'codex-nanoleaf': [44, 92], 'divoom-app-upgrade': [1]})

    def test_an_extends_key_naming_a_pull_request_stops_the_refresh_before_any_write(self):
        import refresh_backlogs
        from unittest import mock
        with tempfile.TemporaryDirectory(prefix='guide-refresh-extends-') as directory:
            dest = Path(directory)
            idea = '## Guide\n\n**Topic:** work-guide\n**Highlight:** idea, r\n**Extends:** H291, N7\n'
            files = {'agent-device-hub': [{'number': 292, 'state': 'OPEN', 'body': idea}], 'codex-nanoleaf': [], 'divoom-app-upgrade': []}
            for repo, rows in files.items():
                (dest / f'{repo}-issues.json').write_text(json.dumps(rows))
            before = {path.name: path.read_bytes() for path in dest.iterdir()}
            closed = dict(number=291, state='closed', state_reason='completed', title='t', body='', html_url='u', created_at='c', updated_at='u', closed_at='c', labels=[], milestone=None, comments=0)
            pull = dict(closed, number=7, pull_request={'url': 'x'})
            reads = {'repos/jimmie-potts/agent-device-hub/issues/291': closed, 'repos/jimmie-potts/codex-nanoleaf/issues/7': pull}
            with mock.patch.object(refresh_backlogs, 'DEST', dest), mock.patch.object(refresh_backlogs, 'api', reads.__getitem__):
                with self.assertRaisesRegex(RuntimeError, 'names N7, which is a pull request'):
                    refresh_backlogs.keep_extends_targets({repo: {'directReads': []} for repo in files})
            self.assertEqual({path.name: path.read_bytes() for path in dest.iterdir()}, before, 'Nothing is rewritten')

    def test_the_committed_guide_has_the_section_and_no_curated_ideas(self):
        import guide_direction as GDIR
        self.assertFalse(hasattr(GDIR, 'IDEAS'), 'The hand-written Later ideas list is retired')
        document = (Path(__file__).resolve().parent.parent / 'outputs/agent-device-work-guides.html').read_text()
        self.assertEqual(document.count('<details class="reference ideas" id="ideas">'), 1)
        self.assertLess(document.index('id="direction"'), document.index('id="ideas"'), 'Ideas follows Direction')


def load_tests(loader, tests, pattern):
    for module in ('test_retired', 'test_refresh', 'test_backlog_refresh', 'test_nightly_inputs',
                   'test_nightly_publish', 'test_nightly_run', 'test_maintenance_diagnostics', 'test_nightly_validation', 'test_unplaced'):
        tests.addTests(loader.loadTestsFromName(module))
    return tests


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--direction-result', type=Path)
    args, remaining = parser.parse_known_args()
    if args.direction_result:
        if remaining:
            parser.error('Direction diagnostics runs the complete maintenance suite')
        from maintenance_diagnostics import run_suite
        suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
        sys.exit(run_suite(suite, args.direction_result))
    unittest.main()
