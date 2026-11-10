## MODIFIED Requirements

### Requirement: The owner shows saved art on demand
The core SHALL answer `art-show/2.0` on `bunny.cmd.art-show.hub` only for a command the tracked dispatcher admitted, as it admits the Hub mode, from any caller with `control`; any other sender SHALL be refused with `forbidden`, and the gateway SHALL refuse a target other than `hub` with `not-found` before dispatch. The command SHALL name one saved artwork, one to three targets among the configured art displays and `browser`, and an optional `coversStatus`, default true. Before replying, the core SHALL look the artwork up in the art owner's current published record and, when it is not there, in the art owner's retained catalog, read once for that command with a bounded wait, newest first, until the artwork or the last page. It SHALL refuse an artwork in neither with `not-found`, a catalog that cannot be read within the bound or that returns a malformed or non-advancing page with `unavailable`, a target that is not a configured art display with `not-found`, a target whose artwork has no usable composition for its kind with `unsupported-capability`, and a show while another owner show is still preparing with `capacity`; a refused target SHALL be skipped while the others proceed, and when no target remains the command SHALL be refused with the first target's code and nothing sent. An accepted show SHALL run the existing art plan path with a common start 20 seconds after acceptance, the schedule's tolerance and preparation cutoff, `priorityClass` `event`, the request's `coversStatus`, 10 seconds on a Pixoo and 30 seconds on a Tidbyt, preparation through the existing art-stage forwarding, one `moment-play/2.1` with the exact composition per display and one browser present, each surface independently tracked under the show's trace. It SHALL start no generation and change no device mode. The show's own operation SHALL complete `succeeded` with `observed` once each surface was handed off or skipped and at least one was sent, and `failed` with the skipped surface's code when none was; it SHALL never be retried, and a restart before completion SHALL leave unfinished operations to their deadlines.

#### Scenario: A show reaches every surface
- **WHEN** the owner shows a saved artwork with Pixoo, Tidbyt and browser compositions on the configured Pixoo, the configured Tidbyt and `browser`
- **THEN** each display gets one preparation and one moment operation and the browser one present, each tracked separately
- **AND** the Pixoo moment carries the exact composition and 10000 ms, the Tidbyt moment 30000 ms, both at the common start 20 seconds after acceptance

#### Scenario: Retained art past the published record is shown
- **WHEN** the owner shows an artwork that the art owner retains but that is not among the published record's most recent artworks
- **THEN** the core reads it from the art owner's catalog and runs the same plan with that artwork's exact compositions
- **AND** an artwork in the published record is shown without reading the catalog

#### Scenario: An unreadable catalog sends nothing
- **WHEN** a show names an artwork outside the published record and the art owner's catalog refuses the read, returns a malformed page or does not answer within the bound
- **THEN** the show is refused with `unavailable` and no preparation, moment or present is sent

#### Scenario: Refusals send nothing
- **WHEN** a show names an artwork the art owner does not retain, names only a target without a composition, arrives while another show prepares, or reaches the core without dispatcher admission or from a caller without `control`
- **THEN** it is refused with `not-found`, `unsupported-capability`, `capacity` or `forbidden` and no preparation, moment or present is sent

#### Scenario: A display refusal fails that surface alone
- **WHEN** a display refuses the moment because a paused item or attention holds it, or a display is offline or held
- **THEN** that surface reports its own failure or `unavailable` and the other surfaces keep their independent outcomes
