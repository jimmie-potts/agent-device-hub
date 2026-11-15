## Context

Conversation owns its selected profile, saved history, drafts and tracked command. The page already receives the assistant, worker and operation copies. The issue groups that evidence without adding another source of facts.

## Goals and boundaries

Give the same mounted conversation a side panel at wide widths and an inline Details panel at narrow widths. Preserve task decisions, commands, speech lifetime, and private transcript rendering.

## Decisions

- Use native disclosures for Details sections and saved tool text. CSS places the same Details view at different widths. Toggling a disclosure sends no command and performs no read.
- Pass facts and the page's guarded settings action to the Details view. Label retained assistant facts Last known. A missing worker copy has unknown availability.
- A completed, successful operation matching the command identity permits moving its routine receipt into Task activity. Pending or negative outcomes stay beside the controls. Keep task outcomes and playback separate from command outcomes.
- Keep each tool disclosure inside its saved transcript row. Display the original text as React text and wrap long words so they fit the reading column. The transcript continues to own scroll position.

## Risks and trade-offs

Long text and IDs can narrow the reading column or introduce overflow. The disposable journey checks plausible long values, inert markup, narrow widths and retention of the reading position. Usage checks distinguish synthetic units, hosted tokens, zero and unknown.
