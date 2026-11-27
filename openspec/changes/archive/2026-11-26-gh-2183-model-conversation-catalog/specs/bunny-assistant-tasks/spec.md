## ADDED Requirements

### Requirement: Model-interpreted Conversation catalog

Either registered supervisor SHALL receive the configured tools for the supported Conversation catalog. A migrated action SHALL remain bound to the current authenticated request, an eligible registered owner and target, the validated settings and the existing owner revision or generation. The Hub SHALL preserve existing approvals and field-specific sharing. A private draft mutation SHALL use its guarded revision and SHALL send no device command.

#### Scenario: A catalog operation uses a current owner request

- **WHEN** the owner asks for a supported operation and the supervisor supplies a unique target and valid settings
- **THEN** the Hub sends the existing guarded owner command through the tracked dispatcher once
- **AND** the private result follows the owner's existing evidence contract

#### Scenario: Device availability follows the registered owner rule

- **WHEN** a catalog request targets an unavailable device
- **THEN** the tracked dispatcher applies the registered owner's availability rule to the guarded command
- **AND** eligible owner-local changes such as Pixoo Now Playing and Moments preferences can be admitted
- **AND** a physical action requiring availability is refused, and an active hold refuses these preference and physical writes

#### Scenario: A Hub mode answer belongs to a question about switching

- **WHEN** the current owner asks to switch Hub mode without naming a mode
- **THEN** the supervisor can ask the Hub to render and save a question about which mode to switch to
- **AND** a short mode answer can complete that same request after restart while the request and Hub mode revision are current
- **AND** a short answer to a generic or informational question sends no mode command
- **AND** a complete current owner instruction naming the requested mode can dispatch directly

#### Scenario: A hosted catalog proposal cites the current target words

- **WHEN** the hosted supervisor proposes a catalog effect against an existing target
- **THEN** the selected supervisor cites verbatim target selections and exclusions in the current authenticated owner request or clarification, with their primary or nested roles
- **AND** the Hub checks each cited source and resolves current named targets in their owner-local permitted records before dispatch
- **AND** absent, inaccessible, ambiguous or conflicting named targets send no command and require clarification

#### Scenario: Visible command-capable devices share a label across owners

- **WHEN** a current target name matches visible devices under different owners for the requested command
- **THEN** the Hub requires a current exact ID or an owner-qualified name, or asks for clarification before dispatch
- **AND** a model-supplied owner alone cannot resolve the collision
- **AND** hidden devices are excluded before matching and their absence does not change the visible result

#### Scenario: The owner selects one target and excludes another

- **WHEN** the current request selects one named target and rules out another
- **THEN** the Hub resolves the selected target and rejects an excluded canonical target
- **AND** a missing selection sends no command, even when the excluded target exists
- **AND** a unique authorized selection with valid settings can dispatch directly

#### Scenario: Earlier context identifies a genuine reference

- **WHEN** a current target phrase refers back to an eligible record in the same conversation
- **THEN** eligible prior context may identify that record for the cited role
- **AND** a pronoun in another instruction cannot replace an absent or conflicting name in the current selection

#### Scenario: The owner asks for the last scene they activated on a light

- **WHEN** the current request names an eligible light and refers to its last scene activation
- **THEN** the Hub checks tracked activation order across callers for that light and selects the latest successful activation only when its scene has eligible owner-backed evidence
- **AND** it asks which saved scene to use if a newer activation has an unresolved outcome or eligible evidence is missing or conflicts
- **AND** the Hub rechecks the receipt identity and permission after reading the tracker and confirms that the same receipt is still current before admitting the command
- **AND** the normal sharing, capability and revision checks still apply
- **AND** a receipt of transmission establishes no physical effect

#### Scenario: A hold release cites an operation

- **WHEN** the current request cites an operation for a held device
- **THEN** a selected operation must match the current hold, even if the supervisor omits the operation ID from its command arguments
- **AND** an explicitly excluded operation cannot be released
- **AND** an authorized request to release the current hold may leave the operation unspecified

#### Scenario: A stale draft edit or invalid target is proposed

- **WHEN** the supervisor proposes a stale draft revision, an invalid target, or a target whose permission has changed
- **THEN** the Hub sends no device command and leaves the affected draft unchanged

#### Scenario: A stored scene or original is requested by name

- **WHEN** the current owner asks to activate a saved Nanoleaf scene on an eligible light or change an original Pixoo asset by name
- **THEN** Companions resolves the name through the selected owner and binds its opaque ID before using the existing tracked command
- **AND** private catalog names and records remain out of the hosted supervisor's results
- **AND** an ambiguous match prompts for clarification and sends no command
