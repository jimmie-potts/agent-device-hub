## Why

The owner approved a useful Mac-local dashboard for the reduced personal setup
under #1167. The existing isolated container cannot serve a host browser because
its socket is container loopback, networking is none and the operator refuses ports.

## What Changes

- Add one explicit core-only host-local container profile at127.0.0.1:18788.
- Separate its socket bind from unchanged canonical Host/Origin checks.
- Reuse trusted-local browser sessions with an empty client-credential document.
- Admit only its dedicated ordinary bridge and exact configured/effective loopback TCP binding in the operator; outbound connectivity is explicitly permitted.
- Qualify the actual Mac browser path before leaving that new private instance running.

## Capabilities

### Modified Capabilities
- `bunny-container-operator`: optional host-local browser access and narrowly admitted manual backup.

## Impact

Runtime startup inputs, container entrypoint/Compose, fresh public-shape
provisioning, operator admission and focused tests/docs. No new API, token grants,
device controller, migration, LAN ingress, automatic startup or service framework.
Mac is normal host; PC stays a stopped alternative. Preserve existing Tronbyt.
