## Context

See proposal.md for motivation. The current capture owner, producer and seven closed payload families accept Music only. The native helper already has bounded real-time PCM analysis, absolute-to-continuous clock mapping, one latest pending frame and confirmed/uncertain teardown. The wrapper starts a five-second first-frame deadline when work is admitted; core retains a ten-second start responsibility. Neither deadline is appropriate for waiting on an interactive permission prompt.

Design is required because this change crosses native, authenticated event, browser and durable core state boundaries. ADR 0012 and the existing diagnostic contract continue to govern commands, outcomes, errors, traces and history; ADR 0011 governs private configuration and evidence.

## Goals / Non-Goals

Make manual microphone capture usable through the same explicit core start/stop path as Music. Keep the existing analyzer and measurement meanings. One producer offers Music and at most one configured microphone. No new capture service, transport, renderer, device authority, calibration helper or automatic fallback is introduced.

## Decisions

### Selection and public contracts

Use `CaptureSelection = {input: 'music'} | {input: 'microphone'; microphoneId: string}`. The alias is 1–64 characters matching `[A-Za-z0-9_.-]+`; it is chosen by the owner and is the name displayed by the shared controls. There is no unused display-name field. A microphone capability is `{id: alias}` and means configured selection support, not observed device presence or granted permission.

Extend these families with registered `/2.1` schemas and retain every `/2.0` schema unchanged:

| Family | Extension | Output choice |
| --- | --- | --- |
| `music-capture-endpoint` | Optional `microphone: {id}` on existing Music enable registration | Producer with a configured microphone uses 2.1; Music-only configuration keeps 2.0 |
| `music-capture-work` | Start accepts the microphone selection branch | Core sends Music start and every stop as 2.0; microphone start as 2.1 |
| `music-capture-features` | Microphone selection accompanies unchanged numeric measurements | Music generations publish 2.0; microphone generations publish 2.1 |
| `music-capture-control` | Start accepts the microphone selection branch | Existing Music requests remain 2.0; selected microphone requests use 2.1 |
| `music-capture-state` | Optional configured microphone capability and selected microphone session branch | Core always publishes and syncs exactly one 2.1 record |

The 2.1 schemas retain the old Music-shaped records as valid inputs. Progress and lost remain 2.0. Envelope profile, family names, subjects, routing, credentials, grants and error shapes do not change. Unknown versions and undeclared fields still fail. Runtime core binds the selected alias to its current registered endpoint and generation, rejects an unadvertised alias before dispatch, and rejects features with another input or alias. Registration cannot silently change a live endpoint's capability or renew its clock qualification; changed configuration requires a new explicit producer invocation.

This follows the existing device 2.1 pattern: register both versions, have each producer choose one output version, and key consumers by family. Dual state publication would create two conflicting projections and is rejected.

### Bundled consumers and ownership

After #722's stable revision is integrated, its browser-safe `v2/music-capture-data` owns constants and data types; server `music-capture` retains validation and re-exports. Update the data types there, retaining Music-shaped source compatibility.

The core capture owner, tracker responsibility check, producer work receiver, and both `registerMusicCaptureFamilies` and `registerCoreFamilies` explicitly accept the registered versions. The tracker uses an exact allowlist, not a URI prefix. Core persists input provenance with its accepted responsibility before sending work. Stop preserves the input of the active generation. Legacy Music records need no new SQL table or destructive rewrite; recovery still retires endpoints, capabilities and active generations and settles pending work without replay.

The #722 dashboard state parser/model, capture selector and HTTP action adapter must accept 2.0 and 2.1 current state. A configured alias becomes an explicit additional selection. Selection starts no capture; Start names the selected alias. The UI distinguishes configured support from successful capture and explains device/permission refusal without implying a permission prompt was shown. It uses 2.0 for Music and 2.1 for microphone controls. Bundled state reads see the same single 2.1 entity and revision sequence through sync and live delivery.

The generic SDK transport and gateway retain family-based routing and existing grants. Add real loopback assertions for both input versions and a single 2.1 state copy. Re-scan production consumers after integration; any merged renderer intake must explicitly handle or refuse microphone provenance, never reinterpret it as Music. No light integration is added here.

### Private configuration and explicit setup

Accept unchanged `music-producer/1.0` configuration. Add `music-producer/1.1` with the same keys and one optional `microphone: {id, uid}` entry. Keep current owner-only regular-file, symlink, absolute-path and 8 KiB checks. Limit the private UID to 1–1024 UTF-8 bytes. The UID never enters SDK messages, history, diagnostics, exceptions or command arguments.

