"""The native prerequisite inventory must include every open issue exactly once."""
import unittest
from unittest import mock

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


if __name__ == '__main__':
    unittest.main()
