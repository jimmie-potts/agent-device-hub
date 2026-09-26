"""Pure validation of the shared lifecycle metadata contract."""
import hashlib
import json
import math
from pathlib import Path

from jsonschema import Draft202012Validator

ARTIFACT_VERSION = '1.1.0'
API_VERSION = '1.0'
MAX_BYTES = 8192
MAX_DEPTH = 8
MAX_NODES = 256
_SCHEMA = json.loads((Path(__file__).resolve().parents[2] / 'schemas/lifecycle-v1.schema.json').read_text(encoding='utf-8'))
_VALIDATOR = Draft202012Validator(_SCHEMA)
_V11_VALIDATOR = Draft202012Validator(json.loads((Path(__file__).resolve().parents[2] / 'schemas/lifecycle-v1.1.schema.json').read_text(encoding='utf-8')))


def _bounded(value, depth=0, budget=None):
    if budget is None:
        budget = [0, 0]
    budget[0] += 1
    if depth > MAX_DEPTH or budget[0] > MAX_NODES:
        return False
    if type(value) is str:
        budget[1] += len(value.encode('utf-8'))
        return budget[1] <= MAX_BYTES
    if value is None or type(value) is bool:
        return True
    if type(value) in (int, float):
        return math.isfinite(value) and 0 <= value <= 9007199254740991 and int(value) == value
    if type(value) is not dict or len(value) > MAX_NODES:
        return False
    return all(type(k) is str and _bounded(k, depth+1, budget) and _bounded(v, depth+1, budget) for k, v in value.items())


def _normalized(value):
    if type(value) is float:
        return int(value)
    if type(value) is dict:
        return {k: _normalized(v) for k, v in value.items()}
    return value


def validate_event(value):
    """Return a detached JSON value or a content-free error code."""
    try:
        if not _bounded(value):
            return {'ok': False, 'code': 'invalid-event'}
        encoded = json.dumps(_normalized(value), ensure_ascii=False, separators=(',', ':'))
        if len(encoded.encode('utf-8')) > MAX_BYTES or not (_VALIDATOR.is_valid(value) or _V11_VALIDATOR.is_valid(value)):
            return {'ok': False, 'code': 'invalid-event'}
        if value['parent']['status'] == 'known':
            parent = value['parent']['identity']
            if parent['sessionId'] == value['identity']['sessionId'] or any(parent[k] != value['identity'][k] for k in ('provider', 'client', 'hostId', 'sourceId')):
                return {'ok': False, 'code': 'invalid-event'}
        return {'ok': True, 'value': json.loads(encoded)}
    except (ValueError, TypeError, OverflowError, RecursionError):
        return {'ok': False, 'code': 'invalid-event'}


def deduplication_key(value):
    result = validate_event(value)
    if not result['ok']:
        return None
    value = result['value']
    native = 'eventId' in value
    material = {k: value[k] for k in ('identity', 'turn', 'eventId')} if native else value
    encoded = json.dumps(material, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return {'kind': 'native' if native else 'content', 'key': hashlib.sha256(encoded).hexdigest()}
