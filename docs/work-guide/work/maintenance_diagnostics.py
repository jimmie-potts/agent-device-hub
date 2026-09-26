"""Keep fresh maintenance failures visible when Direction blocks guide builds.

This diagnostic run does not turn blocked build-dependent tests into passes.
Only the builder's typed input-validation result can identify a Direction block;
all other failures, errors and skips keep the run ineligible for publication.
"""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid


class DirectionBlocked(unittest.SkipTest):
    """A default build was blocked by a typed stale-Direction diagnostic."""


def run_suite(suite, result_path):
    """Run the actual suite and persist a completion receipt; return eligibility.

    Zero means no unrelated failures, errors, skips or expected failures occurred.
    Direction-blocked tests remain explicitly listed as blocked, never passed.
    An interrupted suite leaves no completion receipt.
    """
    result_path = Path(result_path)
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.unlink(missing_ok=True)
    original_run = subprocess.run
    block_reasons = {}

    class DiagnosticResult(unittest.TextTestResult):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.direction_blocked = []
            self.unrelated_skips = []

        def addSkip(self, test, reason):
            super().addSkip(test, reason)
            diagnostic = block_reasons.pop(reason, None)
            if diagnostic is None:
                self.unrelated_skips.append({'test': test.id(), 'reason': reason})
            else:
                self.direction_blocked.append({'test': test.id(), 'diagnostic': diagnostic})

    def invoke(command, *args, **kwargs):
        try:
            return original_run(command, *args, **kwargs)
        except KeyboardInterrupt as error:
            # unittest normally aborts its whole run on KeyboardInterrupt. A
            # subprocess interruption is a recorded error in this diagnostic run.
            raise RuntimeError('Maintenance subprocess was interrupted') from error

    def diagnostic_run(*args, **kwargs):
        command = args[0] if args else kwargs.get('args')
        is_default_build = (
            isinstance(command, (tuple, list)) and len(command) == 2
            and Path(str(command[0])).name.startswith('python')
            and Path(str(command[1])).name == 'build_guide.py'
            and not kwargs.get('shell')
        )
        if not is_default_build:
            try:
                return original_run(*args, **kwargs)
            except KeyboardInterrupt as error:
                raise RuntimeError('Maintenance subprocess was interrupted') from error
        remaining = args[1:] if args else ()
        options = {key: value for key, value in kwargs.items() if key != 'args'}
        original_error = None
        try:
            result = invoke(command, *remaining, **options)
            returncode = result.returncode
        except subprocess.CalledProcessError as error:
            original_error = error
            returncode = error.returncode
        if returncode:
            with tempfile.TemporaryDirectory(prefix='direction-diagnostic-', dir=result_path.parent) as directory:
                path = Path(directory) / 'result.json'
                probe = invoke([*command, '--validate-inputs', '--validation-result', str(path)],
                               *remaining, **dict(options, check=False))
                if probe.returncode != 3:
                    # Negative fixtures deliberately make the default builder
                    # fail. Preserve that result so their own assertions run.
                    if original_error is not None:
                        raise original_error
                    return result
                if not path.is_file():
                    raise RuntimeError('Build diagnostic did not produce a typed result')
                diagnostic = json.loads(path.read_text(encoding='utf-8'))
                if not isinstance(diagnostic, dict) or diagnostic.get('status') != 'direction-stale':
                    raise RuntimeError('Exit-3 build diagnostic has an invalid typed result')
                if diagnostic.get('status') == 'direction-stale':
                    # TestResult receives a string for SkipTest, so associate the
                    # exact exception reason with this typed record. Never infer
                    # eligibility by matching process stderr or a skip's wording.
                    reason = 'Direction blocked [' + uuid.uuid4().hex + ']'
                    block_reasons[reason] = diagnostic
                    raise DirectionBlocked(reason)
        if original_error is not None:
            raise original_error
        return result

    with patch.object(subprocess, 'run', side_effect=diagnostic_run):
        result = unittest.TextTestRunner(resultclass=DiagnosticResult, verbosity=2).run(suite)
    records = lambda items: [{'test': test.id(), 'traceback': traceback} for test, traceback in items]
    eligible = bool(result.testsRun) and not (
        result.failures or result.errors or result.unrelated_skips
        or result.unexpectedSuccesses or result.expectedFailures or result.shouldStop
    )
    document = {
        'completed': not result.shouldStop,
        'testsRun': result.testsRun,
        'failures': len(records(result.failures)),
        'failureDetails': records(result.failures),
        'errors': len(records(result.errors)),
        'errorDetails': records(result.errors),
        'unrelatedSkips': len(result.unrelated_skips),
        'unrelatedSkipDetails': result.unrelated_skips,
        'directionBlocked': result.direction_blocked,
        'unexpectedSuccesses': len([test.id() for test in result.unexpectedSuccesses]),
        'unexpectedSuccessDetails': [test.id() for test in result.unexpectedSuccesses],
        'expectedFailures': len(records(result.expectedFailures)),
        'expectedFailureDetails': records(result.expectedFailures),
        'eligible': eligible,
    }
    if result.shouldStop:
        return 1
    # Only a completed run gets a result file, replaced atomically after encoding.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=result_path.parent,
                                         prefix='.maintenance-result-', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(document, stream, indent=2)
            stream.write('\n')
        temporary.replace(result_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return 0 if eligible else 1
