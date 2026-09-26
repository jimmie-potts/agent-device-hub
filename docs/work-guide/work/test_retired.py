"""Retired terminology remains visible without silently editing story text."""
import unittest


class RetiredTerms(unittest.TestCase):
    def test_open_story_warning_names_story_and_retirement(self):
        from guide_retired import scan
        issues = {'H1': {'state': 'OPEN', 'body': 'Test PAUSE MOTION.'},
                  'H264': {'state': 'CLOSED', 'body': ''}}
        warnings, errors = scan(issues, [('Pause motion', 'H264', '2026-09-25', 'Removed control')])
        self.assertEqual(warnings, ['H1: story cites retired term Pause motion (retired by H264)'])
        self.assertEqual(errors, [])

    def test_guide_note_fails_and_closed_story_is_ignored(self):
        from guide_retired import scan
        entries = [('PowerShell', 'N131', '2026-09-25', 'Retired runtime')]
        issues = {'N1': {'state': 'OPEN', 'body': '## Guide\n\n**Topic:** work-guide\n**Note:** Use PowerShell\n'},
                  'N131': {'state': 'CLOSED', 'body': 'PowerShell'}}
        warnings, errors = scan(issues, entries)
        self.assertEqual(len(warnings), 1)
        self.assertEqual(errors, ['N1: Guide note cites retired term PowerShell (retired by N131)'])

    def test_missing_retirement_fails_even_without_matches(self):
        from guide_retired import scan
        warnings, errors = scan({}, [('tray.ps1', 'N131', '2026-09-25', 'Retired')])
        self.assertEqual(warnings, [])
        self.assertEqual(errors, ['Retired term tray.ps1 cites N131, which is not in the snapshot'])

    def test_no_match_is_silent_and_scan_is_deterministic(self):
        from guide_retired import scan
        entries = [('Pause motion', 'H264', '2026-09-25', 'Removed')]
        issues = {'H1': {'state': 'OPEN', 'body': '<script>motion</script>'},
                  'H264': {'state': 'CLOSED', 'body': 'Pause motion'}}
        self.assertEqual(scan(issues, entries), ([], []))
        self.assertEqual(scan(issues, entries), scan(issues, entries))


if __name__ == '__main__':
    unittest.main()
