## Context

The shell renders a module heading and sibling navigation around the mounted page. Conversation separately owns its profile controls, transcript, composer and Details.

## Decisions

- The shell applies its compact page wrapper only to the declared Conversation React route. Use the existing companion links in a disclosure so the selected route and destinations match the rest of the dashboard.
- Give the transcript the space between the profile heading and composer. The transcript scrolls independently. Its minimum reading height and the controls' natural height allow the document to grow when necessary, so a long approval stays readable.
- Keep the existing composer and Details positions separate from the transcript. Profile labels and navigation change within the existing mounted page. The command owner, history reader, drafts and speech session keep their current lifetimes.

## Risks and tradeoffs

The Hub's retained phone navigation takes some height compared with the prototype. Check the actual shell and browser at the matched viewport sizes. Verify long proposals, reading position, drafts and speech lifetime separately from the normal layout.
