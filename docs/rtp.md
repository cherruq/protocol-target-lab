# RTP workspace

This workspace is an original Python standard-library RFC3550 RTPv2 UDP
structure receiver with a bounded private observation interface. Payload bytes
are opaque. It sends no RTP acknowledgement and provides no media decoding,
playback, RTCP feedback, session negotiation, jitter calculation or network
loss estimate. GStreamer is an independent acceptance tool, not the runtime.

```json
{"bind_ip":"0.0.0.0","port":5004,"max_packet_size":2048}
```

The configured host binding accepts IPv4 unicast/wildcard and port 1–65535.
`max_packet_size` is an integer 64–65507 and counts the complete UDP payload,
including RTP headers, extensions and padding. It limits the maximum accepted
packet; a valid 12-byte empty-payload RTP packet is still accepted.
A zero-byte UDP datagram is a different, malformed input: the tested rootful
Docker publish proxy can discard it before the receiver. No forwarding
guarantee is made for zero-byte UDP; direct bridge reception rejects it as
`short_header`. This does not affect empty-payload RTP with its 12-byte header. Unknown or
null fields, booleans in numeric fields and invalid types are rejected.

The non-root container uses Docker bridge networking. Only internal UDP 5004
is published at the configured host endpoint. TCP 18081 is a private read-only
observer on the container bridge address and is never published; the receiver
does not open RTCP port 5005. The manager derives the observer IP from the exact
owned running source container, its network, image and port mapping. No Docker
socket or host filesystem is mounted into the once-only test client.

## What is received

The receiver validates V2, the 12-byte header, 0–15 CSRC entries, the extension
header and its declared 32-bit word count, and the final padding count. The
extension profile/content are opaque; RFC8285 subelements are not interpreted.
Padding may contain nonzero bytes and is removed exactly once before payload
hashing. Empty payloads and zero-word extensions are accepted. Sequence and
timestamp wrap, duplicate and reordered packets remain valid structures.

Each actual UDP datagram produces either an accepted observation or a bounded
rejection with `short_header`, `wrong_version`, `truncated_csrc`,
`truncated_extension_header`, `truncated_extension_data`, `invalid_padding`,
or `packet_too_large`. A malformed packet does not stop the service. Header
fields, payload length/hash and extension metadata come from received bytes.

A ring retains the latest 256 observations; up to 128 source-tuple/SSRC entries
retain factual accepted counts, payload bytes and first/latest sequence and
timestamp. Eviction is explicit. These counters do not claim packet loss or
RFC3550 RTCP statistics. Original byte lengths and SHA-256 are retained; raw,
payload and extension previews are limited to 128 bytes. A fixed stdout logger
queue holds at most 256 records; dropped log records are counted separately.
The observer's received/accepted/rejected counters describe actual receiver
callbacks, not packets that the kernel or network never delivered.

There is no global duration, packet-count or log-budget expiry. SIGTERM closes
both listeners and active observer connections with bounded cleanup. Unexpected
UDP/observer listener or logger failure fails the worker. The manager supervises
recovery. Docker log rotation bounds the external stdout history.

## Real receipt proof without an RTP ACK

`GET /v1/status` returns schema 1, implementation `stdlib-rfc3550-v2`, a random
`boot_id`, the current `counter`, `udp_bound`, `max_packet_size`, bounded stats
and source snapshots. A successful status request alone does not prove RTP.

`GET /v1/observations?after=N&raw_sha256=H` reads actual retained UDP events. It
cannot create, reset or inject observations. Results include `boot_id`, current
counter, earliest retained event ID, `matched_count`, `returned_count`, and
`truncated`. Matching events are ordered by event ID and capped at 16 per reply;
complete required fields/hashes are retained even when more matches exist.
Responses are at most 64 KiB. Headers are limited to 4096 bytes, each request has
one absolute one-second deadline, and at most eight requests are active.

