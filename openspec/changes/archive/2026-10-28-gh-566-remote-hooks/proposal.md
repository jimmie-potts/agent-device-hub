## Why

[Issue #566](https://github.com/jimmie-potts/agent-device-hub/issues/566) needs
Codex and Claude observations from both computers at the accepted Mac core.
The private ingress exists, but producer admission and one-shot publication
still accept only the old loopback HTTP path.

## What changes

- Add an explicit private HTTPS producer transport with a matching installed
  receipt, preserving old local producers and their receipt rules.
- Support certificate-verified HTTPS in the existing one-shot SDK publisher.
  Preserve the total deadline, no redirects, no retry and existing outcomes.
- Bind helper-derived producer sources to their provider/client/host/source
  identity at private-ingress admission, before an observation reaches the bus,
  while retaining released local configuration hashes. The host policy follows
  ordinary SDK validation without adding a wire field.
- Keep both hook entrypoints bounded when native DNS work blocks process exit.
- Document enrollment, endpoint switching and actual-client qualification
  separately from the core container lifecycle.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `runtime-agent-hooks`: qualified remote producers and native setup.
- `bunny-sdk`: one-shot verified HTTPS publication.
- `bunny-runtime`: producer identity binding before remote admission.

## Impact

Runtime hook parsing, runtime gateway validation and SDK publication change.
No wire envelope, error shape, persistent state format, reducer, device writer,
broker or polling path is added. Existing private ingress and source grants
remain the receiving boundary. Live settings, credentials and client paths need
the selected setup authority; source tests do not establish installed coverage.
