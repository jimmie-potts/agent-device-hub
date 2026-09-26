"""The native prerequisite inventory must include every open issue exactly once."""
import unittest
from pathlib import Path
import json
import tempfile
from unittest import mock

import guide_direction
import guide_paths
import guide_section
import refresh_backlogs


def issue(number):
    return {'number': number, 'blockedBy': {
        'totalCount': 1, 'pageInfo': {'hasNextPage': False},
        'nodes': [{'number': 7, 'state': 'OPEN',
                   'repository': {'nameWithOwner': 'jimmie-potts/codex-nanoleaf'}}],
    }}


def page(nodes, total, more=False, cursor=None):
    return {'data': {'repository': {'issues': {
        'totalCount': total,
        'pageInfo': {'hasNextPage': more, 'endCursor': cursor},
        'nodes': nodes,
    }}}}


class OpenIssueInventory(unittest.TestCase):
    def test_two_pages_preserve_native_prerequisites_and_complete_shape(self):
        first = [issue(number) for number in range(1, 101)]
        last = [issue(101)]
        reader = mock.Mock(side_effect=[page(first, 101, True, 'page-one'),
                                        page(last, 101)])

        result = refresh_backlogs.open_issue_inventory('agent-device-hub', reader=reader)

        self.assertEqual(result, {'totalCount': 101,
                                 'pageInfo': {'hasNextPage': False},
                                 'nodes': first + last})
        queries = [call.args[0] for call in reader.call_args_list]
        self.assertEqual(len(queries), 2)
        self.assertIn('name:"agent-device-hub"', queries[0])
        self.assertIn('issues(first:100, states:OPEN)', queries[0])
        self.assertIn('blockedBy(first:100)', queries[0])
        self.assertIn('after:"page-one"', queries[1])

    def test_rejects_duplicate_issue_across_pages_even_when_count_matches(self):
        reader = mock.Mock(side_effect=[page([issue(1)], 2, True, 'page-one'),
                                        page([issue(1)], 2)])
        with self.assertRaisesRegex(AssertionError, 'duplicate'):
            refresh_backlogs.open_issue_inventory('agent-device-hub', reader=reader)

    def test_rejects_count_mismatch_in_terminal_page(self):
        reader = mock.Mock(return_value=page([issue(1)], 2))
        with self.assertRaisesRegex(AssertionError, 'count'):
            refresh_backlogs.open_issue_inventory('agent-device-hub', reader=reader)

    def test_rejects_total_changing_between_pages(self):
        reader = mock.Mock(side_effect=[page([issue(1)], 3, True, 'page-one'),
                                        page([issue(2)], 2)])
        with self.assertRaisesRegex(AssertionError, 'total changed'):
            refresh_backlogs.open_issue_inventory('agent-device-hub', reader=reader)

    def test_rejects_missing_or_stalled_cursor(self):
        for cursor in (None, 'page-one'):
            with self.subTest(cursor=cursor):
                reader = mock.Mock(side_effect=[page([issue(1)], 3, True, 'page-one'),
                                                page([issue(2)], 3, True, cursor)])
                with self.assertRaisesRegex(AssertionError, 'did not advance'):
                    refresh_backlogs.open_issue_inventory('agent-device-hub', reader=reader)
                self.assertEqual(reader.call_count, 2)

    def test_empty_inventory_is_complete(self):
        reader = mock.Mock(return_value=page([], 0))
        self.assertEqual(refresh_backlogs.open_issue_inventory('agent-device-hub', reader=reader),
                         {'totalCount': 0, 'pageInfo': {'hasNextPage': False}, 'nodes': []})

    def test_graphql_errors_never_produce_an_inventory(self):
        reader = mock.Mock(return_value={'errors': [{'message': 'API unavailable'}]})
        with self.assertRaisesRegex(AssertionError, 'API unavailable'):
            refresh_backlogs.open_issue_inventory('agent-device-hub', reader=reader)


