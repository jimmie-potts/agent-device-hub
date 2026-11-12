## ADDED Requirements

### Requirement: Bookkeeping members of state families

Each state family SHALL declare its bookkeeping members (Hub #1771): the members that may change while the state the record describes does not, such as a reading, paint or update time. A declaration SHALL be by family, not by version, as JSON pointers to object members at any depth, beside the family's schema: the contracts package's `v2/bookkeeping` for the families it defines, and a module's registration for the module's own families. A family with no bookkeeping member SHALL declare an empty list, which is a deliberate answer that every member counts. The declaration SHALL be metadata only: it SHALL change no message, schema, payload, wire value or validation result, and SHALL NOT be a family version.

A pointer SHALL be refused unless it names an object member, never an array position, whose schema positively declares a single value in every registered version of the family and in every alternative, found through `$ref`, `allOf`, `oneOf` and `anyOf`: a scalar `type`, or a `const` or `enum` of scalars. An unconstrained schema, any keyword beyond scalar types, their bounds, notes and those compositions, and alternatives that mix a value with a `const` or `enum` SHALL be refused. A pointer through `__proto__`, `constructor` or `prototype` SHALL be refused. A pointer SHALL be refused when any of its members is one that is never bookkeeping: `id`, `revision`, `availability`, `generation`, `configurationRevision`, `held`, `status`, `power`, `brightness`, `desired`, `pending`, `pendingKinds`, `lastOutcome`, `requestId`, `operationIds`, `enabled`, `durationMs`, `settingsRevision`, `startedAtMs`, `deadlineMs`, `lastAttempt`, `showing`, `freshness` or `failing`. A settings family (`mode`, the lighting, playback and home layouts, `art-schedule`, `preference-state`, `pixoo-playlist` and the Nanoleaf animations, reactive presets and shows) SHALL declare none. Two records of one family SHALL hold the same state when they are equal once the value of each bookkeeping member that is present and not null, and of `id` and `revision`, is set aside. A bookkeeping member that is absent, null or holds a value SHALL be three different states, so its appearing, disappearing or becoming null is a change and only its value never counts. A change of any other leaf alone SHALL make them differ.

The declared members SHALL be: `device` `/observed/observedAtMs`, `/lastTransmission/transmittedAtMs` and `/externalControl/observedAtMs`; `power-limit` `/observedAtMs` and `/updatedAtMs`; `playback` `/observedAtMs`; `pixoo-display` `/monitor/page`; `roborock-vacuum` `/observedAtMs/value`; and `lifx-light` `/observed/observedAtMs`. Every other state family, `session` included, SHALL declare none.

#### Scenario: Every state family is classified
- **WHEN** the tests compare a checked-in classification of every state family and version of the core and of every registered module with the families the contracts package and the registrations define, and with the declarations
- **THEN** each state family and version is listed with exactly its declared members, and a family or version added without an entry fails

#### Scenario: A member that is never bookkeeping
- **WHEN** a declaration names a member that is never bookkeeping, at the top, nested, or as the parent of another member
- **THEN** it is refused and the refusal names that member

#### Scenario: A pointer the schema does not declare
- **WHEN** a declaration names a member that some version of the family's schema does not declare, an array position, a member that holds other members, a member whose schema does not positively declare a scalar in every alternative, or a member that mixes a value with a state enumeration
- **THEN** it is refused

#### Scenario: Every other leaf still counts
- **WHEN** each leaf of a declared family's fixture record that is not a bookkeeping member, `id` or `revision` is changed alone
- **THEN** the changed record does not hold the same state as the fixture, nor does one in which a bookkeeping member became null or absent, and a record whose only changes are the values of its bookkeeping members does
