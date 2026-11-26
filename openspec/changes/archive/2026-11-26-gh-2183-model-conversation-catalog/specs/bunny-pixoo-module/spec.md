## ADDED Requirements

### Requirement: Owner-local original asset identity lookup

The Pixoo module SHALL accept a Runtime-local `asset-id-by-name` content request with a bounded asset name. It SHALL resolve a unique matching original independently of whether any rendition exists, and return only the asset ID. It SHALL refuse missing or ambiguous matches without reading media bytes or changing the catalog.

#### Scenario: A saved original has no rendition

- **WHEN** the Runtime asks for the identity of a uniquely named original without a rendition
- **THEN** the module returns the original's ID and sends no presentation command
