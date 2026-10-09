# Execution recommendation mechanics

This directory owns parsing, fingerprinting and upsert for maintenance closeout.
The installed planning skill owns assessment policy; this parser never chooses a
model or invents an assessment. Existing missing, insufficient, unavailable,
stale and recommended states keep their meanings.

A valid recommendation has one section, the required two-host table and prompts,
recognized session/work-surface values, explicit provisional or verified
availability, and a 12-hex fingerprint. Duplicate or malformed fields stay
unavailable. Missing cheaper alternatives must be explicit. Implementing prompts
name both independent final reviewers; investigation prompts name none.

The fingerprint is the first 12 hex characters of SHA-256 after Markdown
normalization and removal of the Execution recommendation section and any
historical `## Guide` section. The latter exclusion preserves existing issue
fingerprints; it creates no requirement to write Guide metadata. Real scope edits
still stale the recommendation. Labels, issue state and dependencies require
separate live reassessment because they are not part of the body hash.

`upsert` rereads each live issue, changes only its recommendation (and explicitly
supplied missing assessment ratings), preserves the assessment date for unchanged
scope, skips unchanged writes, refuses concurrent edits and verifies readback.
It consumes assessor entries, not saved backlog snapshots. Keep inputs and
receipts privately in the main checkout's `.local/evidence/`.

```bash
python3 apps/maintenance/recommendations/recommendations.py upsert --input <entries.json> --dry-run
python3 apps/maintenance/tests/test_recommendations.py
```

Review the dry-run before an authorized write. `--receipt` appends JSON lines;
`--only` selects repository/issue keys. The former saved-backlog report and page
rendering helpers were retired with Work Guide.
