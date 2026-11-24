## MODIFIED Requirements

### Requirement: Permitted tools from the runtime

The companions module SHALL discover the tools a turn may call from its own static catalog and filter them by the private section's allowlist, checking membership again when a call executes, so a changed section cannot widen an effect. The built-in owner question is always available; the synthetic fixture read exists only for the synthetic provider. The device tools SHALL use admitted LIFX device records and the registered power and brightness commands. `read_sessions` SHALL read each session through the contracts package's shared session read function and report its shared status class and detail. Device and catalog tools SHALL be offered to the `bunny` profile only ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)): the `reachy` and `microduck` profiles SHALL be offered only the allowlisted tools that are neither, such as `read_sessions`, `set_mode` and `delegate_coding`, each command still needing the owner's approval, and a call to a tool its profile is not offered SHALL be refused as one outside the allowlist. Whether the companions get device or catalog tools is a later decision. The dashboard SHALL show, for the open profile, the tools its model is offered, the allowlisted tools it is not offered, labelled as B.U.N.N.Y.'s only, and the unavailable tools, and grant nothing. `delegate_coding` SHALL propose handing one bounded coding task, named by an allowlisted repository and a brief, to the coding worker; without a connected worker, or with an unusable repository name or brief, the call SHALL be refused as a tool result and nothing proposed.

#### Scenario: Read tool
- **WHEN** the model calls `read_sessions`
- **THEN** the result lists current sessions with provider, display label, status class and detail, work confirmation and attention from the module's synced copy, bounded in size, and no session text beyond the allowed display metadata

#### Scenario: Tool outside the allowlist
- **WHEN** the model calls a tool the section does not list, or the section changes between proposal and execution
- **THEN** the call is refused to the model with no effect, and the task continues or ends truthfully

#### Scenario: Delegation without a worker
- **WHEN** the model calls `delegate_coding` while no coding worker endpoint is available
- **THEN** the call ends as a tool result saying no worker is connected, no proposal is made and the owner is not asked

#### Scenario: Companion tool scope
- **WHEN** the allowlist names `read_sessions`, a device tool and a catalog tool, and Reachy, MicroDuck and B.U.N.N.Y. each run a turn on the configured model
- **THEN** Reachy's and MicroDuck's turns are offered `ask_owner` and `read_sessions` only, B.U.N.N.Y.'s every listed tool, and Details on a companion lists `read_sessions` as allowed and the device and catalog tools as B.U.N.N.Y.'s only

### Requirement: Spoken replies to typed requests

When a task turn ends with a result, a question for the owner or a refusal, the companions module SHALL offer that saved message once to its speech coordinator, after the message is durable, under the message's own identity. A `speak` control naming a task and a saved assistant message SHALL offer that message again under the request's identity; it SHALL refuse owner or tool text and an unknown message, SHALL work for finished tasks, and SHALL be idempotent per request. A message longer than 512 characters SHALL stay written only. Startup reconciliation SHALL offer nothing, and a failed offer SHALL NOT change the task's outcome. The spoken voice SHALL be the installation's qualified local voice regardless of the model provider, and stopping speech SHALL NOT answer a question or cancel the task. A profile whose persona audio is quacks only, MicroDuck, SHALL have its English text kept as its intended meaning and never spoken ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)): its turn-ending messages SHALL NOT be offered, a `speak` control naming one of its messages SHALL be refused with `invalid-request` and fixed text that names no profile, and the page SHALL show that its text is intended meaning in place of Read aloud. The engine and the page SHALL read this rule from the persona's audio, never from a profile name, and SHALL treat an unknown profile as not spoken. The Spoken replies panel SHALL say that B.U.N.N.Y.'s and Reachy's replies are spoken and MicroDuck's never are.

#### Scenario: Turn-ending messages are spoken once
- **WHEN** spoken replies are enabled and a typed request produces a question, then an answer produces a result
- **THEN** the question and the result are each spoken once through the reserved endpoint with the saved text, and a restart between them speaks nothing

#### Scenario: Speak replays a saved answer
- **WHEN** the owner activates Read aloud beside a saved assistant message
- **THEN** one accepted control receipt is recorded, the message is spoken again as its own utterance, a repeated request id speaks nothing more, and a direct speak request for owner text or an unknown message is refused

#### Scenario: Stop without cancellation
- **WHEN** the owner stops speech while a question is being spoken
- **THEN** the audio stops, the task stays waiting for its answer, and Quiet mode keeps the next reply written only

#### Scenario: MicroDuck is never spoken in English
- **WHEN** spoken replies are enabled and a MicroDuck task ends with a result, then the owner asks to hear that message, and a Reachy task ends with the same text
- **THEN** MicroDuck's message stays written with the intended-meaning note and nothing is offered to the voice, the `speak` request is refused with `invalid-request`, and Reachy's message is offered once and can be replayed
