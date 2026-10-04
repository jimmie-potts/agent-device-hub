# Wispr language Specification

## Purpose

Provide descriptive, opted-in vocabulary and text-change aggregates while preserving source uncertainty, retained numeric history and explicit control over sensitive text derivatives.

## Requirements

### Requirement: Independent text opt-in and qualified stages

Language collection SHALL default off. Numeric-only reads MUST NOT select text. Enabled collection SHALL read only allowlisted raw-recognition, formatted-output and observed-edit fields plus necessary language and observation metadata. It SHALL keep three independent corpora. Missing stages SHALL be unobserved, never unchanged. Unknown language and unusable edit metadata SHALL remain explicit exclusions; edited text SHALL retain unknown finality and MUST NOT be called sent text.

#### Scenario: Observation uncertainty
- **WHEN** fixtures contain unchanged observed text, absent edits, partial observations and ambiguous metadata
- **THEN** coverage distinguishes these cases and only qualified stage pairs contribute to observed change measures

### Requirement: Deterministic English words and phrases

Supported English text SHALL use a versioned Unicode-normalized, case-folded tokenizer with a documented apostrophe rule and safe display spelling. All-word and useful-word views SHALL remain separate, with a visible versioned stopword filter. Phrases SHALL contain two to five contiguous tokens within one dictation. Occurrence counts and distinct-dictation counts SHALL remain separate. Unknown and unsupported languages SHALL not be silently treated as English; numeric coverage SHALL remain independent.

#### Scenario: Repetition and normalization
- **WHEN** equivalent case, Unicode and apostrophe forms recur within one record and across three records
- **THEN** deterministic normalized counts preserve distinct-record support and never form phrases across records

### Requirement: Bounded mechanical comparisons

Raw-to-formatted and formatted-to-observed comparisons SHALL remain separate. Deterministic token alignment SHALL count insertions, deletions and substitutions only over qualified pairs. Each stage SHALL be limited to 2000 tokens and alignment SHALL have a fixed work budget. Oversized or unqualified inputs SHALL be excluded with coverage, without truncating text into plausible pairs or removing numeric contributions. Published change endpoints SHALL each contain at most five tokens; longer changes SHALL contribute numeric counts and long-change exclusions without sentences. Changed-dictation share SHALL use compared dictations, and source correction/replacement counters SHALL remain separate.

#### Scenario: Cleanup, editing and rewrite
- **WHEN** synthetic stages include cleanup, snippet expansion, insertion, deletion, substitution and a full rewrite
- **THEN** comparisons have separate matching denominators and long replacements do not publish their sentences or imply grammatical correctness

### Requirement: Exact supported preset rankings

Language tables SHALL use today, seven-day, thirty-day and all-captured presets with truthful as-of and valid-until metadata. Each supported app/category intersection and corpus SHALL aggregate all eligible private contributions before applying support, sorting and top-100 limits. Text SHALL appear only after support from at least three distinct dictations in that exact subgroup. Each ranking SHALL report the number of qualified candidates omitted. Arbitrary custom lexical ranges SHALL be unavailable; exact numeric custom-date analysis SHALL remain available.

#### Scenario: Global ranking and subgroup suppression
- **WHEN** a term is below every daily top-N list but frequent over the full preset, or has three records globally but fewer in a selected subgroup
- **THEN** exact preset aggregation ranks the first correctly and suppresses the second within that subgroup

### Requirement: Sensitive-pattern and owner exclusions

Before grouping, language analysis SHALL exclude URLs, email/phone patterns, file paths and token-like secrets, plus owner-selected apps and terms. Sensitive spans SHALL not become phrases or change endpoints through token splitting. No copied transcript, per-event text map, individual identifier/timestamp or raw examples SHALL leave Windows. Diagnostics and errors SHALL not contain text or private paths. Strings SHALL remain data for text-safe consumers; exports SHALL retain formula protection. Suppression SHALL not be described as anonymity.

