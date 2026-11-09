## ADDED Requirements

### Requirement: The owner shows saved art on demand
The core SHALL answer `art-show/2.0` on `bunny.cmd.art-show.hub` only for a command the tracked dispatcher admitted, as it admits the Hub mode, from any caller with `control`; any other sender SHALL be refused with `forbidden` and a subject other than `hub` with `not-found`. The command SHALL name one saved artwork, one to three targets among the configured art displays and `browser`, and an optional `coversStatus`, default true. Before replying, the core SHALL refuse an artwork outside the art owner's current published record with `not-found`, a target that is not a configured art display with `not-found`, a target whose artwork has no usable composition for its kind with `unsupported-capability`, and a show while another owner show is still preparing with `capacity`; a refused target SHALL be skipped while the others proceed, and when no target remains the command SHALL be refused with the first target's code and nothing sent. An accepted show SHALL run the existing art plan path with a common start 20 seconds after acceptance, the schedule's tolerance and preparation cutoff, `priorityClass` `event`, the request's `coversStatus`, 10 seconds on a Pixoo and 30 seconds on a Tidbyt, preparation through the existing art-stage forwarding, one `moment-play/2.1` with the exact composition per display and one browser present, each surface independently tracked under the show's trace. It SHALL start no generation and change no device mode. The show's own operation SHALL complete `succeeded` with `observed` once each surface was handed off or skipped and at least one was sent, and `failed` with the skipped surface's code when none was; it SHALL never be retried, and a restart before completion SHALL leave unfinished operations to their deadlines.

#### Scenario: A show reaches every surface
- **WHEN** the owner shows a saved artwork with Pixoo, Tidbyt and browser compositions on the configured Pixoo, the configured Tidbyt and `browser`
- **THEN** each display gets one preparation and one moment operation and the browser one present, each tracked separately
- **AND** the Pixoo moment carries the exact composition and 10000 ms, the Tidbyt moment 30000 ms, both at the common start 20 seconds after acceptance

#### Scenario: Refusals send nothing
- **WHEN** a show names an unknown artwork, names only a target without a composition, arrives while another show prepares, or reaches the core without dispatcher admission or from a caller without `control`
- **THEN** it is refused with `not-found`, `unsupported-capability`, `capacity` or `forbidden` and no preparation, moment or present is sent

#### Scenario: A display refusal fails that surface alone
- **WHEN** a display refuses the moment because a paused item or attention holds it, or a display is offline or held
- **THEN** that surface reports its own failure or `unavailable` and the other surfaces keep their independent outcomes

### Requirement: Owner shows bypass schedule policy without using it up
An owner show SHALL pass quiet hours, the global budget, device spacing, `noFlourishes` and the art schedule's enabled targets and browser setting, and SHALL still be refused for every unsent surface while attention is raised. Holds, availability, external control, pins, Now Playing and each device's admission SHALL still decide through the existing presentation path. A show SHALL claim no schedule opportunity, reserve no moment, and leave the schedule's daily claimed count, spacing watermark, latest attempt and next appearance unchanged. Each surface SHALL be appended to the automation log as an `art-show` attempt with origin `owner` and `priorityClass` `event`, naming its tracked request ID when one was sent or its refusal code when not, so Recent attempts lists it beside rule and routine attempts and no flourish budget or spacing counts it. The art input SHALL read the art owner's record for a show even while the schedule is disabled.

#### Scenario: A show inside quiet hours after the day's appearances
- **WHEN** the owner shows saved art during quiet hours after the schedule has claimed all of the day's appearances
- **THEN** the show runs and each surface is logged with origin `owner`
- **AND** the schedule's claimed count, spacing watermark, latest attempt and next appearance are what they were before, and its next appearance still runs as planned

#### Scenario: Attention holds a show
- **WHEN** attention is raised before a show's surfaces are sent
- **THEN** each unsent surface is refused and logged with its code, and nothing retries it

### Requirement: Owner shows are available to MCP and authenticated reads
The gateway SHALL contribute the control-scope MCP tool `core_art_show`, which sends the same `art-show` command with the same payload and answers with the dispatcher's refusal or `accepted`, the request ID and each surface's tracked request identities, derived as the core derives them. A read-scope `GET /api/v2/automation/art/targets` SHALL list each configured art display's routing ID and kind, without availability or device state.

#### Scenario: An agent shows art through MCP
- **WHEN** a control credential calls `core_art_show` for a saved artwork and two surfaces
- **THEN** the result names the show's request ID and each surface's preparation and moment or present request IDs, whose operation records hold the outcomes
- **AND** a reader credential cannot list or call the tool
