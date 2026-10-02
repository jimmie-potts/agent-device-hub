"""Pure B.U.N.N.Y. profile validation; no transport, storage or device effects."""
from copy import deepcopy
from datetime import datetime
import json
import math
from pathlib import Path
import re

from jsonschema import Draft202012Validator

ARTIFACT_VERSION = '1.0.0'
PROFILE_VERSION = '1.0'
MAX_BYTES, MAX_DEPTH, MAX_NODES = 16384, 12, 512
SCHEMA = json.loads((Path(__file__).resolve().parents[2] / 'schemas/event-v1.schema.json').read_text())
Draft202012Validator.check_schema(SCHEMA)
_CHECK = Draft202012Validator(SCHEMA)


def _bounded(value, depth=0, budget=None):
    if budget is None:
        budget = [0, 0]
    budget[0] += 1
    if depth > MAX_DEPTH or budget[0] > MAX_NODES:
        return False
    if type(value) is str:
        budget[1] += len(value.encode('utf-8'))
        return budget[1] <= MAX_BYTES and re.fullmatch(r'[\x20-\x7e]*', value) is not None
    if value is None or type(value) is bool:
        return True
    if type(value) in (int, float):
        return math.isfinite(value) and 0 <= value <= 9007199254740991 and int(value) == value
    if type(value) is not dict or len(value) > MAX_NODES:
        return False
    return all(type(k) is str and _bounded(k, depth + 1, budget) and _bounded(v, depth + 1, budget)
               for k, v in value.items())


def validate_event(value):
    """Return a detached value or a fixed error. Source authentication is external."""
    invalid = {'ok': False, 'code': 'invalid-event'}
    try:
        if not _bounded(value):
            return invalid
        if len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) > MAX_BYTES or not _CHECK.is_valid(value):
            return invalid
        evidence = value['data']['evidence']
        if (evidence['occurrence'] == 'known') != ('time' in value):
            return invalid
        if 'time' in value:
            datetime.strptime(value['time'], '%Y-%m-%dT%H:%M:%S.%fZ')
        cause = evidence['causation']
        if cause['status'] == 'known' and (cause['source'], cause['id']) == (value['source'], value['id']):
            return invalid
        payload = value['data']['payload']
        if value['type'] == 'org.bunny.lifecycle.observed' and ((payload['provider'] == 'claude') != (payload['client'] == 'code')):
            return invalid
        if value['type'] == 'org.bunny.effect.available' and payload['expiresAtMs'] <= payload['notBeforeMs']:
            return invalid
        return {'ok': True, 'value': deepcopy(value)}
    except (ValueError, TypeError, OverflowError, RecursionError, UnicodeError):
        return invalid


def reference_decision(value):
    """Specification decisions only; the caller supplies qualified acceptance/handling."""
    try:
        if not _bounded(value) or type(value) is not dict:
            return 'invalid'
        checked = validate_event(value.get('event'))
        if not checked['ok']:
            return 'invalid'
        event = checked['value']
        if value.get('operation') == 'retry':
            if set(value) != {'operation', 'event', 'prior'}:
                return 'invalid'
            if value['prior'] is None:
                return 'new'
            prior = validate_event(value['prior'])
            if not prior['ok']:
                return 'invalid'
            if (prior['value']['source'], prior['value']['id']) != (event['source'], event['id']):
                return 'new'
            return 'duplicate' if prior['value'] == event else 'conflict'
        if (value.get('operation') != 'delivery' or
                set(value) != {'operation', 'event', 'recovery', 'nowMs', 'acceptance', 'handling', 'delivered'} or
                type(value['recovery']) is not bool or type(value['delivered']) is not bool or
                type(value['nowMs']) not in (int, float) or
                value['acceptance'] not in ('unconfirmed', 'confirmed', 'ambiguous', 'failed') or
                value['handling'] not in ('pending', 'handled', 'expired')):
            return 'invalid'
        if event['deliveryclass'] == 'current-state':
            return 'read-snapshot'
        if event['type'] == 'org.bunny.notice.accepted':
            if value['acceptance'] != 'confirmed':
                return 'unconfirmed'
            if value['handling'] == 'handled':
                return 'handled'
            if value['handling'] == 'expired':
                return 'expired'
            if value['recovery']:
                return 'recover-notice'
            return 'await-handling' if value['delivered'] else 'deliver-notice'
        if event['type'] == 'org.bunny.effect.available':
            if value['recovery']:
                return 'no-replay'
            if value['nowMs'] < event['data']['payload']['notBeforeMs']:
                return 'not-yet-valid'
            if value['nowMs'] >= event['data']['payload']['expiresAtMs']:
                return 'expired'
            return 'eligible-live-effect'
        return 'invalid'
    except (ValueError, TypeError, OverflowError, RecursionError, UnicodeError):
        return 'invalid'
