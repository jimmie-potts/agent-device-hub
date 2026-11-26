## Context

Companions already owns the task transcript, private message reads and
model-bound tool results. The two supervisors use distinct wire formats and pin
their model, effort and costs on task admission. The existing privacy checks
include conversation provenance and saved disclosure evidence, but some are
specific to one provider. [Proposal](proposal.md)

## Goals / Non-goals

Use the active owner request, conversation, companion and purpose to select
allowed material before formatting a model request. Keep the selection bounded
and recheck its retained fields before every disclosure. Provider pinning,
command approval, capture and the existing device and worker contracts are
outside the policy change.

## Decisions

- Keep selection and disclosure tracking in Companions. The engine can see the
  current owner turn, local field grants, provenance of derived text and scope
  of tool calls. Adapters format those inputs and keep provider-native
  continuation restricted to the originating task and adapter. Putting policy
  in each adapter would duplicate checks and leave discovery and private reads
  outside their reach.
- Use the existing rule fields and a common external-model destination. Retain
  purpose distinctions for supervisor requests and titling. Keep local reads
  and worker briefs on their respective grants. Evaluate legacy choices before
  granting fields in the common policy. This prevents provider availability
  from changing effective permission after restart.
- Route turn assembly, current and recent transcript, device discovery and
  history, model-bound tool results, title inputs and saved replay through the
  corresponding purpose check. For explicit on or off times of one device in
  one period, use the same common policy and bounded timestamp projection for
  both adapters. A task may keep private saved records even when
  current grants no longer allow reuse. A queued coding brief keeps the
  approval and the existing worker check.
- Nanoleaf sends track labels, style and bounded analysis through its show
  authoring request. Art sends its own idea and image requests through its
  respective adapters. These calls keep their approved purposes and input
  contracts. The coding worker and the delivery orchestrator keep their
  separate authorities.
- Use the existing model call and tool refusal paths. Missing required input
  refuses before transport. A request that may have reached the provider
  remains uncertain. Preserve the request and trace identities within
  B.U.N.N.Y. and use the existing call records without publishing selected
  text, device labels, or opaque provider items.
- Keep the ordinary Conversation submission controls and their existing
  input handoff. Apply the common policy to the text as submitted and
  recheck grants before provider transport. Existing secret files and
  transport authentication stay outside model input.

## Risks / trade-offs

A reference can be ambiguous. Limit reuse to bounded excerpts of the same
conversation and return no retained device facts if the reference cannot be
resolved within scope. Rebuild the scope after a steer. A grant can change
after assembly, so recheck retained and derived fields at submission and
discard a replay that cannot pass the check.

## Migration plan

Normalize legacy configuration in memory and preserve the private originals.
Keep explicit denials, and report conflicts locally with the affected fields
private. Preserve the original task/provider pins and existing call receipts.
Verify with disposable fixtures before the separate installed qualification.
