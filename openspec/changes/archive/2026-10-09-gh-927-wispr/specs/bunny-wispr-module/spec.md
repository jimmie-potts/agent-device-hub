## Purpose

Preserve the selected collector-file analytics as a read-only runtime module with truthful freshness and independent sharing controls, without copying the producer's store.

## ADDED Requirements

### Requirement: Manually selected file-backed configuration

The Wispr module SHALL accept a fresh manually entered section naming distinct aggregate and diagnostics JSON files, a neutral source ID and bounded freshness. Exposure and text sharing SHALL default false. Reads SHALL preserve the collector's published contract, private file qualification and source ACL choices. The module SHALL create no analytics database or persisted copy and SHALL NOT read the collector or Wispr database, migrate settings or start collection.

It SHALL validate the unchanged file handoff with the existing pure `@jimmie-potts/wispr-contracts` package. This scoped dependency SHALL permit no import of the collector, old Hub or another module's implementation.

#### Scenario: Fresh configuration
- **WHEN** the section names valid selected files without sharing flags
- **THEN** both flags are false and startup opens no source file or analytics database

#### Scenario: Invalid configuration
- **WHEN** paths are relative, redirecting, colliding or unsafe, or a flag/type is invalid
- **THEN** configuration is refused with fixed text without echoing paths or supplied values

### Requirement: Bounded reads and safe module lifetime

The module SHALL reuse the bounded worker/file/query behavior: diagnostics are observed on demand, numeric refreshes coalesce for 30 seconds, responses are at most 1 MiB, and initial missing input is unavailable instead of zero. Last-good numeric data SHALL retain its observed identity and age on failure. Generation changes SHALL evict old data, including when replacement aggregates are unavailable. Module stop, request cancellation and privacy changes SHALL retire outstanding reads without emitting retired data. The authenticated adapter SHALL recheck the original principal, browser exposure where applicable, and the module lifetime/privacy guard immediately before HTTP emission, including a change after the read promise resolves. Expected read failures SHALL return the shared error body and SHALL NOT fail the module.

#### Scenario: Missing or stale selected input
- **WHEN** the initial files are missing or a prior valid aggregate becomes stale or malformed
- **THEN** the response reports unavailable or truthful stale last-good numeric data without a filesystem path or exception

#### Scenario: Outstanding text read loses permission
- **WHEN** sharing is disabled before a worker reply is delivered
- **THEN** the pending response contains no text, numeric producer history remains untouched and a late reply cannot resurrect text

#### Scenario: Stop or clear during a read
- **WHEN** the module stops or the producer changes generation before a response
- **THEN** the read is refused and old-generation content cannot be returned

### Requirement: Read-only analytics handoff

The module SHALL expose only the existing numeric, language and portable-export calculations through the coordinator-owned authenticated read boundary. Numeric exports SHALL omit text unless explicitly requested and currently permitted by runtime sharing and the matching producer manifest. Error codes SHALL come from the shared registry; private paths and raw filesystem errors SHALL never be returned. The module SHALL publish no analytics, register no analytics MCP tool and send no collector or device command.

#### Scenario: Numeric default and explicit text permission
- **WHEN** a read/export omits text or requests text without both permissions
- **THEN** numeric-default output contains no language data and forbidden text export is refused
