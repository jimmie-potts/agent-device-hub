"""Build closed state schemas from lifecycle 1.0's existing identity definitions."""
import json
from pathlib import Path
import sys
from copy import deepcopy

ROOT = Path(__file__).resolve().parents[1]
LIFECYCLE = json.loads((ROOT / 'packages/lifecycle-contracts/schemas/lifecycle-v1.schema.json').read_text())


def obj(properties, optional=()):
    return {'type': 'object', 'additionalProperties': False, 'properties': properties,
            'required': [key for key in properties if key not in optional]}


def array(items, maximum, unique=False):
    return {'type': 'array', 'items': items, 'maxItems': maximum, **({'uniqueItems': True} if unique else {})}


def ref(name):
    return {'$ref': '#/$defs/' + name}


def enum(*values):
    return {'enum': list(values)}


def schemas():
    definitions = dict(LIFECYCLE['$defs'])
    definitions.update({
        'parent': LIFECYCLE['properties']['parent'],
        'ordering': LIFECYCLE['properties']['ordering'],
        'hash': {'type': 'string', 'pattern': r'^[a-f0-9]{64}(?![\s\S])'},
        'consumer': obj({'id': ref('id'), 'clearOnNewTurn': {'type': 'boolean'}}),
        'attention': obj({'id': ref('knownId'), 'kind': enum('question', 'input', 'approval'), 'turn': ref('knownId')}),
        'notice': obj({'id': ref('hash'), 'kind': {'const': 'turn-ended'}, 'turn': ref('knownId'),
                       'acknowledgedBy': array(ref('id'), 16, True)}),
        'unavailable': next(item for item in LIFECYCLE['properties']['event']['oneOf']
                            if item['properties']['kind'].get('const') == 'evidence.unavailable'),
        'seen': obj({'key': ref('hash'), 'content': ref('hash')}),
        'watermark': obj({'dimension': {'type': 'string', 'minLength': 1, 'maxLength': 160, 'pattern': r'^[A-Za-z0-9_.:-]+(?![\s\S])'},
                          'epoch': ref('id'), 'sequence': ref('integer')}),
        'journal': obj({'revision': ref('integer'), 'atMs': ref('integer'), 'sessionKey': ref('hash'),
                        'kind': enum('session.started', 'turn.started', 'activity.observed', 'turn.ended',
                                     'turn.interrupted', 'runtime.ended', 'question.continuing', 'attention.input',
                                     'attention.approval', 'attention.resolved', 'notice.acknowledged',
                                     'read.observed', 'evidence.unavailable', 'label'),
                        'outcome': enum('applied', 'ambiguous')})})
    visible = {
        'identity': ref('identity'), 'turn': ref('knownId'), 'parent': ref('parent'),
        'label': LIFECYCLE['properties']['label']['properties']['value'], 'projectId': ref('id'),
        'activity': enum('unknown', 'active', 'idle', 'interrupted', 'ended'),
        'attention': array(ref('attention'), 64), 'notices': array(ref('notice'), 128),
        'read': enum('unknown', 'read', 'unread'), 'unavailable': array(ref('unavailable'), 6),
        'ordering': ref('ordering'), 'lastEvidenceAtMs': ref('integer'), 'observedAtMs': ref('integer')}
    definitions['storedSession'] = obj({**visible, 'retiredTurns': array(ref('id'), 256, True),
                                        'seen': array(ref('seen'), 256), 'watermarks': array(ref('watermark'), 256)}, ('label', 'projectId'))
    definitions['snapshotSession'] = obj({**visible, 'observationAgeMs': ref('integer'), 'freshness': enum('current', 'uncertain'),
                                          'restartUncertain': {'type': 'boolean'},
                                          'children': obj({'active': ref('integer'), 'uncertain': ref('integer')})}, ('label', 'projectId'))
    durable = obj({'formatVersion': {'const': '1.0'}, 'ownerId': ref('id'), 'revision': ref('integer'),
                   'lastCommitAtMs': ref('integer'), 'consumers': array(ref('consumer'), 16),
                   'sessions': array(ref('storedSession'), 128), 'journal': array(ref('journal'), 10000)})
    snapshot = obj({'apiVersion': {'const': '1.0'}, 'revision': ref('integer'), 'asOfMs': ref('integer'),
                    'collector': enum('running', 'quiesced', 'faulted', 'closed'), 'lossCount': ref('integer'),
                    'sessions': array(ref('snapshotSession'), 128)})
    for name, value in [('durable-v1', durable), ('snapshot-v1', snapshot)]:
        yield name, {'$schema': 'https://json-schema.org/draft/2020-12/schema',
                     '$id': 'https://jimmie-potts.github.io/agent-device-hub/agent-state/' + name,
                     **value, '$defs': definitions}
    newer = deepcopy(definitions)
    for name in ['storedSession', 'snapshotSession']:
        newer[name]['properties']['generation'] = ref('integer')
    newer['storedSession']['required'].append('generation')
    newer['retirement'] = obj({'identity': ref('identity'), 'atMs': ref('integer'),
        'turns': array(ref('id'), 256, True), 'keys': array(ref('hash'), 256, True),
        'ordering': array(obj({'epoch': ref('id'), 'sequence': ref('integer')}), 256)})
    next_durable = deepcopy(durable)
    next_durable['properties']['formatVersion'] = {'const': '2.0'}
    next_durable['properties']['retirements'] = array(ref('retirement'), 128)
    next_durable['required'].append('retirements')
    next_snapshot = deepcopy(snapshot)
    next_snapshot['properties']['apiVersion'] = {'const': '1.1'}
    for name, value in [('durable-v2', next_durable), ('snapshot-v1.1', next_snapshot)]:
        yield name, {'$schema': 'https://json-schema.org/draft/2020-12/schema',
                     '$id': 'https://jimmie-potts.github.io/agent-device-hub/agent-state/' + name,
                     **value, '$defs': newer}


if __name__ == '__main__':
    target = ROOT / 'packages/agent-state/schemas'
    for name, schema in schemas():
        path = target / (name + '.schema.json')
        encoded = json.dumps(schema, indent=2, ensure_ascii=False) + '\n'
        if '--check' in sys.argv:
            if not path.exists() or path.read_text() != encoded:
                raise SystemExit('State schema drift: ' + name)
        else:
            target.mkdir(parents=True, exist_ok=True)
            path.write_text(encoded)
