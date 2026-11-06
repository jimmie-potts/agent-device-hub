## Context

Divoom specifies `PicNum < 60` for `Draw/SendHttpGif`, with one RGB frame per offset and speed in milliseconds. `Device/PlayTFGif` fetches a square GIF at 16, 32 or 64 pixels. Existing Pixoo renditions are 64×64. Manufacturer documentation gives no hosted frame maximum. Earlier speed and frame-count observations remain useful diagnostics. [Direct command](https://docin.divoom-gz.com/web/#/5/57) · [Hosted command](https://docin.divoom-gz.com/web/#/5/54) · [Manufacturer SDK](https://github.com/DivoomDevelop/divoom-wifi-python/blob/58fbbc29510d7650163af14af31dfb99592c5324/src/divoom_wifi/data/apis.json)

## Goals / Non-Goals

Allow imports and previews independent of physical playback. Allow the selected direct writer to play up to 59 frames and the explicitly configured hosted writer to play a losslessly representable whole GIF. Keep Art’s generation recipe, spending, appearance duration, queue ownership and replay policy.

## Decisions

Keep the historical named descriptors byte-for-byte for old rendition identity. Render new library and transient originals under a distinct neutral library descriptor. Read existing route names through one current policy. Direct uses the documented count and millisecond speed. Whole-GIF encoding retains its format’s centisecond precision and lossless palette requirements. Uniform physical timing applies to physical animations. Mixed-delay source media stays available to preview with its original timing. Keep the simulator’s own timing policy separate from the named physical command routes.

Refuse excessive source or scaled decoded pixels before materializing frames. Verify the worker’s reported work and bytes, and refuse an oversized manifest before publishing an immutable rendition. Preserve the historic migration reader’s pinned source format. Version the hosted compatibility cache so old sample-based results cannot suppress valid animations. Avoid retaining every decoded preview image for every catalog tile.

Use compatible minor documents where counts exceed the old closed schemas. The old stage and catalog schemas continue validating their own ranges. The core forwards only authorized Art commands and keeps the byte and duration bounds. The producer’s usual eight frames continue along their established route.

Measure the encoded hosted GIF against the listener’s existing 10 MiB budget before marking a rendition compatible or committing its private stage. Keep a versioned reason for a refused hosted rendition. A full filesystem or exhausted quota reports capacity independently of per-file limits. After verification, an identical stage rechecks stop and its own expiry before renewing a live copy. Physical playback dwells longer than one native timer use cancellable elapsed-time slices and advance only at the requested end.

## Risks / Trade-offs

Long inputs can exhaust time, storage or queue capacity even when the count is valid on the command. Report the observed limit distinctly and leave previous storage readable. A device may reject or interrupt a documented command. Report the actual route, error and uncertainty, with physical outcomes evaluated only by an authorized operator. No evidence from this change establishes device connectivity or optical performance.
