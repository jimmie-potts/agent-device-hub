"""Controller contract 1.0 and 1.1 schemas and pure reference decisions. No device or network I/O."""
from copy import deepcopy
from functools import lru_cache
import json
import math
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

ARTIFACT_VERSION = "1.1.0"
# The original wire version. 1.0-only consumers keep using it unchanged.
API_VERSION = "1.0"
API_VERSIONS = ("1.0", "1.1")
# Moods every device with moments supported must declare.
CORE_MOODS = ("celebrate", "setback", "reminder")
# A moment may be scheduled at most this far ahead of its delivery.
MOMENT_MAX_LEAD_MS = 60000
# A device remembers at least this many recent moment IDs per controller clock epoch.
MOMENT_MEMORY = 64
SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "schemas/controller-v1.schema.json").read_text())
MAX_SAFE_INTEGER = 9007199254740991
MAX_JSON_DEPTH = 32


@lru_cache(maxsize=None)
def _validator(definition: str) -> Draft202012Validator:
    return Draft202012Validator({"$ref": "#/$defs/" + definition, "$defs": SCHEMA["$defs"]})


def validate(definition: str, value: Any) -> bool:
    """Validate the same strict Draft 2020-12 schema used by TypeScript."""
    if definition not in SCHEMA["$defs"]:
        return False
    return _is_json(value) and _validator(definition).is_valid(value)


def _is_json(value: Any) -> bool:
    # All v1 schema shapes are shallower than this bound. Walk hostile input without recursion.
    pending = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        if depth > MAX_JSON_DEPTH:
            return False
        if item is None or isinstance(item, (str, bool, int)):
            continue
        if isinstance(item, float):
            if not math.isfinite(item):
                return False
            continue
        if isinstance(item, list):
            children = item
        elif isinstance(item, dict) and all(isinstance(key, str) for key in item):
            children = item.values()
        else:
            return False
        pending.extend((child, depth + 1) for child in children)
    return True


def authorize(value: dict[str, Any]) -> dict[str, Any]:
    """Evaluate synthetic owner-supplied authorization facts, never raw credentials."""
    credential = value["credential"]
    if (not credential or credential["kind"] != "machine" or not credential["declared"]
            or credential["status"] not in ("active", "overlap")):
        return {"decision": "unauthenticated", "effects": 0}
    if (not value["hostAllowed"] or not value["fetchMetadataAllowed"]
            or (value["originPresent"] and not value["originAllowed"])
            or value["deviceId"] not in credential["devices"] or value["scope"] not in credential["scopes"]):
        return {"decision": "forbidden", "effects": 0}
    return {"decision": "allowed", "effects": 0}


def _supports(capabilities: dict[str, Any], command: dict[str, Any]) -> bool:
    kind = command["kind"]
    if kind == "power.set":
        return capabilities["power"]["supported"]
    if kind == "brightness.set":
        return capabilities["brightness"]["supported"]
    if kind == "media.start":
        cap = capabilities["media"]
        return cap["supported"] and command["playlistId"] in cap["playlistIds"]
    if kind == "media.control":
        cap = capabilities["media"]
        return cap["supported"] and command["action"] in cap["actions"]
    if kind == "scene.activate":
        cap = capabilities["scenes"]
        return cap["supported"] and command["sceneId"] in cap["sceneIds"]
    if kind == "zone.power.set":
        cap = capabilities["zones"]
        return cap["supported"] and command["zoneId"] in cap["zoneIds"]
    if kind == "mode.set":
        cap = capabilities.get("modes", {"supported": False})
        return cap["supported"] and command["mode"] in cap["values"]
    if kind == "moment":
        cap = capabilities.get("moments", {"supported": False})
        return (cap["supported"] and command["mood"] in cap["moods"] and command["durationMs"] <= cap["maxDurationMs"]
                and (not command["coversStatus"] or cap["coversStatus"]))
    return False


