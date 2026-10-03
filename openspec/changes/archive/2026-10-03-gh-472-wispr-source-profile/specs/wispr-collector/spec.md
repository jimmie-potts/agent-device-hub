## ADDED Requirements

### Requirement: Qualified native History profile
The collector SHALL support the existing `id`/textual-timestamp/`appName` History profile and the qualified native profile using a non-null textual primary key `transcriptEntityId`, textual or DATETIME timestamp declaration, and optional textual `app`. Native fields SHALL map to the same private internal identifier and sanitized destination fields through a fixed allowlisted SQL projection. An existing incompatible `id` MUST NOT be bypassed by a native fallback. Selected-byte accounting MUST cover the actual projected source fields. All bounded read-only, private-output and explicit language opt-in requirements SHALL remain in force. A DATETIME declaration MUST NOT permit guessed timezone offsets or numeric epoch conversion.

#### Scenario: Native numeric collection
- **WHEN** a qualified native fixture contains stable IDs, explicit-offset timestamp strings, supported app fields and private text/context/audio canaries with language disabled
- **THEN** numeric contributions use the stable IDs and correct reporting-zone/app groups, repeated reads do not duplicate contributions, and private canaries are not selected or emitted

#### Scenario: Opted-in native language with missing edit evidence
- **WHEN** language collection is enabled on that native profile and edit-observation-end metadata is absent
- **THEN** bounded raw and cleaned language analysis works while observed-edit qualification remains unknown, without interpreting unrelated context or observation fields

#### Scenario: Incompatible native declarations
- **WHEN** the native key is not a non-null textual primary key, a required declaration is incompatible, or an existing id declaration is invalid
- **THEN** the whole observation fails with source-schema rather than silently mapping another field or changing retained data

#### Scenario: Unqualified timestamp value
- **WHEN** a native timestamp string is invalid or lacks an explicit UTC offset
- **THEN** its timestamp-dependent contribution is excluded with truthful coverage rather than receiving an inferred timezone