class AuthoredReferences(unittest.TestCase):
    @staticmethod
    def closed(number):
        return dict(number=number, state='closed', state_reason='completed',
                    title=f'Closed story {number}', body='', html_url=f'https://example.test/{number}',
                    created_at='2026-01-01T00:00:00Z', updated_at='2026-09-26T00:00:00Z',
                    closed_at='2026-09-26T00:00:00Z', labels=[], milestone=None, comments=0)

    def test_refresh_retains_closed_direction_story_omitted_by_open_query(self):
        with tempfile.TemporaryDirectory(prefix='guide-reference-') as directory:
            dest = Path(directory)
            for repo in refresh_backlogs.REPOS:
                (dest / f'{repo}-issues.json').write_text('[]\n')
            reads = mock.Mock(side_effect=lambda endpoint: self.closed(int(endpoint.rsplit('/', 1)[1])))
            references = {'SEQUENCE': ['N81'], 'DELIVERED_SINCE': []}
            with mock.patch.object(refresh_backlogs, 'DEST', dest), \
                 mock.patch.object(refresh_backlogs, 'pages', return_value=([], [0])), \
                 mock.patch.object(refresh_backlogs, 'api', reads), \
                 mock.patch.object(guide_direction, 'cited', return_value=references), \
                 mock.patch.object(guide_paths, 'PATHS', {}):
                repo, receipt = refresh_backlogs.refresh_repo('codex-nanoleaf')
                before = json.loads((dest / f'{repo}-issues.json').read_text())
                self.assertNotIn(81, [row['number'] for row in before])
                refresh_backlogs.keep_guide_references({repo: receipt})
                after = json.loads((dest / f'{repo}-issues.json').read_text())
                retained = next(row for row in after if row['number'] == 81)
                self.assertEqual(retained, refresh_backlogs.normalize(self.closed(81)))
                reads.assert_any_call('repos/jimmie-potts/codex-nanoleaf/issues/81')
                self.assertEqual(receipt['openIssues'], 0)
                self.assertIn('#81 [CLOSED]', (dest / f'{repo}-digest.txt').read_text())
                with self.assertRaisesRegex(AssertionError, 'SEQUENCE cites N81, which is closed'):
                    guide_direction.check({'N81': retained})

    def test_topic_and_rendered_story_references_are_retained_without_unrelated_body_links(self):
        body = ('Unrendered narrative [[H999]].\n\n## Guide\n\n**Topic:** work-guide\n'
                '**Note:** Reuse [[N82]].\n**Workaround:** Follow [[P83]].\n'
                '**Highlight:** next step, Delivered by [[H84]].\n')
        saved = {'agent-device-hub': [dict(number=1, state='OPEN', body=body),
                                     dict(number=2, state='CLOSED', body=body.replace('N82', 'N999'))],
                 'codex-nanoleaf': [], 'divoom-app-upgrade': []}
        with mock.patch.object(guide_direction, 'cited', return_value={}), \
             mock.patch.object(guide_paths, 'PATHS', {'work-guide': ('Outcome [[N85]]', 'Next [[P86]]', ['H87', 'H1'])}):
            self.assertEqual(refresh_backlogs.authored_targets(saved),
                             {'agent-device-hub': [84, 87], 'codex-nanoleaf': [82, 85],
                              'divoom-app-upgrade': [83, 86]})

    def test_failed_or_pull_request_reference_keeps_all_saved_files_and_receipts(self):
        for failure in ('unavailable', 'pull_request'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(prefix='guide-reference-') as directory:
                dest = Path(directory)
                receipts = {repo: {'directReads': []} for repo in refresh_backlogs.REPOS}
                for repo in refresh_backlogs.REPOS:
                    (dest / f'{repo}-issues.json').write_text('[]\n')
                    (dest / f'{repo}-digest.txt').write_text('Previous digest\n')
                before = {path.name: path.read_bytes() for path in dest.iterdir()}
                def read(endpoint):
                    if endpoint.endswith('/81'):
                        return self.closed(81)
                    if failure == 'unavailable':
                        raise RuntimeError('HTTP 503')
                    return dict(self.closed(82), pull_request={'url': 'https://example.test/pull/82'})
                with mock.patch.object(refresh_backlogs, 'DEST', dest), \
                     mock.patch.object(refresh_backlogs, 'api', side_effect=read), \
                     mock.patch.object(guide_direction, 'cited', return_value={'SEQUENCE': ['N81', 'P82']}), \
                     mock.patch.object(guide_paths, 'PATHS', {}):
                    with self.assertRaisesRegex(RuntimeError, 'names P82'):
                        refresh_backlogs.keep_guide_references(receipts)
                self.assertEqual({path.name: path.read_bytes() for path in dest.iterdir()}, before)
                self.assertTrue(all(not receipt['directReads'] for receipt in receipts.values()))


if __name__ == '__main__':
    unittest.main()