def admit(value: dict[str, Any]) -> dict[str, Any]:
    """Pure decision; the owner must atomically apply reservations and retain receipts."""
    state = value["state"]

    def reject(code: str) -> dict[str, Any]:
        return {"decision": code, "reserved": False, "nextSequence": state["nextSequence"], "scheduled": 0}

    auth = authorize({**value["auth"], "scope": "control"})
    if auth["decision"] != "allowed":
        return reject(auth["decision"])
    request = value["request"]
    # A 1.1 envelope is valid only on a controller that serves 1.1; 1.0 requests stay valid everywhere.
    v1_1 = "1.1" in state.get("apiVersions", ())
    if not (v1_1 and validate("requestV1_1", request)) and not validate("request", request):
        return reject("invalid-request")
    target_auth = authorize({**value["auth"], "deviceId": request["deviceId"], "scope": "control"})
    if target_auth["decision"] != "allowed":
        return reject(target_auth["decision"])
    if request["controllerId"] != state["controllerId"] or request["deviceId"] != state["deviceId"]:
        return reject("unknown-device")
    body_bytes = value["bodyBytes"]
    if isinstance(body_bytes, bool) or not isinstance(body_bytes, (int, float)) or not math.isfinite(body_bytes) or body_bytes % 1 or not 0 <= body_bytes <= MAX_SAFE_INTEGER:
        return reject("invalid-request")
    if body_bytes > state["maxBodyBytes"]:
        return reject("capacity")
    ticket = request["requestId"]
    if ticket["epoch"] != state["epoch"]:
        return reject("request-expired")
    cached = next((entry for entry in state["cache"] if entry["request"]["requestId"] == ticket), None)
    if cached is not None:
        if cached["request"] == request:
            return {**reject("replay"), "receipt": deepcopy(cached["receipt"])}
        return reject("request-conflict")
    pending = next((entry for entry in state["pending"] if entry["request"]["requestId"] == ticket), None)
    if pending is not None:
        return reject("join" if pending["request"] == request else "request-conflict")
    if ticket["sequence"] < state["nextSequence"]:
        return reject("request-expired")
    if ticket["sequence"] > state["nextSequence"]:
        return reject("request-order")
    if (state["inFlight"] >= state["maxInFlight"] or state["queueDepth"] >= state["maxQueue"]
            or state["nextSequence"] >= MAX_SAFE_INTEGER or state["configurationRevision"] >= MAX_SAFE_INTEGER):
        return reject("capacity")
    failure = None
    if request["expectedConfigurationRevision"] != state["configurationRevision"]:
        failure = "revision-conflict"
    elif request["expectedGeneration"] != state["generation"]:
        failure = "stale-generation"
    elif not _supports(state["capabilities"], request["command"]):
        failure = "unsupported-capability"
    # A moment is transient: it changes no desired configuration, so it does not advance the revision.
    advances = not failure and request["command"]["kind"] != "moment"
    receipt = {"apiVersion": request["apiVersion"], "controllerId": request["controllerId"], "deviceId": request["deviceId"],
               "requestId": deepcopy(ticket), "configurationRevision": state["configurationRevision"] + (1 if advances else 0),
               "generation": deepcopy(state["generation"]), "outcome": "failed" if failure else "queued",
               "priorEffects": "none", "completedOperations": [], "uncertainOperations": []}
    if failure:
        receipt["failure"] = {"code": failure}
    return {"decision": failure or "queued", "reserved": True, "nextSequence": state["nextSequence"] + 1,
            "scheduled": 0 if failure else 1, "receipt": receipt}


def _batch_admit(value: dict[str, Any]) -> dict[str, Any]:
    state = deepcopy(value["state"])
    results = []
    for item in value["items"]:
        result = admit({**item, "state": state})
        results.append(result)
        if result["reserved"] and "receipt" in result:
            state["nextSequence"] = result["nextSequence"]
            state["configurationRevision"] = result["receipt"]["configurationRevision"]
            if result["scheduled"]:
                state["pending"].append({"request": deepcopy(item["request"])})
                state["inFlight"] += 1
                state["queueDepth"] += 1
            else:
                state["cache"].append({"request": deepcopy(item["request"]), "receipt": result["receipt"]})
                state["cache"] = state["cache"][-state["maxReceipts"]:]
    return {"results": results, "nextSequence": state["nextSequence"], "scheduled": sum(r["scheduled"] for r in results)}


