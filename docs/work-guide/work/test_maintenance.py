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
            result = subprocess.run([sys.executable, str(build)], capture_output=True, text=True)
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
        source = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory(prefix='guide-blocker-') as directory:
            candidate = copy_guide(directory)
            path = candidate / 'work/backlogs/hub-native-deps.json'
            native = json.loads(path.read_text())
            issue = next(row for row in native['data']['repository']['issues']['nodes'] if row['number'] == 222)
            issue['blockedBy']['nodes'].append({
                'number': 11, 'state': 'OPEN',
                'repository': {'nameWithOwner': 'jimmie-potts/divoom-app-upgrade'}})
            issue['blockedBy']['totalCount'] += 1
            path.write_text(json.dumps(native))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            document = (candidate / 'outputs/agent-device-work-guides.html').read_text()
            baseline = (source / 'outputs/agent-device-work-guides.html').read_text()
            self.assertIn('data-key="H222"', baseline.split('id="next-steps"', 1)[1].split('</section>', 1)[0])
            next_section = document.split('id="next-steps"', 1)[1].split('</section>', 1)[0]
            self.assertNotIn('data-key="H222"', next_section)
            self.assertNotIn('data-key="P61"', next_section)
            blockers = document.split('id="work-blockers"', 1)[1].split('</section>', 1)[0]
            self.assertIn('data-key="H222"', blockers)
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
        for attrs, text in links.links['N47']:
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
            candidate = copy_guide(directory)
            # An external reference must not inflate the three-repository totals.
            coverage['development-workflow'].append('X33')
            (candidate / 'work/backlogs/guide-coverage.json').write_text(json.dumps(coverage))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Coverage mismatch', result.stderr)

    def test_guide_tracks_must_cover_their_guide(self):
        with tempfile.TemporaryDirectory(prefix='guide-tracks-') as directory:
            candidate = copy_guide(directory)
            # A row left out of every track would otherwise vanish from its guide.
            paths = candidate / 'work/guide_paths.py'
            text = paths.read_text()
            self.assertEqual(text.count("'P61']"), 1)
            paths.write_text(text.replace("'P61']", ']'))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Tracks must cover development-workflow exactly once', result.stderr)

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

    def test_insufficient_story_names_what_is_missing(self):
        entry = dict(repo='agent-device-hub', number=902, status='insufficient', missing='the owner has not chosen the bulbs.',
                     reassess='the owner records the bulbs.', assessed=dict(date='2026-09-24', policy='agent-skills@3e009e6', evidence='fixture'))
        result = self.R.read(self.written(entry))
        self.assertEqual((result['state'], result['label']), ('insufficient', 'Insufficient information'))
        self.assertEqual(result['missing'], 'the owner has not chosen the bulbs.')
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


if __name__ == '__main__':
    unittest.main()