Each event has `boot_id`, `event_id`, `received_monotonic`, observed UDP source,
`accepted` and bounded `raw` metadata. An accepted event also has `rtp` with all
header fields, CSRC list, extension profile/word count/content metadata,
`padding_octets`, `payload_offset` and bounded `payload` metadata. Rejections
have an `error_code`. A source tuple can be rewritten by Docker UDP proxy/NAT;
it is displayed as observed rather than assumed equal to the sending socket.

The client samples boot ID/counter, sends freshly randomized RTP through the
host's actual published UDP endpoint, then requires observations from that same
boot strictly after the sampled counter. Full raw/payload hashes and all RTP
fields must match the bytes actually sent. Merely sending a datagram, reaching
an unrelated UDP listener, receiving HTTP 200, or finding a stale/colliding SSRC
is insufficient. An unavailable private observer causes an explicit failure.
The private HTTP evidence channel is not an RTP extension or acknowledgement.

## Included client

The manager supplies its trusted derived observer address. A manual invocation
on the target host follows the same path:

```sh
docker run --rm --network host --entrypoint python3 protocol-target-lab/rtp:0.1.0 \
  -u /opt/protocol-target-lab/client.py --host 127.0.0.1 --port 5004 \
  --observer-host "$DERIVED_CONTAINER_IPV4" --observer-port 18081 \
  --method ALL --path stream --config-json "$APPLIED_JSON"
```

The client never starts or changes a service. Observer addresses are numeric
IPv4; redirects, arbitrary URL paths and HTTP proxy environment settings are
not used. Each selected case runs twice; ALL performs eight checks:

- BASIC: V2/PT96 random nonce payload, SSRC/sequence/timestamp and varying M.
- CSRC_EXTENSION: three CSRCs, profile 0x1234, eight opaque extension bytes and
  payload; the complete packet fits the minimum configured 64-byte capacity.
- PADDING: nonzero padding bytes with final count seven; compare the correctly
  stripped payload hash.
- SEQUENCE: one SSRC with 65534/65535/0/1 plus a duplicate; require observed
  multiplicity while allowing network reorder and making no loss-rate claim.

`--health` performs one BASIC packet and the same fresh receipt proof. The
manager's native health probe uses an equivalent small random packet and
private read-only query. Socket and per-case observation deadlines are at most
three seconds; the complete client run is limited to 30 seconds. RTP data is
not retried to hide delivery failures. One JSON report (at most 512 KiB) is
written to stdout, with exit 0 for complete success or 1 for failure.
`request.packets` describes actual transmitted bytes; `response.observations`
contains the received evidence and identifies its private observer origin.
`rtp_reply_expected` is false. There is no HTTP/RTP status or artificial ACK.

## Build, source and acceptance boundaries

`scripts/rtp-fetch-deps.sh` is the explicit online step for the public Python
base digest pinned in `images/rtp/dependencies.lock.json`. With that prepared
base cache present, `scripts/rtp-images.sh` builds the original wrapper/client
offline using `--network=none` and a small allowlisted context. No new external
runtime package, wheel or compiler is required. The image retains the base's
CPython LICENSE and Debian package copyright files; the original wrapper uses
MIT, and the image declares MIT AND Python-2.0, with base OS packages retaining
their own licenses.

`scripts/rtp-assets.sh` exports the one runtime image, original worker/client and
tests, build recipes, dependency/base provenance, documentation and MIT license,
with a SHA-256 manifest. It supports rebuilding this wrapper from the prepared
locked base. It is not a claim to distribute a complete offline operating
system/compiler source archive. Private reference material and historical logs
are not public build inputs.

Independent acceptance can feed the exact same known PT0/PCMU RTP byte vectors
to GStreamer's `rtppcmudepay` and compare extracted mulaw bytes with the known
payload. This proves PCMU depayload behavior for those vectors, not audio
playback. It does not make GStreamer a runtime dependency or replace proof that
the managed receiver actually observed the same wire bytes.
