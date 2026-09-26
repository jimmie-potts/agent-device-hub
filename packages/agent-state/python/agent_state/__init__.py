"""Validate versioned snapshots without implementing agent-state reduction."""
import json
import math
from pathlib import Path

from jsonschema import Draft202012Validator

ARTIFACT_VERSION = '3.3.0'
API_VERSION = '1.0'
MAX_BYTES = 16 * 1024 * 1024
_SCHEMA = json.loads((Path(__file__).resolve().parents[2] / 'schemas/snapshot-v1.schema.json').read_text(encoding='utf-8'))
_VALIDATOR = Draft202012Validator(_SCHEMA)
_V11_VALIDATOR = Draft202012Validator(json.loads((Path(__file__).resolve().parents[2] / 'schemas/snapshot-v1.1.schema.json').read_text(encoding='utf-8')))
_V12_VALIDATOR = Draft202012Validator(json.loads((Path(__file__).resolve().parents[2] / 'schemas/snapshot-v1.2.schema.json').read_text(encoding='utf-8')))
_IDENTITY_FIELDS = ('provider', 'client', 'hostId', 'sourceId', 'sessionId')


def _bounded(value, depth=0, budget=None):
    if budget is None:
        budget = [0, 0]
    budget[0] += 1
    if depth > 20 or budget[0] > 1000000:
        return False
    if type(value) is str:
        budget[1] += len(value.encode('utf-8'))
        return budget[1] <= MAX_BYTES
    if value is None or type(value) is bool:
        return True
    if type(value) in (int, float):
        return math.isfinite(value) and 0 <= value <= 9007199254740991 and int(value) == value
    if type(value) is list:
        return len(value) <= 10000 and all(_bounded(item, depth+1, budget) for item in value)
    if type(value) is dict:
        return len(value) <= 10000 and all(type(key) is str and _bounded(key, depth+1, budget) and _bounded(item, depth+1, budget) for key, item in value.items())
    return False


def _normalized(value):
    if type(value) is float:
        return int(value)
    if type(value) is dict:
        return {key: _normalized(item) for key, item in value.items()}
    if type(value) is list:
        return [_normalized(item) for item in value]
    return value


def _identity(value):
    return tuple(value[field] for field in _IDENTITY_FIELDS)


def _semantics(snapshot):
    identities = set()
    for session in snapshot['sessions']:
        if session.get('generation', 0) > snapshot['revision']:
            return False
        identity = session['identity']
        key = _identity(identity)
        if key in identities:
            return False
        identities.add(key)
        if session['parent']['status'] == 'known':
            parent = session['parent']['identity']
            if parent['sessionId'] == identity['sessionId'] or _identity(parent)[:-1] != key[:-1]:
                return False
        if session['read'] != 'unknown' and (identity['provider'], identity['client']) != ('codex', 'desktop'):
            return False
        for items, field in ((session['notices'], 'id'), (session['unavailable'], 'dimension')):
            if len({item[field] for item in items}) != len(items):
                return False
        age = snapshot['asOfMs'] - session['lastEvidenceAtMs']
        if age < 0 or session['observationAgeMs'] != age:
            return False
        freshness = 'uncertain' if session['restartUncertain'] or age >= 300000 else 'current'
        if session['freshness'] != freshness:
            return False
        children = {'active': 0, 'uncertain': 0}
        for child in snapshot['sessions']:
            if (child['parent']['status'] != 'known' or _identity(child['parent']['identity']) != key
                    or any(item['dimension'] == 'parent' and item['reason'] == 'ambiguous' for item in child['unavailable'])):
                continue
            uncertain = child['activity'] == 'unknown' or any(
                item['dimension'] == 'activity' or item['dimension'] in ('turn', 'ordering') and item['reason'] == 'ambiguous'
                for item in child['unavailable'])
            if uncertain:
                children['uncertain'] += 1
            elif child['activity'] == 'active':
                children['active' if child['freshness'] == 'current' else 'uncertain'] += 1
        if session['children'] != children:
            return False
    return True


def validate_snapshot(value):
    """Return detached allowlisted JSON or a content-free error code."""
    try:
        if not _bounded(value):
            return {'ok': False, 'code': 'invalid-state'}
        encoded = json.dumps(_normalized(value), ensure_ascii=False, separators=(',', ':'))
        if len(encoded.encode('utf-8')) > MAX_BYTES or not (_VALIDATOR.is_valid(value) or _V11_VALIDATOR.is_valid(value) or _V12_VALIDATOR.is_valid(value)) or not _semantics(value):
            return {'ok': False, 'code': 'invalid-state'}
        return {'ok': True, 'value': json.loads(encoded)}
    except (ValueError, TypeError, OverflowError, RecursionError, KeyError):
        return {'ok': False, 'code': 'invalid-state'}
