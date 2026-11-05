"""Synthetic AppleEvent descriptors only: fake calls never contact an application."""
import json
from pathlib import Path
import re
import subprocess
import sys

binary = sys.argv[1]
scenarios_run = 0
native = Path(__file__).resolve().parent.parent
source = (native / "position.m").read_text()
fake = (native / "tests/position.m").read_text()
calls = set(re.findall(r"\b(AE\w+)\s*\(", source)) - {"AEDisposeDesc"}
replacements = set(re.findall(r"^#define (AE\w+) ", fake, re.M))
assert calls <= replacements, "every AppleEvent access must be replaced before synthetic execution"
assert "#define NSRunningApplication FakeMusicApplication" in fake
assert not re.search(r"NSWorkspace|NSAppleScript|SBApplication|sendEventWithOptions|executeAppleEvent", source)

def run(scenario):
    global scenarios_run
    scenarios_run += 1
    result = subprocess.run([binary, scenario], capture_output=True, text=True, timeout=4)
    assert not result.stderr, (scenario, result.stderr)
    assert result.returncode in (0, 1), (scenario, result.returncode)
    assert len(result.stdout.splitlines()) == 1
    value = json.loads(result.stdout)
    if scenario not in ("clock", "self-test"):
        assert value["schema"] == "music-position-read/1.0"
        assert value["interval"]["startedMonotonicMs"] <= value["interval"]["endedMonotonicMs"]
    return value

for state in ("playing", "stopped", "paused", "fast-forwarding", "rewinding"):
    value = run(state)
    assert value["status"] == "sample" and value["state"]["value"] == state
    assert value["position"]["seconds"] == 12.5
    assert len(value["sourceInstance"]) == 64
    cycle, first, second = value["interval"], value["state"]["interval"], value["position"]["interval"]
    assert cycle["startedMonotonicMs"] <= first["startedMonotonicMs"] <= first["endedMonotonicMs"]
    assert first["endedMonotonicMs"] <= second["startedMonotonicMs"] <= second["endedMonotonicMs"] <= cycle["endedMonotonicMs"]
assert run("integer")["position"]["seconds"] == 12
for descriptor in ("int16", "int64", "uint32"):
    assert run(descriptor)["position"]["seconds"] == 12
assert run("float32")["position"]["seconds"] == 12.5
assert run("zero")["position"]["seconds"] == 0
assert run("playing")["sourceInstance"] != run("new-instance")["sourceInstance"]
for scenario in ("position-timeout", "string", "boolean", "negative", "nan", "infinite", "oversized", "malformed-error", "position-short", "position-long", "error-short"):
    value = run(scenario)
    assert value["status"] == "sample" and value["position"]["status"] == "unavailable", scenario
for scenario in ("missing", "multiple", "missing-launch", "denied", "consent", "permission-process-missing", "state-timeout", "unknown-state", "state-short", "state-long", "restart-state", "restart-position", "capture-refused", "no-argument"):
    value = run(scenario)
    assert value["status"] == "unavailable" and "state" not in value, scenario
assert run("clock")["schema"] == "music-position-clock/1.0"
assert run("self-test")["passed"] is True
print(f"Music position descriptor fake: {scenarios_run} scenarios passed; zero application AppleEvents.")
