## Context

The shared art contract and core forwarding are delivered by #679. Pixoo already owns immutable media rendering and the serialized moment writer. See proposal.md for the requested outcome. A design is required because this adds persistent state and admits new device content.

## Goals / Non-Goals

The module retains temporary display copies and exact timing without permanent library membership. Generation, scheduling, new takeover policy and physical qualification remain with their existing owners.

## Decisions

- Reuse MediaStore, its bounded decoder child and authenticated module content route. Each immutable art rendition has a private folder under the module's art directory, separate from permanent library media. This prevents temporary cleanup from touching library originals, favorites, checkpoints or session references. Sharing the library catalog would require new transient membership and cleanup semantics for every existing library consumer.
- One SQLite table maps composition IDs to source hashes, rendition IDs and expiry. The renderer's immutable manifest supplies source and effective frame metadata. Identity and hashes survive restart; commands and presentation never replay. Existing module command intent/outbox records remain the responsibility and completion owner.
- Serialize staging and cleanup. Bound live copies to 128, source bytes to the shared 160 KiB envelope, decoded content to 64×64×20 pixels, and work to the existing child deadline. A lease retains a copy during a moment or preview. Expiry refuses new use; cleanup waits for leases. Orphan folders from interrupted or failed staging are removed under the same owned directory.
- Resolve an exact composition before admitting a moment and hold its lease until the moment settles. Carry its uniform 100–800 ms frame delay through the existing presentation upload. Mood frames keep 500 ms. The selected device profile can narrow that envelope, including the smoke profile's two frames at 500 ms. No unsupported animation is silently shortened or retimed.
- Apply artCommandRefusal before accepting stages or moments naming art. Schema checks verify canonical bytes/hash/signature; decoded metadata must agree before a copy is committed. Staging produces `succeeded/observed` for committed private media, never a device observation. Typed validation errors produce failed outcomes with no display effect; unknown storage effects remain uncertain. Existing ADR 0012 logging, traces, outboxes and no-retry rules apply.

## Risks / Trade-offs

- Art and permanent imports can keep separate copies of identical bytes. The bounded transient store trades this small duplication for independent lifetime safety.
- A restart after files are rendered but before the row is committed leaves an orphan. Startup cleanup removes it and the existing unfinished-command path reports uncertainty without replay.
- A live copy that expires during playback remains readable until its lease is released. New moments refuse the reference, and restaging can renew it.
- Device acknowledgments remain transmission evidence. Optical playback is qualified only under #687.

## Migration Plan

Create the new table additively on module start. Existing library tables and media paths are unchanged. Older source ignores the new table and directory; recovery still follows the runtime's qualified procedure. Source tests cover a pre-art database, restart, orphan cleanup and active references. No installed migration runs in this story.
