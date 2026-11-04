# RTP workspace acceptance

Manager 0.11.0 adds a fixed RTP workspace. Image 0.1.0 is a project-owned
standard-library Python RTPv2 UDP structural receiver, with opaque payloads.
It does not decode/play media, implement RTCP session statistics, or generate
RTP acknowledgements. The original laboratory receiver's header, CSRC,
extension and padding behavior informs the implementation.

## Acceptance criteria

- Publish only the configured host UDP endpoint to container UDP 5004. A
  read-only receiver observer on container TCP 18081 is never published.
  No Docker socket, host network or privileged mode is needed by this worker.
- Before testing, derive the observer address from the exact owned running
  source container. A client samples its boot ID and counter, sends a fresh
  nonce-bearing RTP packet to the published host endpoint, and checks a later
  actual receive event's full raw/payload hashes and parsed fields. HTTP 200,
  an open port and successful UDP send are insufficient. Replacing/stopping
  the source container invalidates a client result.
- BASIC, CSRC_EXTENSION, PADDING and SEQUENCE run twice each. SEQUENCE covers
  65534/65535/0/1 and a duplicate without treating wrap/duplication as malformed.
  Source/SSRC counts describe received data; sequence gaps are not claimed
  network loss, and no unknown-clock jitter is computed.
- Independently check empty payloads, all 15 CSRCs, empty/opaque extensions,
  nonzero padding bytes, timestamp wrap, configured packet capacity and
  malformed lengths/version/padding. Rejection must leave the service usable.
- Recent events, source states, log queue, previews, observer connections,
  absolute request deadline and response sizes remain bounded. Eviction and
  dropped log records are reported separately from received/rejected packets.
- Wrong observers, stale boot/counter, incorrect hashes/fields and no receive
  observation must fail. A separate GStreamer PCMU depayloader can verify the
  same raw packet vector independently; depayloading is not media playback.
- Web/CLI support saved and applied snapshots, start/stop/restart, actual state,
  logs and disposable tests. Manager restart adopts the original owned
  container without silently applying pending drafts. Migration preserves all
  previous workspace identities, serialized configurations and fingerprints.

## Delivery boundary

Build the native manager/deb offline for Ubuntu 24.04 amd64, verify the exported
runtime/source hashes, embedded Web assets and installed CLI, and run a real
separate-node UDP receive check. The receiver's private observation channel
must be described separately from the RTP data path. Preserve unrelated
containers and manual listeners throughout deployment. Manager restart recovery
is required; whole-host reboot, Docker daemon changes, audio playback, physical
link performance and a complete multimedia/RTCP stack are outside this phase.

The tested Docker publication path did not deliver zero-byte UDP datagrams to
the receiver, while direct private-bridge delivery produced `short_header` as
expected. Forwarding zero-byte UDP through Docker is not claimed. This differs
from a valid 12-byte RTP packet with an empty payload, which the receiver accepts.
No host routing or Docker daemon setting was changed to hide that distinction.
