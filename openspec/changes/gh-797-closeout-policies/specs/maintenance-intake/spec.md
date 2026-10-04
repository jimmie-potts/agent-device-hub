## ADDED Requirements

### Requirement: Fixed owning closeout policies

Closeout SHALL select a reviewed policy for exactly one of agent-device-hub,
codex-nanoleaf, divoom-app-upgrade, agent-skills or dotfiles from trusted private
configuration. The request SHALL match that repository. The policy SHALL bind
owning acceptance instructions, supported installation proof, label handling and
permitted Project projection. Issue text, model output and receipts SHALL NOT
select code, a new repository or broader authority. All existing full-acceptance,
publication, retained-intent and reconciliation protections SHALL remain in force.

#### Scenario: Installed runtime matches its owning policy
- **WHEN** Hub, Nanoleaf or Pixoo provides its valid successful semantic installation receipt for the configured owner and selected merged revision
- **THEN** closeout accepts only the matching runtime's target, running identity and healthy result before assessing complete issue acceptance

#### Scenario: Proof belongs to a different delivery
- **WHEN** the proof has a wrong repository, runtime, owner, revision, issue where declared, or unsupported proof kind
- **THEN** closeout refuses before tracker publication and preserves the selected issue

#### Scenario: Tool delivery has installed files
- **WHEN** a dotfiles or agent-skills delivery supplies its supported installed-files receipt
- **THEN** closeout verifies the plan digest, trusted installation configuration, owning file and link readback, and unchanged preserved-state evidence without inventing running-process health

#### Scenario: Tool repository has unrelated tracker fields
- **WHEN** closeout accepts a tool-repository issue
- **THEN** it preserves unrelated labels and Project fields, creates no Project membership, and applies no Hub workflow-label cleanup or portfolio projection

#### Scenario: Independent acceptance remains incomplete
- **WHEN** a supported proof is valid but current issue or related acceptance requires missing client, physical or owner evidence
- **THEN** the existing independent assessment and guarded reconciliation leave that acceptance pending without treating the installation proof as full completion

#### Scenario: Extracted package uses the same policies
- **WHEN** the supervisor invokes the unchanged closeout CLI from the complete verified package with a fixed supported policy
- **THEN** it uses the same acceptance and proof validation as the source package, with no additional scheduler, installer or plugin loading
