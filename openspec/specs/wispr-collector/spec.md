# Wispr collector Specification

## Purpose

Provide private, retained Wispr analytics through bounded Windows source reads and a versioned aggregate boundary that does not expose individual dictations to the Hub.

## Requirements

### Requirement: Native bounded source observation
The collector SHALL read only an explicitly configured local Windows source, in a consistent read-only transaction with extensions disabled. It MUST select only allowlisted columns, reject unsupported required schemas and preserve the source. Numeric-only collection MUST NOT select text. It MUST enforce one active collector, a 1-second SQLite busy timeout, a 10-second source deadline, a 60-second run deadline, a 512 MiB working-memory ceiling, at most 100,000 rows and at most 256 MiB selected input bytes. An external supervisor MUST interrupt blocked synchronous work. Limit failures MUST reject the whole observation rather than publish partial counts.

#### Scenario: Writer commits during a read
- **WHEN** a synthetic native Windows writer commits while the collector reads a WAL database
- **THEN** the collector sees one coherent transaction, leaves source content unchanged, and releases its reader locks promptly

#### Scenario: Unsupported or oversized source
- **WHEN** required fields are missing, a source lock persists or an input/deadline bound is exceeded
- **THEN** the observation fails with a sanitized typed diagnostic and does not alter retained contributions or last-success freshness

#### Scenario: Private fields in a numeric source
- **WHEN** source rows contain transcript, audio, context, URL and secret canaries with language collection disabled
- **THEN** none of those fields is selected or emitted into aggregate output, diagnostics or logs

### Requirement: Exact numeric contributions and uncertainty
Eligible dictations SHALL have formatted status, positive valid word counts and a valid zoned timestamp. Counts, recording seconds, speech seconds and correction/replacement counters MUST retain matching coverage and exclusion denominators; NULL MUST NOT become a known zero. Weighted speech rate MUST use words and speech seconds from the same rows, with recording-duration fallback reported separately. Invalid, unknown and excluded statuses MUST remain distinguishable without publishing arbitrary source strings.

#### Scenario: Mixed metric coverage
- **WHEN** synthetic rows include missing, zero, negative and nonfinite durations or counters
- **THEN** totals and rate denominators match hand-calculated eligible sets and unsupported metrics remain unavailable

### Requirement: Reporting-zone and destination aggregates
The collector SHALL support IANA reporting zones, initially America/New_York, parse zoned source timestamps including the observed space before the UTC offset, and bucket by local date, hour, weekday and sanitized destination app. It SHALL provide daily, weekly and monthly rollups, active days, observed consecutive active-day runs, heatmaps, app/category totals and coverage bounds. The versioned category mapping SHALL include AI prompts, email, messaging, documents and other/unknown. Source IDs, private paths, URLs, document titles and individual timestamps MUST remain on Windows. Only the latest source activity calendar date may be published. Missing observation periods MUST NOT be asserted to be observed zeros.

#### Scenario: Midnight and daylight saving transitions
- **WHEN** source timestamps cross local midnight or either daylight saving transition
- **THEN** local calendar groups and weighted totals remain correct, repeated local hours combine honestly, and the latest published activity is date-only

#### Scenario: Reporting-zone change
- **WHEN** the owner explicitly changes the reporting zone
- **THEN** numeric buckets rebuild from retained private source times with the new zone recorded, without silently mixing zones

### Requirement: Retention and idempotent late changes
The private store SHALL key contributions by stable source namespace and record ID. Complete scans SHALL insert unseen contributions, replace entire changed contributions, mark absent previously captured records archived, and retain captured history until explicit clear. Failed scans MUST NOT archive records. Reappearing records MUST update existing contributions without duplicates. Numeric and language coverage MUST remain independent. Archived algorithm versions MUST remain separate or unavailable when needed source text no longer exists. Dictionary/snippet counters MUST remain snapshot measures and MUST NOT add to dictation words.

#### Scenario: Retry, edit, prune and reappear
- **WHEN** a captured record is rescanned, later edited, pruned and restored in the same source namespace
- **THEN** its contribution is counted once, reflects the last observable edit, survives pruning, and updates on reappearance

### Requirement: Atomic publication and truthful freshness
Each successful observation SHALL commit one monotonic data revision and publish a validated aggregate file using a flushed same-directory temporary file and atomic replacement. Publication retries MUST NOT duplicate contributions. Separate attempt status MUST preserve the last successful observation timestamp and latest source activity date on failure. Successful empty observations MUST be distinguishable from missing, unreadable and unsupported sources. The private-store cap SHALL be 1 GiB and snapshot cap 16 MiB; capacity failure MUST preserve last-good data and never evict retained history.