def _feed(value: dict[str, Any]) -> dict[str, Any]:
    latest = value["snapshot"]["cursor"]
    cursor = value["cursor"]
    retained = (validate("ticket", cursor) and cursor["epoch"] == latest["epoch"]
                and (cursor == latest or any(event["cursor"] == cursor for event in value["events"])))
    if not retained or cursor["sequence"] > latest["sequence"]:
        return {"events": [{"apiVersion": "1.0", "kind": "resync", "cursor": deepcopy(latest), "snapshot": deepcopy(value["snapshot"])}], "effects": 0}
    events = [event for event in value["events"] if event["cursor"]["epoch"] == latest["epoch"]
              and cursor["sequence"] < event["cursor"]["sequence"] <= latest["sequence"]]
    return {"events": deepcopy(sorted(events, key=lambda event: event["cursor"]["sequence"])), "effects": 0}


def _clock(value: dict[str, Any]) -> dict[str, Any]:
    renderer = value["renderer"]
    if renderer is None or not validate("renderer", renderer):
        return {"status": "unknown"}
    if not any(p["profileId"] == renderer["profileId"] and p["profileVersion"] == renderer["profileVersion"] for p in value["supportedProfiles"]):
        return {"status": "unsupported"}
    received, now = value["receivedAtLocalMs"], value["nowLocalMs"]
    if (not value["fresh"] or renderer["clock"]["epoch"] != value["expectedClockEpoch"] or "deadlineMs" not in renderer
            or not math.isfinite(received) or not math.isfinite(now) or received < 0 or now < received):
        return {"status": "unknown"}
    return {"status": "known", "remainingMs": max(0, max(0, renderer["deadlineMs"] - renderer["clock"]["sampledAtMs"]) - (now - received))}


def _moment(value: dict[str, Any]) -> dict[str, Any]:
    """One device's moment precedence, as its single writer applies it. Alerts beat moments only on status
    presentation; a moment ends by returning to the base the device shows now, never to a saved one."""
    device = deepcopy(value["device"])
    steps = []
    starts = 0
    for event in value["events"]:
        receipts: list[dict[str, Any]] = []
        ended = None

        def at(at_ms: Any) -> dict[str, Any]:
            return {"domain": "controller-monotonic", "epoch": device["clockEpoch"], "atMs": at_ms}

        def end(ending: str) -> None:
            nonlocal ended
            current = device["current"]
            if current["status"] == "none":
                return
            # A moment that never started transmitted nothing; one that started keeps its sent receipt.
            if current["status"] == "scheduled":
                receipts.append({"requestId": deepcopy(current["requestId"]), "outcome": "cancelled"})
            ended = {"momentId": current["momentId"], "requestId": deepcopy(current["requestId"]), "ending": ending}
            device["last"] = {"status": "known", **deepcopy(ended), "endedAt": at(event["nowMs"])}
            device["current"] = {"status": "none"}

        def start() -> None:
            nonlocal starts
            current = device["current"]
            if current["status"] != "scheduled":
                return
            device["current"] = {"status": "playing", "momentId": current["momentId"], "requestId": current["requestId"],
                                 "mood": current["mood"], "priorityClass": current["priorityClass"],
                                 "coversStatus": current["coversStatus"], "endAt": at(event["nowMs"] + current["durationMs"])}
            receipts.append({"requestId": deepcopy(current["requestId"]), "outcome": "sent"})
            starts += 1

        kind, now = event["kind"], event["nowMs"]
        if kind == "deliver":
            command = event["command"]
            begin = command["start"]
            current = device["current"]

            def drop(failure: str) -> None:
                receipts.append({"requestId": deepcopy(event["requestId"]), "outcome": "failed", "failure": failure})

            if command["momentId"] in device["recentMomentIds"]:
                drop("moment-duplicate")
            else:
                device["recentMomentIds"] = (device["recentMomentIds"] + [command["momentId"]])[-MOMENT_MEMORY:]
                if (begin["epoch"] != device["clockEpoch"] or now > begin["atMs"] + begin["toleranceMs"]
                        or begin["atMs"] > now + MOMENT_MAX_LEAD_MS):
                    drop("moment-missed")
                elif (device["presentation"] == "quiet"
                      or (device["presentation"] == "status" and (not command["coversStatus"] or device["alert"] != "none"))
                      or (current["status"] != "none" and current["priorityClass"] == "event"
                          and command["priorityClass"] == "flourish")):
                    drop("moment-blocked")
                else:
                    end("superseded")
                    device["current"] = {"status": "scheduled", "momentId": command["momentId"],
                                         "requestId": deepcopy(event["requestId"]), "mood": command["mood"],
                                         "priorityClass": command["priorityClass"], "coversStatus": command["coversStatus"],
                                         "startAt": at(begin["atMs"]), "durationMs": command["durationMs"]}
                    if begin["atMs"] <= now:
                        start()
        elif kind == "tick":
            current = device["current"]
            if current["status"] == "scheduled" and now >= current["startAt"]["atMs"]:
                start()
            elif current["status"] == "playing" and now >= current["endAt"]["atMs"]:
                end("completed")
        elif kind == "alert":
            device["alert"] = event["alert"]
            if device["presentation"] == "status" and device["alert"] != "none":
                end("preempted")
        elif kind == "base":
            device["base"] = event["base"]
        elif kind == "mode":
            end("interrupted")
            device["presentation"], device["base"] = event["presentation"], event["base"]
        elif kind == "command":
            end("interrupted")
        elif kind == "restart":
            # A new clock epoch has no continuity: nothing resumes, replays or carries over.
            device.update({"clockEpoch": event["clockEpoch"], "presentation": event["presentation"], "base": event["base"],
                           "alert": event["alert"], "current": {"status": "none"}, "last": {"status": "none"},
                           "recentMomentIds": []})
        else:
            raise ValueError("Unknown moment event")
        if device["presentation"] == "status" and device["alert"] != "none":
            showing = "alert"
        elif device["current"]["status"] == "playing":
            showing = "moment"
        else:
            showing = "base"
        steps.append({"showing": showing, "base": device["base"],
                      "momentId": device["current"]["momentId"] if showing == "moment" else None,
                      "receipts": receipts, "ended": ended})
    return {"steps": steps, "device": device, "starts": starts}