Provide two explicitly invoked local setup operations. Input discovery reads at most 64 CoreAudio device IDs, returns bounded private names and UIDs only to the invoking operator, and starts no IO or authorization request. Permission setup checks AVFoundation audio authorization and requests access only for this explicit operation. It starts no IO after a grant, contacts no runtime, and accepts stop/parent loss without later starting capture. A normal producer connection performs neither operation and enumerates no hardware.

The permission setup result is distinct from capture success. Capture start checks current authorization and fails if it is absent, denied or restricted; it never invokes the permission request API. The separate permission operation leaves the existing capture start deadlines unchanged. Apple requires `NSMicrophoneUsageDescription`; packaging must qualify the helper's TCC identity and Audio Input entitlement. Source tests do not establish that qualification. See [Apple authorization guidance](https://developer.apple.com/documentation/AVFoundation/requesting-authorization-to-capture-and-save-media) and [Audio Input entitlement](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.device.audio-input).

### Native input ownership

Use AVFoundation for permission only and CoreAudio for the selected input, reusing the existing C callback/analyzer. Resolve the configured UID with `kAudioHardwarePropertyTranslateUIDToDevice`; `noErr` plus `kAudioObjectUnknown` is still unavailable. Read input stream configuration and virtual format. Initially accept one supported mono/stereo input stream with the existing float format and buffer bounds; unsupported devices fail without format conversion or changing their settings.

Create one owned IOProc on that exact device. Disable all output streams for that IOProc before starting; if this cannot be established, fail before IO. Never set the default device, hardware gain, sample rate, hog mode or another client's stream usage. Observe selected-device liveness and format changes, and recheck authorization outside the real-time callback. Stop, source loss or permission loss retires the generation and cleans up only owned listeners and IOProc. No microphone path creates a Music tap or aggregate. [Apple stream usage](https://developer.apple.com/documentation/coreaudio/audiohardwareioprocstreamusage) documents per-IOProc stream selection.

Keep native frame/clock 1.0 records unchanged. Add a versioned fixed native terminal branch for microphone errors. Pass the private UID in a closed, bounded startup record over the child control pipe, never in process arguments; subsequent control retains the existing stop behavior. This is the existing private child protocol, not a runtime event format. Tests replace every CoreAudio and AVFoundation access and fail on accidental real calls.

### Outcomes, diagnostics and privacy

Unavailable device or absent grant fails the start with existing registered codes; unsupported format uses `unsupported-capability`, invalid selection uses `invalid-request` or `unsupported-capability`, and unconfirmed teardown stays `uncertain-result`. Use fixed native details and existing progress fields. Preserve capture progress before features, inherited traces, durable outcomes, current rate/freshness bounds and no automatic retry. Permission refusal does not revoke the SDK credential or misclassify a transport failure.

Raw PCM remains transient analyzer input. Only bounded raw numeric measurements and the public alias enter the authenticated event stream and existing private history. Setup discovery output, UIDs and configuration remain private and never become GitHub evidence. All development fixtures use synthetic identifiers and PCM. No extra retention or clearing mechanism is needed.

## Risks / Trade-offs

- A configured microphone may be absent or unauthorized. Advertise configuration honestly and make the explicit start result authoritative.
- Some microphones expose multiple streams or unsupported formats. Refuse them in this increment rather than change hardware settings or add an unqualified converter.
- Starting Bluetooth microphone input may cause OS route/profile effects even without route-setting calls. Physical qualification must check the selected hardware.
- Mic conditioning can conflict with renderer sensitivity/smoothing. Preserve raw features now; the remaining calibration/tuning work must establish one owner for each response control.
- A prior dashboard bundle may understand only 2.0. Integrate and migrate #722 before freezing or publishing a source candidate; install the bundled runtime/dashboard together later.

## Migration Plan

1. Complete this plan and accept the explicit version/consumer choices before product edits.
2. Implement producer/native, schemas and core in this isolated branch, with focused red/green tests.
3. Integrate the coordinated stable #722 revision, then migrate its bundled consumers. Re-scan imports and exact schema checks.
4. Prove old producer/new core, old stored Music state/new core and both-version consumer acceptance in disposable tests. Preserve old schemas and records. New microphone configuration requires the upgraded runtime; no automatic protocol downgrade occurs.
5. Run source checks, independent review and synthetic disposable acceptance, then sync/archive on the delivery branch. Source delivery changes no installation. The installation owner assesses the exact release and its private state before any later upgrade or recovery; this plan authorizes neither.
