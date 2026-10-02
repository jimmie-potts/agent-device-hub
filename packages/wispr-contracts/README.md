# Wispr aggregate contract

This pure package defines the versioned aggregate boundary between the Windows collector and the Hub. It must not import SQLite, filesystem APIs or collector implementation. Source IDs, individual dictation timestamps and private paths are excluded. Collector freshness timestamps and aggregate calendar groups are distinct.

Validation fixtures are synthetic. Run `npm run test:wispr` from the root; the offline package check also imports the validator from an isolated extracted consumer. The optional language and dictionary sections preserve numeric-only operation.
