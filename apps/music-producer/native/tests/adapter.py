"""Exercise only the adapter binary compiled with CoreAudio replaced by fakes."""
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import time

binary = sys.argv[1]
native = Path(__file__).resolve().parent.parent
calls = set(re.findall(r"\b(Audio(?:Object|Hardware|Device)\w+)\s*\(", (native / "main.m").read_text()))
replacements = set(re.findall(r"^#define (Audio\w+) ", (native / "tests/adapter.m").read_text(), re.M))
assert calls <= replacements, "every CoreAudio access must be replaced before synthetic execution"
assert "#define AVCaptureDevice FakeCaptureDevice" in (native / "tests/adapter.m").read_text(), "authorization APIs must be replaced"


def start(failure=""):
    environment = dict(os.environ, BUNNY_NATIVE_TEST_FAILURE=failure)
    return subprocess.Popen(
        [binary, "--capture"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=environment,
    )


def first(process):
    assert select.select([process.stdout], [], [], 3)[0], "synthetic adapter timed out"
    return json.loads(process.stdout.readline())


for args, code, schema in [([], 2, "music-native-terminal/1.0"),
                           (["--self-test"], 0, "music-native-frame/1.0"),
                           (["--clock"], 0, "music-native-clock/1.0")]:
    done = subprocess.run([binary, *args], capture_output=True, text=True, timeout=3, check=False)
    assert done.returncode == code and not done.stderr, done
    assert json.loads(done.stdout)["schema"] == schema

for ending in ["stop", "eof", "sigterm", "sigint"]:
    process = start()
    frame = first(process)
    assert frame["schema"] == "music-native-frame/1.0" and frame["rms"] == 0.25
    assert frame["startMonotonicMs"] < frame["endMonotonicMs"] <= frame["emittedMonotonicMs"]
    if ending == "stop":
        process.stdin.write("stop\n")
        process.stdin.flush()
    elif ending == "eof":
        process.stdin.close()
        process.stdin = None
    else:
        process.send_signal(signal.SIGTERM if ending == "sigterm" else signal.SIGINT)
    stdout, stderr = process.communicate(timeout=3)
    assert process.returncode == 0 and not stdout and not stderr, (ending, stdout, stderr)

closed = subprocess.run([binary, "--capture"], input="", capture_output=True, text=True,
                        env=dict(os.environ, BUNNY_NATIVE_TEST_NO_ACCESS="1"), timeout=3, check=False)
assert closed.returncode == 0 and not closed.stdout and not closed.stderr

process = start()
first(process)
stdout, stderr = process.communicate("invalid\n", timeout=3)
assert process.returncode == 1 and not stderr
assert json.loads(stdout)["error"]["code"] == "invalid-request"

failures = {
    "create-tap": "unavailable", "read-format": "unavailable", "add-listener": "unavailable",
    "create-aggregate": "unavailable", "create-proc": "unavailable", "start": "unavailable",
    "unsupported-format": "unsupported-capability", "format-changed": "unsupported-capability",
    "source-lost": "unavailable", "sample-invalid": "invalid-message",
    "buffer-invalid": "unsupported-capability", "timestamp-invalid": "invalid-message",
    "route-changed": "unavailable", "route-changed-poll": "unavailable",
    "route-changed-during-setup": "unavailable", "route-changed-before-start": "unavailable",
    "route-unavailable": "unavailable", "route-empty": "unavailable", "route-oversized": "unavailable",
    "add-route-listener": "unavailable",
}
for failure, code in failures.items():
    process = start(failure)
    terminal = first(process)
    assert terminal["schema"] == "music-native-terminal/1.0" and terminal["error"]["code"] == code
    stdout, stderr = process.communicate(timeout=3)
    assert process.returncode == 1 and not stdout and not stderr, (failure, stdout, stderr)

for failure in ["stop", "destroy-proc", "remove-listener", "destroy-aggregate", "destroy-tap", "remove-route-listener"]:
    process = start(failure)
    first(process)
    stdout, stderr = process.communicate("stop\n", timeout=3)
    terminal = json.loads(stdout)
    assert process.returncode == 1 and not stderr
    assert terminal["error"] == {"code": "unavailable", "retryable": True,
                                  "detail": "Music capture cleanup did not complete."}

process = start("pause")
time.sleep(0.05)
assert not select.select([process.stdout], [], [], 0)[0], "pause must not produce a source failure"
stdout, stderr = process.communicate("stop\n", timeout=3)
assert process.returncode == 0 and not stdout and not stderr

print("music-native: synthetic adapter lifecycle, failures and cleanup passed; CoreAudio calls replaced")

def microphone(failure=""):
    process = subprocess.Popen([binary, "--capture-microphone"], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               env=dict(os.environ, BUNNY_NATIVE_TEST_FAILURE=failure))
    process.stdin.write(json.dumps({"schema": "music-native-input/1.0", "uid": "synthetic-private-uid"}) + "\n")
    process.stdin.flush()
    return process


process = microphone()
frame = first(process)
assert frame["schema"] == "music-native-frame/1.0" and frame["rms"] == 0.25, frame
stdout, stderr = process.communicate("stop\n", timeout=3)
assert process.returncode == 0 and not stdout and not stderr

for failure, code in {
    "mic-missing": "unavailable", "mic-permission-denied": "unavailable", "mic-permission-needed": "unavailable",
    "mic-permission-revoked": "unavailable", "mic-removed": "unavailable", "mic-uid-changed": "unavailable",
    "mic-format": "unsupported-capability", "mic-many-inputs": "unsupported-capability",
    "mic-output-enabled": "unsupported-capability", "mic-output-refused": "unsupported-capability",
    "mic-change-before-start": "unsupported-capability", "mic-listener": "unavailable",
    "create-proc": "unavailable", "start": "unavailable",
    "sample-invalid": "invalid-message", "timestamp-invalid": "invalid-message",
}.items():
    process = microphone(failure)
    terminal = first(process)
    assert terminal["schema"] == "music-native-terminal/1.1" and terminal["error"]["code"] == code, (failure, terminal)
    stdout, stderr = process.communicate(timeout=3)
    assert process.returncode == 1 and not stdout and not stderr, (failure, stdout, stderr)

for failure in ["stop", "destroy-proc", "mic-remove-listener"]:
    process = microphone(failure)
    first(process)
    stdout, stderr = process.communicate("stop\n", timeout=3)
    assert process.returncode == 1 and not stderr
    assert json.loads(stdout)["error"]["detail"] == "Microphone capture cleanup did not complete."

for command in ["", "stop\n", json.dumps({"schema": "music-native-input/1.0", "uid": "synthetic-private-uid"}) + "\nstop\n"]:
    done = subprocess.run([binary, "--capture-microphone"], input=command, capture_output=True, text=True,
                          env=dict(os.environ, BUNNY_NATIVE_TEST_NO_ACCESS="1"), timeout=3, check=False)
    assert done.returncode == 0 and not done.stdout and not done.stderr, done

for command in ['{"schema":"music-native-input/1.0","uid":""}\n',
                json.dumps({"schema": "music-native-input/1.0", "uid": "x" * 1025}) + "\n",
                '{"schema":"music-native-input/1.0","uid":"synthetic-private-uid","default":true}\n']:
    done = subprocess.run([binary, "--capture-microphone"], input=command, capture_output=True, text=True,
                          env=dict(os.environ, BUNNY_NATIVE_TEST_NO_ACCESS="1"), timeout=3, check=False)
    assert done.returncode == 1 and not done.stderr and json.loads(done.stdout)["error"]["code"] == "invalid-request", done

done = subprocess.run([binary, "--list-microphones"], capture_output=True, text=True, timeout=3, check=False)
assert done.returncode == 0 and not done.stderr
assert json.loads(done.stdout) == {"schema": "music-native-inputs/1.0", "devices": [{"uid": "synthetic-private-uid", "name": "Synthetic microphone"}]}
done = subprocess.run([binary, "--list-microphones"], capture_output=True, text=True,
                      env=dict(os.environ, BUNNY_NATIVE_TEST_FAILURE="mic-inventory-oversized"), timeout=3, check=False)
assert done.returncode == 1 and not done.stdout and not done.stderr

for failure, status, code in [("", "authorized", 0), ("mic-permission-needed", "authorized", 0),
                              ("mic-permission-denied", "denied", 1), ("mic-permission-declined", "denied", 1)]:
    done = subprocess.run([binary, "--authorize-microphone"], capture_output=True, text=True,
                          env=dict(os.environ, BUNNY_NATIVE_TEST_FAILURE=failure), timeout=3, check=False)
    assert done.returncode == code and not done.stderr
    assert json.loads(done.stdout) == {"schema": "music-native-permission/1.0", "status": status}

process = subprocess.Popen([binary, "--authorize-microphone"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           env=dict(os.environ, BUNNY_NATIVE_TEST_FAILURE="mic-permission-no-answer"), text=True)
time.sleep(0.05)
process.send_signal(signal.SIGTERM)
stdout, stderr = process.communicate(timeout=3)
assert process.returncode == 1 and not stdout and not stderr
print("music-native: selected microphone and explicit setup passed; CoreAudio and AVFoundation access replaced")
