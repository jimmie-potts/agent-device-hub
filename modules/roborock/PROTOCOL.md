# Read-only V1 adaptation

Protocol source: MIT [ioBroker.roborock at `ce998f6980b9928af800d8083cbe794f3b93ca97`](https://github.com/copystring/ioBroker.roborock/tree/ce998f6980b9928af800d8083cbe794f3b93ca97).
`UPSTREAM-LICENSE.txt` retains its complete notice. This package adapts protocol
primitives, not the adapter runtime or its fixture data.

| Source path at that revision | Adapted behavior |
| --- | --- |
| `src/lib/cryptoEngine.ts` | V1 timestamp shuffle, salt, MD5 key derivation and AES-128-ECB |
| `src/lib/messageParser.ts` | V1 publish header, CRC32, nested RPC envelope and map security context |
| `src/lib/localApi.ts` | TCP 58867 length prefix, CONNECT/CONNACK/control frames and inner request-ID correlation |
| `src/lib/mqttApi.ts` | RRIOT-derived client credentials, exact device topic, protocol 301 map envelope and inner AES-CBC/gzip |
| `src/lib/httpApi.ts` | Explicit v4 email-code setup, key signing, exact-device home lookup and Hawk signing |
| `src/lib/map/v1/MapParser.ts` and `docs/map/V1_Map_Protocol.md` | Raw map signature, supported 20-byte header and trailing SHA1 |

Omitted: discovery, endpoint refresh, automatic cloud fallback, automatic
login, password login, photo manager, product images, map switching, controls,
Sentry, adapter queues and body/exception logging. The selected MQTT dependency
is MIT `mqtt@5.16.0`, with MIT `debug@4.4.3` for retained-state refusal; automatic reconnect and offline publication are disabled.

## Byte and correlation rules

V1 has a 19-byte publish header: ASCII `1.0`, uint32 BE sequence, random value
and seconds timestamp, uint16 BE protocol and encrypted-payload length. A
uint32 BE CRC32 follows the payload and covers every prior frame byte. TCP adds
a uint32 BE frame length. Control frames have a distinct 17-byte header, without
publish length or CRC; CONNECT uses sequence/timestamp zero and includes a uint32 BE keepalive of 10 seconds. PUBACK retains the received sequence with random/timestamp zero.
The connection path issues no initialization RPC.

The AES-128-ECB key is MD5 of the timestamp's eight lowercase hex characters
shuffled by `[5,6,3,7,1,2,0,4]`, then the local key and the protocol salt.
Local RPC protocol is 4. Its payload is `{dps:{"101":JSON.stringify(inner)},t}`,
where `inner` is `{id,method,params}`. Responses use the inner `id`, separate
from socket sequence. Accepted envelope forms are nested `102`, nested `101`
or a direct response with an explicit `id` and result/error field. Missing
domain fields remain missing for #376 to normalize; an envelope without a
result or error is unusable.

MQTT uses protocol 101 for the one allowed map RPC. Its security includes
`endpoint = Base64(MD5(k)[8:14])` and a fresh 16-byte nonce in uppercase hex.
The account-derived MQTT username is `MD5hex(u+":"+k)[2:10]`, password
`MD5hex(s+":"+k)[16:]`, with the username as client ID. Publish to
`rr/m/i/{u}/{username}/{duid}`; accept only the selected device's response
topic. An `ok` reply acknowledges a map request; it is not the map.

Protocol 301's already outer-decrypted payload has a 24-byte header, with a
uint16 LE request ID at offset 16. Match that ID before decrypting its remaining
bytes using AES-128-CBC, the request nonce and zero IV, then bounded gzip
inflation. Validate `rr`, the supported 20-byte raw header and trailing SHA1.
The upstream source and generated document differ on `data_length` semantics;
only its byte bound is enforced here. No map version or geometry interpretation
is claimed. Preserve the original decoded bytes privately for the owning
collector and later coverage qualification.

## Source limits

One active read, eight waiting reads; deadlines include queue time. Defaults:
10 seconds per read, maximum 30 seconds, at most two attempts with 250 ms
backoff for connection/disconnect failures. Never retry authentication,
malformed data, unsupported decoding or cancellation automatically.

Publish framing follows its uint16 payload bound; JSON responses are at most
64 KiB. MQTT packets/encrypted maps are at most 1 MiB, with at most 64 packets per attempt; decompressed raw maps
at most 2 MiB. Bounds are supported capabilities, not claims about every
home. Invalid observations use safe registry errors; raw maps never use the
profile's 256 KiB message cap or enter a profile envelope.

## Evidence boundaries

Tests use synthetic account credentials, independent Python/OpenSSL vectors
and fake or loopback peers. No upstream personal map or owner's account/session
is a fixture. The source lists S8 MaxV Ultra and an `a97` feature class, but
its a97 status helper uses `get_prop ["get_status"]`; separate source tests
encode direct `get_status`. This transport preserves #1070's exact direct
read allowlist. That is source adaptation evidence, not actual a97 firmware
compatibility.

September Python observations linked from #1070 are independent historical
device provenance: local reads and vendor-MQTT current-map retrieval, with
historical-map timeouts. They do not renew device/account permission or prove
push status, current firmware, v4 account setup or installed acceptance. #376
retains those separately authorized comparisons.
