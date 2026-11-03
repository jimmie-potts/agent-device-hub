## MODIFIED Requirements

### Requirement: Device state family

The profile SHALL define `device`, a state family registered under `https://bunny.invalid/events/device/2.0` and sent as `org.bunny.device.updated`, whose message carries the full record of one device and whose envelope subject is the device `id`. The module that controls the device SHALL publish it. The record SHALL carry:
- the device's `id`, a routing ID because it is also the device's routing-key token, unique across modules, its `revision` and kebab-case `kind`, and an optional owner label with the session family's display-text checks;
- `availability`: `unknown`, `available`, `degraded` or `unavailable`, where `unavailable` means the module cannot reach the device;
- the `configurationRevision` and the `generation` ticket that commands guard on;
- capabilities for power, brightness, native modes, moments, media, scenes, zones and preview, each `{supported: false}` or `{supported: true}` with its constraints, none optional;
- `desired` power, brightness and native mode, each a tagged unknown or known value;
- `observed`: unknown, or known with its evidence time `observedAtMs` and tagged power and brightness;
- the `pending` command count and `pendingKinds`, the command families among them, each once;
- the `lastOutcome` as the profile's outcome payload or unknown;
- `lastTransmission`: unknown, or the last send that reached the device's transport with its time `transmittedAtMs`, the operation IDs it sent and, when it served a command, its `requestId`;
- `externalControl`: unknown, or owned by the module or an external party with its evidence time.

A module SHALL set `lastTransmission` for every transmitted send, including paints it makes itself, which never reach the tracker. A known desired mode SHALL be one the device advertises. An observation, external-control reading or transmission after the envelope `time` SHALL be refused, and so SHALL pending kinds that are empty while commands are pending or outnumber them. No device record SHALL carry an address, credential, private path or the Hub's mode. Missing evidence SHALL be a tagged unknown, never `false` or off, and a transport acknowledgment SHALL NOT be reported as an observation.

The family's minor version 2.1 (Hub #975), registered under `https://bunny.invalid/events/device/2.1` beside 2.0 and sent with the same type, SHALL be the 2.0 record with one more optional member, `held`, and SHALL keep every 2.0 rule. `held` SHALL be present exactly while the module holds the device after a write that may have reached it but went unanswered, which ADR 0012 never retries. It SHALL carry the `requestId` of the operation whose uncertain write holds the device, and `heldAtMs`, when the hold began, and nothing else. The module SHALL omit it once it releases the hold, after a person's later command to the device or a later definitive outcome for that operation. A hold that begins after the envelope `time` SHALL be refused, and so SHALL a held device that is `available`. `device/2.0` SHALL stay registered and unchanged, so a record without `held` stays valid under either version, and a `device/2.0` record that carries `held` SHALL be refused. Each producer SHALL choose one version for its records.

The family's minor version 2.2 (Hub #679), registered under `https://bunny.invalid/events/device/2.2` beside 2.0 and 2.1 and sent with the same type, SHALL be the 2.1 record with one more optional member, `capabilities.moments.art`: a closed object with `formats`, one or both of `png` and `gif`, and `maxBytes`, from 1 to 163,840. Versions 2.0 and 2.1 SHALL keep refusing it.

#### Scenario: Valid device records
- **WHEN** an available Nanoleaf wall, a degraded Pixoo and an unreachable LIFX device with an old observation are validated
- **THEN** each is accepted, the unreachable device keeps its last observation with its evidence time, and its later transmission, a paint with no request, stays apart from that observation

#### Scenario: Device record rules
- **WHEN** a record has an `id` with a dot, an uppercase letter, an underscore or more than 128 characters, omits any one of the eight capabilities, gives an unsupported capability constraints or brightness another range than 0 to 100, lacks the core moods for supported moments, desires a mode it does not advertise, carries an observation without its evidence time or after the message time, a transmission after the message time or with an observed value, pending kinds that disagree with the pending count, a pending count over 1,024, a label over 80 characters, an address or a token, uses 1.x service health or controller ownership, or is sent under another subject, kind or type
- **THEN** it is refused with `invalid-message` and a detail naming where

#### Scenario: A held device record
- **WHEN** a degraded Nanoleaf wall whose `held` names the request of a lost brightness write and the time the hold began is validated as `device/2.1`, and the 2.0 fixtures are validated as `device/2.1` without `held`
- **THEN** each is accepted, the 2.0 fixtures stay valid as `device/2.0`, and a record at a version the profile does not register, such as `device/2.3`, is refused with `unsupported-version`

