## ADDED Requirements

### Requirement: Bounded device history in Conversation

Conversation SHALL offer supported sources and read operations from the shared device contracts and check current destination grants when returning retained evidence. The core SHALL provide a versioned bounded read over its own history and open observation spans with one device identity and one half-open interval. The read SHALL return on, off and unknown durations and evidence identities, distinguish gaps and removals, and link a particular action only with a matching request, observed outcome and observation. Clock conversion for local yesterday SHALL use the configured time zone. A Conversation cursor SHALL bind its task, destination, normalized query and captured evidence boundary. A stale or foreign cursor SHALL be refused and a denied operation SHALL expose no causal link.

#### Scenario: Power history on a local day

- **WHEN** the owner asks about an allowed device's observed power yesterday across a daylight-saving change, a gap or a removal
- **THEN** duration totals partition the actual local day and unknown time remains visible

#### Scenario: Evidence pages and causes

- **WHEN** a bounded result needs multiple pages
- **THEN** Conversation returns whole rows from the captured evidence boundary and rechecks the grants on every page
- **AND** a send without observed effect, or competing possible causes, supports no unique causal claim
