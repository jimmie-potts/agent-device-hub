"""Recommendation parsing and upsert regressions, extracted from the retired Guide."""
from pathlib import Path
import sys
import re
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "recommendations"))

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

    def test_cheaper_start_can_belong_to_one_host_only(self):
        for host, other in [('claude', 'codex'), ('codex', 'claude')]:
            with self.subTest(host=host):
                entry = recommendation_entry()
                del entry['cheaper']['hosts'][other]
                written = self.written(entry)
                result = self.R.read(written)
                self.assertEqual(result['state'], 'recommended')
                self.assertEqual(set(result['prompts']['cheaper']), {host})
                self.assertIn(f"{self.R.HOSTS[other]}: none.", result['cheaper'])
                self.assertNotIn(f"**Cheaper prompt ({self.R.HOSTS[other]}):**", written)
                self.assertEqual(self.R.upsert(written, entry, '2026-09-30'), (written, 'unchanged'))
                malformed = written.replace(f"{self.R.HOSTS[other]}: none.", '')
                self.assertEqual(self.R.read(malformed)['state'], 'unavailable')
                contradictory = written.replace('**Cheaper start:** ', f'**Cheaper start:** {self.R.HOSTS[host]}: none. ')
                self.assertEqual(self.R.read(contradictory)['state'], 'unavailable')
        for hosts in ({}, {'unknown': {}}):
            entry = recommendation_entry()
            entry['cheaper']['hosts'] = hosts
            with self.assertRaisesRegex(ValueError, 'cheaper hosts'):
                self.written(entry)

    def test_work_surface_is_optional_validated_and_badged(self):
        unmarked = self.R.read(self.written())
        self.assertIsNone(unmarked['work_surface'], 'A story without the line is not classified')
        for value in self.R.WORK_SURFACES:
            with self.subTest(value=value):
                marked = self.R.read(self.written(recommendation_entry(work_surface=value)))
                self.assertEqual(marked['work_surface'], value)
                stale = self.R.read(self.written(recommendation_entry(work_surface=value)).replace('A fixture story.', 'A changed story.'))
                self.assertEqual(stale['state'], 'stale')
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

    def test_freshness_and_missing_sections(self):
        body = self.written()
        self.assertEqual(self.R.read(STORY)['state'], 'unassessed')
        self.assertEqual(self.R.read(STORY)['label'], 'Not yet assessed')
        # Whitespace and line endings are normalized; story text is not.
        self.assertEqual(self.R.read(body.replace('\n', '\r\n') + '\n\n')['state'], 'recommended')
        edited = self.R.read(body.replace('A fixture story.', 'A changed story.'))
        self.assertEqual(edited['state'], 'stale')
        self.assertEqual(edited['label'], 'Needs reassessment (story text changed after 2026-09-24)')
        # Prompt text sits inside the section and outside the fingerprint.
        hand_edit = body.replace('Open the PR for part A only.', 'Open the PR for part A only, please.')
        self.assertEqual(self.R.read(hand_edit)['state'], 'recommended')
        self.assertIn('please', self.R.read(hand_edit)['prompts']['cheaper']['claude'])

    def test_guide_placement_does_not_stale_a_recommendation(self):
        body = self.written()
        # A Guide section added or edited after assessment is placement metadata, not scope.
        placed = body + '\n## Guide\n\n**Topic:** work-guide\n**Note:** Read this first.\n'
        moved = placed.replace('work-guide', 'devices').replace('Read this first.', 'Now read this elsewhere.')
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
            for host in ('claude', 'codex'):
                with self.subTest(session=session, host=host):
                    text = result['prompts']['recommended'][host]
                    self.assertEqual(text, self.R.prompt(entry, host, 'recommended', '2026-09-24'), 'The saved prompt round-trips')
                    self.assertIn(phrase, text)
                    self.assertIn('my declared launch settings for each role it names', text)
                    self.assertIn('requested, declared and independently observed settings separately', text)
                    self.assertIn('unavailable runtime observation stays unknown', text)
                    self.assertIn('observed required-setting mismatch', text)
                    self.assertIn('unmet explicit verified-identity requirement', text)
                    self.assertNotIn('State the model you are running', text)
                    self.assertIn("The issue's Execution recommendation (assessed 2026-09-24) is the basis", text)
                    self.assertEqual(text.endswith("If deliver-work isn't available here, say so and stop."), session != 'Investigate first')
                    self.assertEqual(text.endswith("If a skill this investigation needs isn't available here, say so and stop."), session == 'Investigate first')
                    self.assertEqual(text.startswith('Investigate '), session == 'Investigate first')
                    self.assertEqual(reviews[host] in text, session != 'Investigate first', 'Implementing prompts authorize the two reviewers')
                    self.assertNotIn('effort level', text.replace('take the effort as stated', ''))

    def test_declared_prompts_roundtrip_recommended_and_cheaper_for_every_session(self):
        for session in self.R.SESSION_NOUN:
            entry = recommendation_entry(session)
            for host in ('claude', 'codex'):
                cheaper = entry['cheaper']['hosts'][host]
                # Exercise the same session contract at either starting level.
                entry['cheaper']['hosts'][host] = dict(
                    entry['hosts'][host], model=cheaper['model'], thinking=cheaper['thinking'])
            written = self.written(entry)
            result = self.R.read(written)
            self.assertEqual(result['state'], 'recommended', result.get('reason'))
            for start in ('recommended', 'cheaper'):
                for host in ('claude', 'codex'):
                    with self.subTest(session=session, start=start, host=host):
                        text = result['prompts'][start][host]
                        self.assertEqual(text, self.R.prompt(entry, host, start, '2026-09-24'))
                        self.assertIn('my declared launch settings for each role it names', text)
                        self.assertIn('unavailable runtime observation stays unknown', text)
                        self.assertIn('observed required-setting mismatch', text)
                        self.assertIn('unmet explicit verified-identity requirement', text)
                        self.assertNotIn('State the model you are running', text)
                        self.assertEqual("Read-only: don't change files, branches or GitHub." in text,
                                         session == 'Investigate first')
                        self.assertEqual('required Standards and Specification reviews' in text,
                                         session != 'Investigate first')
            self.assertEqual(self.R.upsert(written, entry, '2026-10-02'), (written, 'unchanged'))

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


if __name__ == "__main__":
    unittest.main()
