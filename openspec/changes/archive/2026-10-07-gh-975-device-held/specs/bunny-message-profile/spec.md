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

#### Scenario: Valid device records
- **WHEN** an available Nanoleaf wall, a degraded Pixoo and an unreachable LIFX device with an old observation are validated
- **THEN** each is accepted, the unreachable device keeps its last observation with its evidence time, and its later transmission, a paint with no request, stays apart from that observation

#### Scenario: Device record rules
- **WHEN** a record has an `id` with a dot, an uppercase letter, an underscore or more than 128 characters, omits any one of the eight capabilities, gives an unsupported capability constraints or brightness another range than 0 to 100, lacks the core moods for supported moments, desires a mode it does not advertise, carries an observation without its evidence time or after the message time, a transmission after the message time or with an observed value, pending kinds that disagree with the pending count, a pending count over 1,024, a label over 80 characters, an address or a token, uses 1.x service health or controller ownership, or is sent under another subject, kind or type
- **THEN** it is refused with `invalid-message` and a detail naming where

#### Scenario: A held device record
- **WHEN** a degraded Nanoleaf wall whose `held` names the request of a lost brightness write and the time the hold began is validated as `device/2.1`, and the 2.0 fixtures are validated as `device/2.1` without `held`
- **THEN** each is accepted, the 2.0 fixtures stay valid as `device/2.0`, and a record at a version the profile does not register, such as `device/2.2`, is refused with `unsupported-version`

#### Scenario: Held record rules
- **WHEN** a `device/2.1` record's `held` lacks its `requestId` or `heldAtMs`, carries another member, a request ID that is not an identifier or a boolean in place of the object, begins after the message time, or belongs to an `available` device, or a `device/2.0` record carries `held`
- **THEN** it is refused with `invalid-message` and a detail naming where

#### Scenario: Version 2.1 is 2.0 plus `held`
- **WHEN** the 2.1 schema is compared with the 2.0 schema without `held`, its `$id` and its description
- **THEN** they are equal, and both versions register through `registerDeviceFamilies`