#### Scenario: Crash around commit or rename
- **WHEN** collection stops before or after a local commit, or aggregate replacement fails
- **THEN** restart either keeps the prior revision or completes the committed pending publication without duplicate counts or falsely fresh status

### Requirement: Versioned aggregate boundary
The shared contract SHALL fix schema and algorithm versions, source namespace, generation, monotonic revision, reporting zone, generated/last-success timestamps, latest activity date, retained/captured coverage, exclusions, collection gaps, source health and explicit nontruncation. Numeric daily/hour/app groups SHALL be sufficient for consistent consumer filters. Optional language and dictionary sections SHALL declare availability independently so numeric consumers work without language collection. Every preset SHALL carry its as-of and valid-until timestamps.

#### Scenario: Yesterday's snapshot
- **WHEN** a consumer reads a preset after its valid-until time
- **THEN** its identity and time bounds prevent representing it as fresh data for today

#### Scenario: Unknown fields or incompatible versions
- **WHEN** a producer or consumer encounters an invalid aggregate envelope
- **THEN** it rejects the envelope without exposing unknown fields or claiming successful observation

### Requirement: Private paths and explicit source binding
Config, retained state, backups and outputs SHALL reside in owner-restricted Windows locations outside Git and cloud-synced directories. Only the current owner, SYSTEM and Administrators SHALL have allowed access to collector-owned files. The collector SHALL accept existing additional ACL grants on the explicitly selected Wispr source and its SQLite sidecars without changing their permissions. Source ownership qualification and all local fixed-drive, containment, Git/cloud and redirect restrictions SHALL still apply. The collector MUST reject network/UNC SQLite paths and unsafe symlink/reparse redirects. Source replacement MUST require explicit namespace reconciliation; account identity MUST NOT be inferred by reading login/session files. Diagnostics SHALL use fixed codes without private paths or source values.

#### Scenario: Unsafe path or replacement
- **WHEN** a configured path resolves through an unsafe redirect or the source file identity changes
- **THEN** collection fails closed until the owner explicitly resolves the path or source binding

#### Scenario: Selected vendor source has another reader
- **WHEN** an otherwise qualified owner-selected source and its SQLite sidecars allow another principal to read
- **THEN** collection accepts those permissions, leaves source bytes and ACLs unchanged, and publishes only to qualified private collector paths

#### Scenario: Collector-owned data allows another reader
- **WHEN** configuration, retained state, a managed backup or an export allows a principal beyond the current owner, SYSTEM and Administrators
- **THEN** the command rejects the private path before updating retained analytics or replacing output

### Requirement: Clear and recovery cannot revive removed data
The collector SHALL offer bounded private backup/restore, numeric JSON/CSV export, sanitized status, one-shot collect and explicit clear/reset operations. Clear SHALL stop overlapping work, advance the generation, publish empty aggregates and establish a capture-after boundary. Historical reimport MUST require a separate explicit choice. Text clear/opt-out SHALL remove text derivatives from retained state, pending/current snapshots and managed backups while retaining numeric history. Restore MUST respect clear boundaries and never silently revive cleared text or old epochs. Clear receipts MUST state that unmanaged exports/backups cannot be recalled.

#### Scenario: Clear followed by restart or restore
- **WHEN** an owner clears analytics and then restarts or restores an older managed backup
- **THEN** pre-clear contributions remain excluded unless historical reimport is explicitly selected, and consumers cannot mistake the old generation for current data

#### Scenario: Language disabled and enabled again
- **WHEN** language opt-out is followed by restart, restore or later reenablement
- **THEN** removed text derivatives remain absent and any new language backfill uses only still-available source text within the current capture policy

### Requirement: Reproducible source package and separate installation
The source delivery SHALL include an offline package and synthetic extraction/collection check plus native Windows qualification. The CLI MUST perform no network calls, automatic discovery, scheduling, installation or source writes. The runbook SHALL describe explicit recovery, source rebinding/account-switch limits, capacity, privacy and separate installed opt-ins.

#### Scenario: Offline extracted package
- **WHEN** the package is extracted into an isolated directory with the qualified runtime
- **THEN** a synthetic collect/export/status sequence works without the repository, network or live Wispr data
