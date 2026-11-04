# RTCP workspace

This is an original Python standard-library RTCPv2 UDP structural receiver for
the finite SR/SDES compound profile. It sends no Receiver Report or ACK and
runs independently of the RTP workspace. It does not implement a complete
RTCP session, feedback/congestion system, media playback, jitter calculation
or network loss estimator. GStreamer is an independent acceptance oracle.

```json
{"bind_ip":"0.0.0.0","port":5005,"max_packet_size":2048,"packet_profile":"sr-sdes"}
```

`packet_profile` is a required literal with no implicit default. This fourth
field distinguishes RTCP from the existing three-field RTP configuration
without changing RTP serialization or fingerprints. Unknown/null fields,
incorrect types and booleans in integer fields are rejected. Host binding is
IPv4 unicast/wildcard; port is 1–65535; complete UDP capacity is 64–65507 bytes.
The largest four-byte-aligned RTCP datagram within that capacity is 65504 bytes.
A smaller valid compound remains accepted when capacity is larger.

The non-root container uses Docker bridge. Only UDP5005 is published at the
host binding; TCP18081 is a private read-only observer on the exact container
bridge IP and is never published. It does not open RTP5004 or depend on any
other running protocol. The manager verifies source container ownership,
image, network and port mapping before deriving the observer address, and
rechecks source identity after probing/testing. No Docker socket is mounted
into the one-time client.

## Finite profile and complete validation

The first subpacket must be SR/PT200, and this profile accepts only SR200 and
SDES202 subpackets. RR/BYE/APP/feedback and reduced-size RTCP are outside the
profile; they are not declared invalid RTCP in general. The entire compound
must validate before any accepted event or source state is committed.

Every subpacket has V2 and a bounded length in 32-bit words minus one; the
complete datagram is four-byte aligned. Only the final subpacket may have
packet padding. Its count is nonzero, four-byte aligned and cannot consume the
common header. Other packet-padding bytes may be nonzero. SDES chunk END
alignment is a separate rule and requires zero alignment bytes.

SR sender information and RC-dependent 24-byte report blocks must be complete.
Report blocks and additional profile-extension bytes are opaque, with original
length, SHA-256 and a bounded preview. Sender packet/octet counters are the
sender's declared wire values, separate from actual receiver counts. They do
not assert that the RTP workspace transmitted those packets. NTP is retained
as two uint32 words and exact `ntp64_hex`, never a lossy 64-bit JavaScript number.
This is not a clock synchronization test.

SDES validates the exact chunk count, SSRC, TLV lengths, END and alignment.
Unknown item types are opaque, not CNAME. Each chunk permits at most one
nonempty UTF-8 CNAME. The primary (first SR) SSRC must have a matching CNAME;
conflicting CNAMEs for that source reject the complete compound. Matching data
is found even beyond the displayed summary limits. Additional SR/SDES packets
are fully validated, not skipped after the primary is found.

## Bounded actual receipt evidence

Accepted `event.rtcp` retains complete primary sender fields and matching
CNAME, plus their byte hashes. It reports true subpacket/SR/chunk/item totals,
up to eight subpacket summaries and eight items matching the primary SSRC,
and explicit truncation flags. Summaries retain offsets/counts/padding and
body/item byte length/hash/preview. The remaining compound is still fully
validated; its complete raw SHA-256 is always retained.

The receiver holds 256 recent events and 128 source-tuple/primary-SSRC states.
All byte previews are at most 128 bytes. Evictions and dropped stdout log
records are counted separately; a fixed logger queue holds at most 256
records. Source summaries retain factual accepted counts/bytes and latest
sender-declared fields/CNAME hash, not unbounded strings or RTCP loss metrics.
Malformed and unsupported-profile packets produce bounded rejection codes and
the receiver continues running. There is no duration, request-count or log-file
expiry. SIGTERM closes listeners and active observer connections; unexpected
listener/logger failure fails the worker for manager recovery.