#### Scenario: Held record rules
- **WHEN** a `device/2.1` record's `held` lacks its `requestId` or `heldAtMs`, carries another member, a request ID that is not an identifier or a boolean in place of the object, begins after the message time, or belongs to an `available` device, or a `device/2.0` record carries `held`
- **THEN** it is refused with `invalid-message` and a detail naming where

#### Scenario: Version 2.1 is 2.0 plus `held`
- **WHEN** the 2.1 schema is compared with the 2.0 schema without `held`, its `$id` and its description
- **THEN** they are equal, and both versions register through `registerDeviceFamilies`

#### Scenario: A device declares art
- **WHEN** a `device/2.2` record declares `moments.art`, and the same record is labelled `device/2.0` or `device/2.1`
- **THEN** the first is accepted and the others are refused, and every released 2.0 and 2.1 record stays valid when labelled 2.2

## ADDED Requirements

### Requirement: Exact-artwork command families

The profile SHALL define the command families `art-request` (`org.bunny.art.request.requested`), `art-auto` (`org.bunny.art.auto.requested`), `art-dispatch` (`org.bunny.art.dispatch.requested`), `art-stage` (`org.bunny.art.stage.requested`) and `art-ambient-set` (`org.bunny.art-ambient.set.requested`), each at version 2.0 and registered with the core families. Payloads SHALL be closed, and none SHALL have a member for a location, path or credential.

`art-request` and `art-auto` SHALL have the subject `art`, and each SHALL start a job or cancel one by `jobRequestId`. A start SHALL carry `purpose`, `origin` and `targets`, and may carry `context` as bounded condition words and `variationOf`, exactly when the purpose is `variation`. Only `art-request` SHALL carry typed `text`, at most 2,000 characters, not blank and in Unicode scalar values. An owner label in `art-auto`'s `origin` or `purpose` SHALL validate, because the command family decides whose job it is.

`art-stage` SHALL have a device as its subject and carry `requestId`, `compositionId`, `format` (`png` or `gif`), `width`, `height`, `frames`, `durationMs`, `sha256`, `base64` of at most 160 KiB decoded, and `lifetimeMs`. The validator SHALL refuse bytes that are not canonical base64, are over that size, or disagree with `sha256`, `format`, `width` or `height`, reading only their headers. A PNG SHALL have one frame and duration 0, and several frames SHALL have a non-zero duration. `art-ambient-set` SHALL have a device as its subject and name a `compositionId` or null to clear it.

`art-dispatch` SHALL have the subject `art` and carry `requestId`, `target`, and `family` with its `data`, which is that family's payload without `requestId`. Its family SHALL be `art-stage` or `art-ambient-set` only.

The package SHALL export `artStageDecision` and `artReferenceRefusal` for a device's private copy, and `artStageSupported` for a stage against `moments.art`.

#### Scenario: The largest stage fits
- **WHEN** a stage of exactly 160 KiB decoded, and its dispatch, are validated, and a stage one byte larger is validated
- **THEN** the first two are accepted and each fits the 256 KiB message cap, and the third is refused

#### Scenario: Bytes that are not what the stage says
- **WHEN** a stage's bytes disagree with its hash, format or dimensions, or are not canonical base64
- **THEN** the validator refuses it with no image decoder

#### Scenario: A dispatch cannot name a moment
- **WHEN** an `art-dispatch` names `moment-play` or `art-auto`
- **THEN** the validator refuses it

#### Scenario: A device's private copy
- **WHEN** a device stages a composition, stages the same ID and hash again, stages the same ID with another hash, and refers to an unknown or expired composition
- **THEN** the first stores the copy, the second reuses it and renews its lifetime, the third is `duplicate-conflict` with the copy unchanged, and the references are `not-found` and `expired` before any transport

#### Scenario: Expiry during a moment
- **WHEN** a composition's lifetime passes while a moment that admitted it is under way
- **THEN** the moment keeps its copy, a later moment's reference is refused and the first show is not repeated

### Requirement: Moment with an exact composition

The family `moment-play` SHALL also register at `https://bunny.invalid/events/moment-play/2.1`, with the same type and rules, as the 2.0 schema with one more optional member, `art: {compositionId}`, closed. `moment-play/2.0` SHALL keep refusing `art`. `commandSupported` SHALL refuse a moment with `art` for a device that does not declare `moments.art`, and SHALL keep its behavior for a moment without `art`.

#### Scenario: A device without art refuses
- **WHEN** a moment names `art` and its mood is one the device supports, and the device's record has no `moments.art`
- **THEN** `commandSupported` answers false, so the device refuses with `unsupported-capability` and does not play its mood