#### Scenario: Synthetic canaries
- **WHEN** source stages contain secrets, paths, HTML and formula-like text
- **THEN** sensitive values are absent from aggregate files, logs and errors, and permitted display strings cannot execute as markup or spreadsheet formulas

### Requirement: Retained derivatives and privacy transitions

The private store SHALL retain only unordered bounded token/phrase/change contributions, not copied raw or formatted transcript fields. Retries and restarts SHALL not duplicate counts; late edits SHALL replace the whole contribution; source pruning SHALL preserve captured contributions until explicit clear. Algorithm/policy changes SHALL not silently reinterpret archived derivatives when source text is unavailable. Language opt-out SHALL immediately publish a text-disabled generation and remove derivatives from local state, pending/current outputs and managed text-bearing backups while retaining numeric history. Restart and restore SHALL not revive removed text. Reenablement SHALL analyze only still-available source text within the capture policy.

#### Scenario: Opt-out during pending publication
- **WHEN** language is disabled after a text-bearing commit or managed backup, then collection restarts or a backup is restored
- **THEN** no old text is republished, managed derivatives are removed and numeric history remains intact

### Requirement: Separate dictionary and snippet snapshots

Supported active dictionary-entry and snippet counts, local usage and remote usage SHALL remain separate snapshot values with explicit availability and unknown windows. Deleted entries SHALL be excluded. Repeated snapshots SHALL not be added together. A source reset or decreasing counter SHALL start a new comparison segment. Optional text labels SHALL require text opt-in and the same support/sensitivity rules; absence of qualified label support SHALL not invent examples. The collector SHALL never edit the dictionary.

#### Scenario: Repeated and reset counters
- **WHEN** identical snapshots recur, counters decrease, entries are deleted or fields are unsupported
- **THEN** totals are not double-counted, resets create a segment and unsupported measures remain unavailable

### Requirement: Synthetic source and package qualification

Source delivery SHALL include tokenizer/alignment, preset, suppression, retention, opt-out and source-preservation tests, plus native Windows and extracted offline-package checks. Existing numeric consumers SHALL keep working without text collection. No test SHALL use personal data or claim to establish the owner's speaking habits, installed source meanings or successful communication.

#### Scenario: Offline opted-in pipeline
- **WHEN** an extracted collector processes a controlled synthetic source with language enabled, then disabled
- **THEN** versioned aggregate tables validate through the shared contract and compatible Hub consumer, and the disabled generation contains no text derivatives

### Requirement: Bounded exact ranking rebuilds

The collector SHALL calculate each supported preset/corpus ranking from every eligible retained contribution while limiting simultaneously active intermediate ranking keys to 250,000 across that preset/corpus's app/category groups and ranking kinds. Completed batches SHALL release their intermediate counts before the next batch. A cumulative number of keys processed across completed batches SHALL NOT alone reject a snapshot. Initial import, repeat collection, reporting-zone rebuild and recovery SHALL retain exact support, counts, sorting, top-100 limits and omitted counts. Existing source, command, working-memory, private-store and publication limits SHALL remain enforced. Exceeding an active batch or another resource limit MUST fail visibly and preserve the prior committed snapshot and retained state.

#### Scenario: Overlapping presets exceed the former cumulative limit

- **WHEN** valid retained text produces more than 250,000 keys cumulatively across presets/corpora but no active batch exceeds its limit or another resource budget
- **THEN** the collector publishes all exact supported tables, including terms that qualify only after multiple dictations

#### Scenario: One active batch exceeds capacity

- **WHEN** the selected preset/corpus's simultaneously active app/category ranking counts exceed 250,000 keys
- **THEN** collection reports aggregate-capacity, preserves the last-good snapshot and retained contributions, and does not truncate rankings or discard history

#### Scenario: Replay and reporting changes

- **WHEN** the same retained records are processed again or their reporting zone changes
- **THEN** every batch reads the same coherent retained state and preserves distinct-dictation counts, coverage, unknown finality and the applicable preset boundaries