The private observer supports only read-only GET:

- `/v1/status`: schema1, `implementation="stdlib-rfc3550-rtcp-v2"`, fixed
  `packet_profile`, random boot ID, counter, actual internal UDP binding,
  capacity, counters and a bounded source snapshot.
- `/v1/observations?after=N&raw_sha256=H`: actual received events after N with
  that full raw hash. It cannot create, clear or mutate received evidence.

Query replies return the ordered prefix of matching events, at most 16 and
at most 64 KiB including all JSON metadata. `matched_count`, `returned_count`
and `truncated` reflect actual results; mandatory fields are not deleted to
fit. Source snapshots similarly report totals/returned counts/truncation.
Requests have one absolute one-second deadline, a 4096-byte header limit and
eight active connection slots. Slow header drips do not reset that deadline.

A client first samples boot ID/counter, sends actual randomized RTCP through
the published host UDP endpoint, and requires matching fresh events from the
same boot. Raw hash, full primary sender fields, exact NTP and matching CNAME
must agree. HTTP200, successful sendto, a stale event, or delivery to another
UDP receiver does not prove success. The evidence HTTP channel is not RTCP
feedback. The tested Docker proxy can discard zero-byte UDP before reception;
that transport boundary is distinct from valid SR/SDES compound traffic.

## Included client

```sh
docker run --rm --network host --entrypoint python3 protocol-target-lab/rtcp:0.1.0 \
  -u /opt/protocol-target-lab/client.py --host 127.0.0.1 --port 5005 \
  --observer-host "$DERIVED_CONTAINER_IPV4" --observer-port 18081 \
  --method ALL --path session --config-json "$APPLIED_JSON"
```

The manager supplies the trusted derived numeric observer IP. The client
starts no service, changes no configuration, follows no redirects and uses no
proxy environment variables. Each selected case runs twice; ALL has eight
checks, and every case fits the minimum 64-byte capacity:

- SR_SDES: RC0, randomized sender fields and matching nonce CNAME; 60 bytes.
- REPORT_BLOCKS: RC1 plus a full random 24-byte opaque block and one-byte
  CNAME; exactly 64 bytes, with nonce entropy in sender fields/block.
- SDES_ITEMS: CNAME, NAME and unknown item; validate all item metadata.
- PADDING: final SDES packet has four nonzero-content padding bytes and the
  correct final count; distinguish packet padding from END alignment.

`--health` performs one SR_SDES exchange using the same observation proof.
Each phase and socket is bounded by three seconds, the whole process by 30
seconds and stdout by one JSON report of at most 512 KiB. Complete success
exits0, failure exits1. `request.packets[].rtcp` describes sent fields;
`response.observations[].rtcp` contains actual receiver evidence and
`rtcp_reply_expected` is false. No RTCP data retry hides delivery failures.

## Supply chain and oracle boundary

The public Python3.12 base digest is pinned in
`images/rtcp/dependencies.lock.json`. `scripts/rtcp-fetch-deps.sh` is the explicit
online base preparation; with the prepared locked base cached,
`scripts/rtcp-images.sh` builds offline using `--network=none` and an allowlisted
context. No external runtime wheel/compiler/GStreamer package is added. The
base retains CPython LICENSE and OS package copyright files. Original sources
use MIT; image metadata declares MIT AND Python-2.0, while OS packages retain
their own licenses.

`scripts/rtcp-assets.sh` exports one runtime image, original source/tests,
recipes/base provenance, documentation and license with SHA-256 manifest. It
claims offline wrapper rebuilding from the prepared base, not a complete
operating-system/compiler source bundle. Private refs and old logs are not
build inputs. The existing RTP worker/image/recipe is unchanged.

Independent GStreamer core-GI `rtpbin` session inspection can consume identical
SR/SDES bytes and compare native source SR fields and SDES CNAME. The managed
receiver's raw hash must match that vector. This is independent packet/session
observation for those vectors, not media playback or a GStreamer runtime claim.
