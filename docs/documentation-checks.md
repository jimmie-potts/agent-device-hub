# Documentation checks

Run from the repository root with Python 3:

```bash
python3 -m unittest discover -s docs -p test_docs_drift.py
python3 docs/check_docs_drift.py
```

The script uses only the standard library. `--report <path>` saves the Markdown
report instead of printing it. `--offline` skips external comparisons and marks
them **not checked**. Neither mode modifies pins, diagrams or generated pages.

The Retained documentation checks job in Workflow runs this on every PR and
main push, including Markdown-only changes. It puts the report in the job summary
and emits warning/error annotations. The same report is retained in the
`retained-documents-review` artifact. Its token has only `contents: read`.
The same job runs the atlas generation check and the API/database reference
checker through `docs/system-design/check.py`.

## Source pins are warnings

Inputs are the independent legacy diagram definitions and receipts, atlas source
links, API/database source inventory and routes, current sequence provenance and
`runtime-architecture.sources.json`. The latter records the existing baseline and
source-owner directories from `architecture.md`; it does not re-pin the diagram.
Changing its baseline must also agree with the authored runtime diagram.

Hub comparisons use the checked-out Git revision with complete local history.
Nanoleaf and Pixoo comparisons resolve each public repository's default-branch
head once, then use GitHub's read-only compare API. Both old and new names count
for a renamed source. Missing history, inaccessible sources, malformed responses
and compare results reaching GitHub's 300-file limit are **not checked**, never
reported as unchanged. The report records both revisions and each changed pinned
file. Dated legacy views intentionally lag; warnings call for review, not an
automatic re-pin or regeneration.

## Invalid current commands and paths fail

The checker scans AGENTS.md, README.md, development/SDLC/application-style and
app-verification entry points, plus owning application development/verification
guides, package testing/operations guides and static-analysis guidance. It checks
literal npm script names against the root manifest and Python/Node command-file
paths against the checkout. It reports the document and line for each failure.

Backticked paths with a tracked top-level directory must exist at the repository
root or relative to their owning document. Globs must match. Use explicit root
paths when a guide discusses another package. Prefix external-repository paths
with that repository name, and use `<checkout>` placeholders for commands run
there. Placeholder paths and generated `dist`, `node_modules`, `.local` and
`artifacts` outputs are not source references. An individual path may be followed
by `(retired)` or `(generated)` when that is its actual status. These exceptions
do not excuse a missing npm script or an executable source command file.

The check does not judge prose claims or verify installed services, live public
pages or physical devices. Semantic review and those acceptance boundaries remain
separate.
