## Context

Each profile's conversation is one native session (#505). The companions module reports it in `lifecycle/2.2`, titled by the conversation's title or by the persona until one exists, and sends title changes as `metadata-observed` in `lifecycle/2.3` (#2025). The core publishes a native record as `session/3.1`. Nothing names the companion apart from the persona fallback title. The owner chose metadata over a title prefix and the dashboard as the first reader (#2054).

## Goals / Non-Goals

**Goals:** a declared, additive field with a stable companion ID and display name on native sessions; a shape a shared room can use later; a title and rename path that cannot change the field; the dashboard tag, Facts row and search.

**Non-Goals:** showing the companion on Tidbyt, Pixoo, Nanoleaf, LIFX or Habitat (their own later stories); the Apartment room itself (#2032); changing the persona fallback title, which other devices show today.

## Decisions

1. **Field: `companions`, a list.** Each entry is `{id, name}`: `id` is a routing ID of at most 64 characters, the assistant profile today (`bunny`, `reachy`, `microduck`), which a reader keys on; `name` is session display text of at most 40 Unicode scalar values (the persona name), which a reader shows. The list holds 1 to 8 entries, each ID once (a validator check, since `uniqueItems` cannot compare objects by one member), in the producer's order. A companion's own conversation carries one entry. A shared room such as the Apartment (#2032) carries every companion in it, so the room needs no new shape or major version. A single `companion` object would have needed a second field, and a breaking change or two parallel fields, once a session has several companions. The field is not `project`, `label` or `title`: those keep their meanings and precedence. An absent list, not an empty one, says nothing is known, so the field stays optional.
2. **Versions: `session/3.2` and `lifecycle/2.4`, additive minors.** `session/3.2` is `session/3.1` with the optional list and a rule that only the native provider carries it. `lifecycle/2.4` is `lifecycle/2.3` with the same optional list and rule, and forbids the list on `metadata-observed`. Each version stays a superset of its predecessor, so a message valid in 2.3 or 3.1 is valid in the new minor. Tests keep each new schema equal to its predecessor apart from these members. The core publishes a record in the lowest version that expresses it: `session/3.2` when it carries companions, `session/3.1` for another native record or a notice result, `session/3.0` otherwise. The companions module sends lifecycle observations in 2.4 and title metadata in 2.3, the lowest version for each. The read function reads 3.0, 3.1 and 3.2. A reader of an older release keeps reading every Claude and Codex record and skips a native record with companions, as #505 accepted for native records; every reader in this repository is released with the core.
3. **Titles never carry the companions.** Only lifecycle observations carry the list, and the schema refuses it on `metadata-observed`. A generated title or a rename therefore cannot change it, and the module never adds the companion's name to a title. The persona fallback title of an untitled session stays, as the issue requires, so other devices keep their current display.
4. **Core retention.** The reducer takes the list with the other display metadata, under the same newer-metadata guard: the latest lifecycle observation that names companions replaces them whole, and one without them leaves them. The stored session is JSON in `core_sessions`, so no table changes. A session the core held before this release has no companions until its next lifecycle observation. A record's public meaning includes the list, so a change publishes it.
5. **Binding.** `lifecycle/2.4` joins 2.2 and 2.3 as a native-only version: the core refuses it from any source but the companions producer with `forbidden`, and the gateway refuses it from every edge credential. No error code, retry or diagnostic field changes (ADR 0012).
6. **Dashboard.** A row carries the companions' names and the tags its face shows: every companion whose name differs from the session's displayed name (the label, then the title). An untitled session shows its persona once; a titled or renamed one tags its companion before the client. The tag is a neutral chip, named `Companion: <name>` through visually hidden text and its `title`. It keeps its name whole up to half the line, and beside it the client gives way to an ellipsis, so the line stays one line at phone and desktop widths. The expanded facts add a Companion row (Companions for several), and the search matches companion names. A session without companions renders as before.

## Readers that receive the field

Every subscriber of the core's `session` family receives `session/3.2` records through `readSession`: the dashboard and Habitat, the core's session history and its `core_sessions` MCP tool, automations, the read-receipt part, and the Tidbyt, Pixoo, Nanoleaf, LIFX, Reachy Mini, MicroDuck, Codex Desktop and companions modules. Only the dashboard's session tile shows it. The others ignore the member, so their behavior does not change. No reader sends it off the host; it is a persona name, not personal data under ADR 0011.

## Risks / Trade-offs

- [A reader of an older release skips a native record with companions] → Only in-repository readers exist, released together; Claude and Codex records keep their versions.
- [A pre-release session lacks companions until its next observation] → It shows as before, with the persona title, until the conversation next changes.
- [The client name is ellipsized on narrow tiles] → The companion is the more specific fact for a native session; the full client stays in the `title` attribute.

## Migration Plan

None. The field is optional, stored inside the existing session JSON, and appears from each conversation's next lifecycle observation.
