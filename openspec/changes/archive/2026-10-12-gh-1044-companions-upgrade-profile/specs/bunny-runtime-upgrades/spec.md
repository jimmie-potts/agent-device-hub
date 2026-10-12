## ADDED Requirements

### Requirement: Always-shipped companion owner qualification

For [#1044](https://github.com/jimmie-potts/agent-device-hub/issues/1044), the procedure SHALL require complete coordinator-bound companions coverage whenever that owner is configured, retained or present in a selected release. Coverage MUST bind baseline, candidate, recovery and reupgrade evidence to the exact releases and format inventories. The existing certificate schema and legacy seven-owner, ONN eight-owner, paired BB-8 nine-owner and combined ten-owner sets MUST remain supported. Adding companions SHALL require that one complete owner in addition to each applicable set; unknown owners, duplicates, partial BB-8 pairs and missing phases MUST refuse.

#### Scenario: New candidate introduces the companion owner
- **WHEN** the baseline has no companion state and the selected candidate ships that owner
- **THEN** preflight requires its complete four-phase evidence before any effect, including verified initial absence and a recovery release that reopens the candidate's latest companion data

#### Scenario: Proposed recovery lacks the companion reader
- **WHEN** a selected release creates or retains companion state but the recovery artifact cannot reopen it
- **THEN** preflight refuses rather than accepting opaque file retention, deleting state, restoring an earlier database or stripping configuration

#### Scenario: Retained owner is absent from the current artifact
- **WHEN** companion configuration or retained state exists but the current artifact has no qualified companion reader
- **THEN** preflight refuses that unqualified current ownership instead of inventing a healthy or compatible baseline

#### Scenario: Legacy coverage remains applicable
- **WHEN** no selected artifact, configuration or retained state requires companions
- **THEN** the existing exact coverage sets remain valid without a fabricated companion receipt or certificate-schema change

#### Scenario: Coverage is incomplete or unrelated
- **WHEN** companions coverage lacks a phase, a BB-8 pair is partial, or a certificate names an unknown or duplicate owner
- **THEN** admission or preflight refuses through the existing safe failure surface

### Requirement: Companion ownership and health remain explicit

The procedure SHALL inventory the companion owner's files with the same private ownership, type, link and permission checks as existing stores, without opening live databases. A selected artifact that ships the always-started owner MUST report ordinary running, healthy, null-reason module health. Preflight and post-start checks MUST enforce the same release-specific requirement. Post-start ownership MUST match the approved ownership plus only the qualified companion owner created by a release that ships it; other drift MUST refuse. This qualification MUST NOT authorize companion enablement, installed operations, model use, sensing, device commands or #643's desk acceptance.

#### Scenario: Private retained companion state is inspected
- **WHEN** regular companion database/sidecar files or its private module directory are inventoried
- **THEN** the owner is included without database reads or modification, while unsafe links, permissions and unsupported leases refuse

#### Scenario: First startup creates the qualified owner
- **WHEN** a qualified candidate first creates companion state under the unchanged approved configuration
- **THEN** post-start verification requires that owner and its ordinary healthy running row while preserving every other approved owner and input

#### Scenario: Companion health is unavailable or inconsistent
- **WHEN** an artifact shipping companions reports no row, duplicate rows, refused, stopped, unhealthy or non-null-reason health
- **THEN** preflight or post-start verification refuses without treating the row as an absent-device exception

#### Scenario: Startup changes unrelated ownership
- **WHEN** another owner appears or disappears, configuration changes, or companion state is missing after its qualified startup
- **THEN** post-start verification refuses instead of broadening the accepted profile

#### Scenario: Source checks pass while installation is unselected
- **WHEN** synthetic production-store and refusal checks pass
- **THEN** only source qualification is evidenced; exact installed startup authority and ONN client/physical acceptance remain separate
