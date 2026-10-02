"""Batch adapter for the existing fence-aware story and recommendation parsers."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work'))
from story_sections import _sections, _headings
from recommendations import read

HEADINGS = {
    'outcome': ['Outcome and real setup', 'Outcome and scope'],
    'implementation': ['Smallest useful implementation'],
    'protections': ['Behavior and protections to preserve'],
    'acceptance': ['Observable acceptance and planned evidence', 'Acceptance criteria'],
    'deferrals': ['Meaningful deferrals'],
}

def parse(issue):
    lines = (issue['body'] or '').split('\n')
    headings = {i: text for i, level, text in _headings(lines) if level == 2}
    story = {}
    for key, names in HEADINGS.items():
        spans = _sections(lines, names)
        text = '\n'.join(lines[spans[0][0]+1:spans[0][1]]).strip() if len(spans) == 1 else None
        state = 'present' if text else 'missing' if not spans else 'unsupported'
        story[key] = dict(state=state, heading=headings[spans[0][0]] if text else None,
            text=text or None, source=issue['url'], parser='story-sections/1',
            reason=None if text else 'Missing section' if not spans else 'Duplicate or empty section')
    recommendation = read(issue['body'] or '')
    state = recommendation['state']
    planning = [] if state == 'unassessed' else [dict(kind='execution',
        state='current' if state == 'recommended' else 'stale' if state == 'stale' else 'unsupported', source=issue['url'],
        parser='recommendations/1', sourceUpdatedAt=issue['updatedAt'])]
    return dict(story=story, planning=planning, recommendation=recommendation)

if __name__ == '__main__':
    print(json.dumps([parse(issue) for issue in json.load(sys.stdin)]))
