"""Synthetic descriptors only; every Music/process/permission API is substituted."""
import json
from pathlib import Path
import re
import subprocess
import sys

binary = sys.argv[1]
native = Path(__file__).resolve().parent.parent
source = (native / "playback.m").read_text()
fake = (native / "tests/playback.m").read_text()
calls = set(re.findall(r"\b(AE\w+)\s*\(", source)) - {"AEDisposeDesc", "AEGetDescDataSize"}
replacements = set(re.findall(r"^#define (AE\w+) ", fake, re.M))
assert calls <= replacements
assert "#define NSRunningApplication FakeMusicApplication" in fake
assert not re.search(r"NSWorkspace|NSAppleScript|SBApplication|sendEventWithOptions|executeAppleEvent", source)
scenarios_run = 0
errors = {
    "unavailable": (True, "The selected Music process or requested field is unavailable."),
    "forbidden": (False, "Music automation permission is unavailable without prompting."),
    "invalid-message": (False, "Music returned an invalid playback descriptor."),
    "invalid-request": (False, "Use a supported explicit Music playback helper command."),
    "capacity": (True, "Music playback data exceeds the helper's fixed limits."),
    "expired": (False, "The Music playback operation deadline passed before transmission."),
    "invalid-state": (False, "Music refused the requested playback action."),
    "unsupported-capability": (False, "Music does not support the requested playback operation."),
    "uncertain-result": (False, "The Music playback action has no qualified definitive reply."),
}

def check_errors(value):
    if isinstance(value, dict):
        if "error" in value:
            error = value["error"]
            retryable, detail = errors[error["code"]]
            assert error == {"code": error["code"], "retryable": retryable, "detail": detail}
        for child in value.values():
            check_errors(child)
    elif isinstance(value, list):
        for child in value:
            check_errors(child)

def run(scenario):
    global scenarios_run
    scenarios_run += 1
    result = subprocess.run([binary, scenario], capture_output=True, text=True, timeout=4)
    assert result.returncode in (0, 1), (scenario, result.returncode, result.stderr)
    assert not result.stderr, (scenario, result.stderr)
    assert len(result.stdout.encode("utf-8")) <= 16384
    assert len(result.stdout.splitlines()) == 1
    value = json.loads(result.stdout)
    check_errors(value)
    return value

def observed(field):
    assert field["status"] == "observed"
    return field["value"]

def check_intervals(value, outer):
    if isinstance(value, dict):
        if set(value) == {"startedMonotonicMs", "endedMonotonicMs"}:
            assert outer["startedMonotonicMs"] <= value["startedMonotonicMs"] <= value["endedMonotonicMs"] <= outer["endedMonotonicMs"]
        for child in value.values():
            check_intervals(child, outer)
    elif isinstance(value, list):
        for child in value:
            check_intervals(child, outer)

value = run("normal")
assert value["status"] == "sample" and value["schema"] == "music-playback-read/1.0"
assert observed(value["state"]) == "playing"
assert observed(value["position"]) == 12.5 and observed(value["item"]) == "CAFE"
assert observed(value["metadata"]["title"]) == "Synthetic title"
assert value["itemAssociation"]["status"] == "bounded-match"
assert len(value["sourceInstance"]) == 64
output = value["outputSelection"]
assert output["provenance"] == "music-declared-selection" and len(output["devices"]) == 2
assert observed(output["devices"][0]["kind"]) == "homepod"
check_intervals(value, value["interval"])
assert observed(run("position-zero")["position"]) == 0
for case in ("position-nan", "position-string", "position-timeout", "read-invalid-reply"):
    value = run(case)
    assert value["status"] == "sample" and value["position"]["status"] == "unavailable", case
assert run("state-invalid")["state"]["status"] == "unavailable"
for case in ("changed-item", "missing-identity", "invalid-identity"):
    value = run(case)
    assert value["position"]["status"] == "observed" and value["itemAssociation"]["status"] == "unavailable", case
for case in ("title-oversized", "descriptor-oversized", "invalid-utf8", "text-nul"):
    assert run(case)["metadata"]["title"]["status"] == "unavailable", case
assert run("empty-output")["outputSelection"]["devices"] == []
for case in ("too-many-outputs", "output-unsupported", "output-not-list", "output-not-reference"):
    assert run(case)["outputSelection"]["status"] == "unavailable", case
assert run("output-partial")["outputSelection"]["devices"][0]["active"]["status"] == "unavailable"
assert run("output-invalid-bool")["outputSelection"]["devices"][0]["selected"]["status"] == "unavailable"
assert run("output-unknown-kind")["outputSelection"]["devices"][0]["kind"]["status"] == "unavailable"
assert run("output-label-oversized")["outputSelection"]["devices"][0]["name"]["status"] == "unavailable"
for case in ("missing", "multiple", "missing-launch", "wrong-bundle", "denied", "consent", "restart-read", "permission-lost", "capture-refused", "no-argument", "control-invalid-action"):
    assert run(case)["status"] == "unavailable", case
value = run("slow-reads")
assert value["status"] == "sample" and value["interval"]["endedMonotonicMs"] <= 6000
for action in ("play", "pause", "next", "previous"):
    value = run("control-" + action)
    assert value["schema"] == "music-playback-control/1.0" and value["status"] == "sent" and value["action"] == action
    assert value["sendInterval"] is not None
    check_intervals(value, value["interval"])
for case in ("control-denied", "control-expired", "control-wrong-instance", "control-restart-before-send", "control-insufficient-tick"):
    value = run(case)
    assert value["status"] == "unsent" and value["sendInterval"] is None
assert run("control-refused")["status"] == "refused"
assert run("control-invalid-state")["error"]["code"] == "invalid-state"
for case in ("control-timeout", "control-invalid-reply", "control-malformed-error", "restart-control"):
    assert run(case)["status"] == "uncertain", case
value = run("control-late")
assert value["status"] == "sent" and value["sendInterval"]["endedMonotonicMs"] > 4000
assert run("control-slow-process-check")["status"] == "sent"
assert run("clock")["schema"] == "music-playback-clock/1.0"
assert run("self-test")["passed"] is True
value = run("maximal-json")
assert value["status"] == "unavailable" and value["error"]["code"] == "capacity"
print(f"Music playback descriptor fake: {scenarios_run} scenarios passed; zero application AppleEvents.")