def downgrade_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """The 1.0 view a 1.1 controller serves to a 1.0 reader: moment content is omitted, never misrepresented."""
    result = deepcopy(snapshot)
    result["apiVersion"] = "1.0"
    del result["capabilities"]["moments"]
    state = result["state"]
    del state["moment"]
    state["pending"] = [entry for entry in state["pending"] if entry["command"]["kind"] != "moment"]
    outcome = state["lastOutcome"]
    if outcome["status"] == "known" and outcome["receipt"]["apiVersion"] == "1.1":
        state["lastOutcome"] = {"status": "unknown"}
    return result


def evaluate(value: dict[str, Any]) -> Any:
    """Owner state is trusted and validated; request, cursor, and renderer are checked here."""
    operation = value["operation"]
    if operation == "authorize":
        return authorize(value)
    if operation == "admit":
        return admit(value)
    if operation == "batch-admit":
        return _batch_admit(value)
    if operation == "dequeue":
        if value["expectedGeneration"] == value["currentGeneration"]:
            return {"decision": "send-permitted", "priorEffects": value["priorEffects"], "scheduled": 1}
        return {"decision": "cancelled", "failure": "stale-generation", "priorEffects": value["priorEffects"], "scheduled": 0}
    if operation == "feed":
        return _feed(value)
    if operation == "project":
        event, snapshot = value["event"], value["snapshot"]
        replace = (event["kind"] == "resync" or event["cursor"]["epoch"] != snapshot["cursor"]["epoch"]
                   or event["cursor"]["sequence"] > snapshot["cursor"]["sequence"])
        return {"snapshot": deepcopy(event["snapshot"] if replace else snapshot), "effects": 0}
    if operation == "clock":
        return _clock(value)
    if operation == "moment":
        return _moment(value)
    if operation == "downgrade":
        return {"snapshot": downgrade_snapshot(value["snapshot"]), "effects": 0}
    if operation == "read":
        return {"snapshot": deepcopy(value["snapshot"]), "effects": 0}
    if operation == "sample":
        return {"snapshot": {**deepcopy(value["snapshot"]), "sampleClock": deepcopy(value["sampleClock"]), "serviceHealth": value["serviceHealth"]}, "effects": 0}
    raise ValueError("Unknown reference operation")
