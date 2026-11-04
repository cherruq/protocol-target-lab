# RTCP workspace acceptance

Manager 0.12.0 adds an independent RTCPv2 SR+SDES compound receiver with
Web/CLI configuration, lifecycle, logs, restart adoption and disposable tests.
Its original standard-library worker does not emit RR or ACK, require an RTP
workspace, decode media, or implement a full RTP/RTCP session stack.

## Profile and receive evidence

The required literal `packet_profile:"sr-sdes"` declares the supported profile
and distinguishes its configuration from existing RTP configurations without
changing their serialized bytes or fingerprints. Only compounds starting with
SR (200), containing SR/SDES (202), and providing a matching primary SSRC CNAME
are accepted. Other RTCP types are outside this profile, not described as invalid
RTCP in general. Version, word lengths, RC/SC, SDES TLVs/END/alignment, CNAME and
last-subpacket padding are validated over the entire compound before acceptance.
A bad later subpacket must reject the whole datagram even past summary limits.

Events retain the full primary SR and matched CNAME, raw hashes and bounded
summaries. Source/cache/log/query limits and evictions remain explicit. NTP
words are uint32 and the full value is an exact hexadecimal string; sender
packet/octet counts are declared fields, separate from actual receiver counts.

Only UDP 5005 is published. Read-only observer TCP 18081 stays private. The
manager derives its address from the exact owned running source container and
rechecks identity around readiness/testing. Startup readiness has an absolute
3-second deadline including status, UDP send and observation. Tests require the
same boot, a newer event, exact raw bytes/hash and parsed primary/SDES fields;
HTTP 200 and successful UDP send alone never pass. Each of SR_SDES,
REPORT_BLOCKS, SDES_ITEMS and PADDING runs twice and fits capacity 64.

## Independent verification and delivery

Verify RC31/SC31, CNAME beyond summary boundaries, conflicting/invalid CNAME,
unknown SDES items, malformed later subpackets, nonzero packet padding versus
zero chunk alignment, full-capacity traffic, report budgets and negative
observers. GStreamer native session SR/SDES observations can independently check
the same raw vector; this is not audio/video decoding or playback.

Configuration capacity is 64..65507 complete UDP bytes; RTCP word alignment
limits a legal compound to 65504. Valid capacity settings need not be multiples
of four. Zero-byte UDP forwarding through Docker's publication path is not
claimed. Preserve all previous workspace data and live container identities,
including RTP, throughout migration and recovery; pending drafts apply only on
explicit start/restart.

Build and install the manager/deb offline on Ubuntu 24.04 amd64, verify runtime
and source hashes, installed CLI/docs/Web assets, separate-node UDP receive
proof and systemd restart adoption. Describe any private observer forwarding
separately from the UDP data path. Keep unrelated manual services and containers
unchanged. Offline worker rebuilds require the prepared locked Python base;
a complete OS/compiler source bundle and whole-host reboot are not claimed.
