# Local Wemo plugs

The fixed TypeScript runtime module controls one or two owner-qualified Wemo Mini
F7C063 plugs on the local network. It uses bounded HTTP/SOAP and a pinned XML
parser, with no cloud account, Wemo app, discovery, subscription listener or
additional service. Physical model and firmware qualification remains separate
from API identity, source tests and transmitted command evidence.

## Private configuration

Give `modules.wemo.plugs` one or two entries in the runtime's private configuration:

```json
{
  "id": "desk-lamp",
  "label": "Desk lamp",
  "model": "F7C063",
  "address": "192.0.2.60",
  "port": 49153,
  "mac": "000000000001",
  "firmware": "owner-qualified-firmware",
  "configurationRevision": 1
}
```

This is a synthetic example. Enter the actual local address, advertised service
port, independently read device MAC and qualified firmware privately. The router's
network MAC can differ from the device API MAC; do not infer one from the other.
Requalify a changed device/address/firmware and increment its configuration
revision. Runtime setup does not provision Wi-Fi, reset the plug, inspect/change
its native saved rules or upgrade firmware. Avoid competing app/rule writers.

The module verifies identity and same-origin service paths before every power
write. Each plug has its own bounded queue and private writer lease. Five-second
reads publish `device/2.1` observed power; unavailable or stale evidence never
means off. The generic card shows desired power, observed power and observation
age separately. A successful SOAP reply establishes transmission, not visible
lamp output.

Commands use generic `power-set/2.0` through the core's tracked dispatcher. Durable
request fences prevent duplicate effects and restart replay. A write whose reply
is lost creates a persistent hold. Polling, startup and schedules cannot clear it.
The card's explicit **Release Wemo hold** command carries the exact held request,
configuration revision and generation; it performs a fresh identity/power read
and clears the hold without sending power or retrying the old request. Inspect
current evidence before issuing a new power command.

## Scheduling and maximum-on limits

Weekly schedules belong to the shared core Automation editor. This module has no
scheduler. A manual off or maximum-on shutoff does not cause an on-window to
continually turn the lamp back on.

The generic device card offers an independent optional maximum-on limit for each
plug. Saving duration does not enable it. The Hub stores the original continuous
run start and one shutoff-attempt identity; repeated on commands, duration edits
and restarts do not grant a fresh duration. A fresh off observation ends a run.
If an enabled limit sees on without a trustworthy start, it requests off. This
includes startup/reconnect with unknown elapsed time. Turning a limit off sends
no device command. A blocked or uncertain attempt is never automatically retried.

Enforcement requires the Hub running and a reachable plug. This feature provides
no device-resident or offline shutoff guarantee. An accepted or transmitted off
request is not evidence that a lamp physically went dark.

## Verification

Use Node 24 from the repository root. Run `npm run test:wemo`,
`npm run test:wemo:browser`, the shared build/type/lint/contracts/workflow checks
and the runtime scenarios. Tests use loopback SOAP or synthetic plugs. The
`wemo-power-limit` scenario exercises the production module, core, gateway and
SDK state across restart; browser checks include page-closed enforcement and
independent plugs, with desktop/phone accessibility.

These source checks do not activate real devices. Installation needs exact
release/latest-state/recovery admission under the runtime upgrade procedure.
Physical schedule/maximum-on acceptance needs a separately authorized named-device
sequence. Keep private configuration and original physical receipts out of Git
and GitHub.
