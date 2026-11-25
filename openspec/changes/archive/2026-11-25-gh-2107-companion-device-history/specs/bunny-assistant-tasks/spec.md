## ADDED Requirements

### Requirement: Bounded device history in Conversation

Conversation SHALL offer supported sources and read operations from the shared device contracts and check current destination grants when returning retained evidence. The core SHALL provide a versioned bounded read over its own history and open observation spans with one device identity and one half-open interval. The read SHALL return on, off and unknown durations and evidence identities, distinguish gaps and removals, and carry observed power through confirmed metadata-only deltas. A link SHALL identify the tracked request, successful transmission and later matching observation as distinct evidence, without claiming exclusive cause. Clock conversion for local yesterday SHALL use the configured time zone. A Conversation cursor SHALL bind its task, destination, normalized query and captured evidence boundary. A stale or foreign cursor SHALL be refused and a denied operation SHALL expose no request link.

#### Scenario: Power history on a local day

- **WHEN** the owner asks about an allowed device's observed power yesterday across a daylight-saving change, a gap or a removal
- **THEN** duration totals partition the actual local day and unknown time remains visible

#### Scenario: Evidence pages and causes

- **WHEN** a bounded result needs multiple pages
- **THEN** Conversation returns whole rows from the captured evidence boundary and rechecks the grants on every page
- **AND** a send without observed effect, or competing possible causes, supports no unique causal claim

#### Scenario: An OpenAI supervisor answers an explicit history request

- **WHEN** the owner asks about one exact Wemo plug or LIFX light over a resolved interval and the current local and OpenAI grants allow its summary
- **THEN** the supervisor receives only the requested device's bounded duration totals or last observed change, with incomplete coverage identified
- **AND** raw observations, evidence and operation identifiers, links and cursors stay private
- **AND** an ambiguous or mismatched query returns no retained facts, and a revoked grant prevents a saved summary from reaching another provider turn or title call
