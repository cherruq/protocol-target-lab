# Single-label MPLS IPv4 Echo target

This workspace is a finite software target. It receives an actual Ethernet
unicast MPLS frame (EtherType8847), validates one ordinary label and an enclosed
IPv4 ICMP Echo Request, and returns a plain unlabelled IPv4 Echo Reply
(EtherType0800). It is not a general MPLS LSR/LER, label-switching router,
LDP/RSVP implementation or RFC4379 MPLS OAM Echo service. Starting it does not
configure host MPLS routes, labels, modules or sysctls. There is no RTP dependency.

## Configuration

All nine top-level fields are required. Unknown/null fields, wrong types and
boolean integers are rejected. Link and scenario tagged objects are replaced
atomically when patched; saving a draft does not apply it to the running source.

```json
{
  "wire_profile":"mpls-single-label-ipv4-icmp-echo",
  "link":{"mode":"docker-bridge"},
  "source_mac":"02:00:00:00:58:20",
  "source_ip":"198.18.58.20",
  "client_mac":"02:00:00:00:58:10",
  "client_ip":"198.18.58.10",
  "label":58,
  "reply_ttl":64,
  "scenario":{"mode":"normal"}
}
```

Labels are 16–1048575 and reply_ttl is 1–255. Source/client MACs must be distinct
nonzero unicast addresses, serialized lowercase. Role IPv4 addresses must differ;
0/8, multicast and all-ones broadcast are excluded. They are simulated protocol
roles, not OS addresses assigned by the worker. Role and current fault-mutated
IPs must not collide with actual OS endpoint or gateway addresses. The new test
peer checks its own assigned addresses after creation as well as source proof.
There is no application UDP/TCP bind_ip or port.

The default is a dedicated manager-owned internal Docker bridge. Source and
one-shot peer have separate real veth endpoints with their configured role MACs.
Both use UID0 with all capabilities dropped except NET_RAW. Network identity and
foreign endpoint checks protect adoption and cleanup; no permanent fake peer runs.

The alternative link is
`{"mode":"host-interface","interface":"eth0"}`. It uses an existing UP
Ethernet interface whose actual MAC equals source_mac. It changes no interface,
address, MAC, route, neighbor, promiscuous setting, module or sysctl. Host startup
preflight rejects conflicting real role IPs and a conflicting native label route.
The builtin peer requires exactly one different existing UP interface with
client_mac; otherwise run the explicit same-image peer on the actual external
host. The peer supplies its own --interface name. PACKET_OUTGOING on the target's
same interface is never an incoming response. This is not a generic L2 carrier
or an automatic VXLAN/remote-SSH setup facility.

## Wire behavior and scenarios

The source binds one AF_PACKET SOCK_RAW/ETH_P_ALL socket for both receive and
transmit. A fixed four-instruction cBPF admits EtherType8847 only. Kernel filter
readback, hash, socket inode, actual interface/ifindex/MAC/MTU and AUXDATA support
are available in runtime status. No libpcap library is required. Incoming
PACKET_OUTGOING, truncated capture and VLAN auxiliary metadata are rejected.
VLAN/QinQ and EtherType8848 are outside this finite profile; stripped hardware
tags are not inferred from expected data or silently treated as untagged.

Only one shim with S=1 and the exact configured label is accepted. TC0–7 is
observed; MPLS TTL must be at least2. The inner packet must be IPv4/IHL5 with a
complete TotalLength of at least28, valid IP and ICMP checksums, nonzero IP TTL,
protocol1 and ICMP Type8/Code0. Reserved IP flags, MF/nonzero fragment offset,
options and multiple label stacks are rejected. DF is allowed. Source/destination
MAC/IP and actual packet metadata must match current configured roles.

The request data cap is65553 bytes, but the complete Ethernet payload including
the MPLS shim must also fit the actual interface MTU. A large parser cap is not
a claim that a standard MTU1500 link carries jumbo frames. Ethernet tail padding
is separate from the IP payload and is not echoed as ICMP data.

A normal response swaps role MAC/IP, uses Type0/Code0, and echoes the current
ICMP identifier, sequence and payload. It retains request IP TOS and only DF,
uses configured reply_ttl and a target-generated incrementing 16-bit IPv4 ID,
and recomputes IP/ICMP checksums. It pads Ethernet frames to60 bytes outside
IP TotalLength. This new packet's TTL is not a claim of native MPLS TTL propagation.

| Applied target scenario | Actual response |
|---|---|
| normal | Plain IPv4 ICMP Echo Reply |
| silent | Accept current valid request, suppress response |
| wrong-eth-src / wrong-eth-dst | XOR last byte of corresponding MAC with1 |
| wrong-ip-src / wrong-ip-dst | XOR last IPv4 byte with1 and recompute checksums |
| wrong-id / wrong-seq | Add1 modulo65536 and recompute checksum |
| wrong-payload | XOR first payload byte with1; empty becomes01; recompute lengths/checksums |
| bad-ip-checksum / bad-icmp-checksum | Flip corresponding checksum byte after encoding |
| short-ethernet | Intended response truncated to13 bytes |
| short-ipv4 | Response truncated to33 bytes |
| short-icmp | Response truncated to41 bytes |

The short-ethernet selector remains explicit. On the two tested Linux kernels,
AF_PACKET rejects a13-byte Ethernet submission with EINVAL22. The source records
the current request's tx_error, intended length/hash and errno and remains ready;
it does not pad the frame to fabricate successful13-byte output. Positive tests
report environment_unavailable/failure rather than treating this as silence.
INVALID_REQUEST can still pass separately. Submission success for33/41 bytes
on software veth does not establish an undersized physical wire frame: drivers
may pad or discard it. Submitted bytes and actual captured peer bytes remain
separate; an accepted zero-padding match is explicitly labelled with its byte count.

## Same-image tests and runtime evidence

Cases ECHO, TC_TTL, PADDING and INVALID_REQUEST each run two rounds. ALL runs the
current applied scenario with8 checks/8 actual requests; it does not change the
source to normal or cycle through fourteen configurations. Normal/fault replies
need6 actual matched responses in ALL; silent requires0. INVALID_REQUEST uses
wrong label then TTL1, with fresh rejection proof and a bounded no-response window.
TC_TTL covers TC0/7 and label TTL2/255. PADDING uses odd payload length and a
nonzero Ethernet tail to prove only the IP payload is echoed.

Each request gets fresh ICMP id/sequence and random payload bytes. Source observer
request SHA/ID, accepted/rejected event and output event must belong to that
current request. Positive matching verifies full actual opaque bytes against the
applied fault; malformed checksum/truncated responses are not discarded merely
because they fail a normal decoder. A source TX submission is not proof of peer
reception. Peer metadata must show real incoming direction on its actual interface.

The private observer is read-only TCP18089: bridge0.0.0.0 without publication,
host127.0.0.1. Endpoints are `/v1/status` and
`/v1/events?after=CURSOR&limit=16`; clients advance only to the last returned
ordered event, preserving records after a bounded/truncated page. Runtime status
contains actual socket/filter/interface identity, boot/runtime/config hashes,
ready/mainloop age, scenario, label, reply_ttl, counters, last_request and
last_output. A tx_error last_output describes intended bytes, never actual TX.
The event ring holds256 records, pages at most16/64KiB, previews128 bytes, HTTP
headers8KiB, eight concurrent slots and an absolute one-second request deadline.
Logs are bounded JSONL on stdout; no duration, packet-count or logfile budget
terminates a healthy managed target.

Each client check has an absolute3-second deadline and negative/silent observation
uses0.5 seconds. Total client budget is30 seconds; manager execution40 seconds
plus5 seconds for exact-owned cleanup. Observer and socket work share those
absolute budgets. JSON reports are at most512KiB and separate check totals,
actual_requests and actual_responses. These are actual counts, not the planned8.
Related unexpected incoming replies during a required quiet window are included
in actual_responses and separately in unexpected_responses. Failed checks retain
their actual frame hash/length/preview, packet metadata and association reason.
Quiet association uses current ICMP identifiers and Ethernet/IP roles even when
the entire payload or checksums are wrong. Partial role/identifier prefixes are
treated conservatively; they do not establish a unique wire transaction ID.
Unrelated ARP, TCP and other-role traffic do not count as an associated reply.

An external same-image peer uses its own real client-side Ethernet interface:

```sh
docker run --rm --network host --user 0:0 --cap-drop ALL --cap-add NET_RAW \
  --entrypoint python3 protocol-target-lab/mpls:0.1.0 \
  -u /opt/protocol-target-lab/client.py --config-json "$CONFIG_JSON" \
  --interface eth0 --observer-host 127.0.0.1 --observer-port 18089 \
  --expected-boot-id "$BOOT_ID" --expected-runtime-id "$RUNTIME_ID" \
  --method ALL --path echo
```

An explicitly configured private observer TCP forward may carry HTTP control
only. It does not carry or proxy the actual MPLS request or IPv4 reply.

## Build and boundaries

`make fetch-mpls-deps`, `OFFLINE=1 make mpls-images` and `make mpls-assets` prepare
the fixed public Python3.12 base, build autonomous standard-library code offline
and export runtime/source/tests/recipes/docs/licenses. CPython and base OS notices
remain in the image. Rebuilding requires the matching prepared base cache;
this export is not complete OS/kernel source distribution.

The software target itself needs no Linux native MPLS forwarding enabled. Native
Linux label-pop/ICMP, independent raw-byte verification, software bridge, physical
LAN and deployment/adoption are separate evidence layers. Kernel oracle settings
belong only in explicitly owned validation namespaces and are not product startup
steps. No claim of complete native routing, physical VLAN/runt delivery, general
label stacks or all MPLS standards follows from a successful finite Echo test.
Current phase acceptance is recorded separately after independent verification.

## Layered short-Ethernet verification (manager0.24.0 / image0.1.1)

Original `ALL`, `ECHO`, `TC_TTL`, and `PADDING` retain their Ethernet receive
requirement. Exact13-byte `EINVAL22` is `outcome: environment_limited`, not a pass.
Schema2 partitions summary counts into passed, failed and environment_limited;
`passed` remains false, the run status remains failed for compatibility, and the
waiting CLI exits1 with error code `environment_limited`. Other errors still fail.
Old schema1 reports and old source-container adoption remain supported.

`TX_BOUNDARY` is a separate opt-in case for applied `short-ethernet`, never part
of ALL. It requires the actual source image capability
`io.protocol-target-lab.mpls-tx-boundary-schema=1`; an old running source is retained
and must be explicitly restarted with the new image. Web labels and describe
explanations use the shared backend catalog.

```sh
plabctl config set mpls --scenario-json '{"mode":"short-ethernet"}'
plabctl restart mpls
plabctl tests run mpls --method ALL          # Receive layer: limited here, exit1
plabctl tests run mpls --method TX_BOUNDARY  # Boundary layer: six checks, exit0 on success
```

The six checks use ECHO, TC_TTL and PADDING requests twice each. Each shares an
absolute3-second deadline with one invalid-request processing control before and
after it. A complete successful run sends18 actual requests and receives0 replies.
Checks independently construct the expected13 bytes (destination6 + source6 +
08), match actual source error length/hash/preview, require errno22 and
submitted=false, bind accepted/error events to the current request SHA/ID/order,
verify accepted/tx_error +1 with no suppressed/tx_submitted increment, require
same source identity/readiness and no role-associated response for500ms, and
require both fresh processing controls to succeed. Any other errno, missing or
stale proof, unexpected response, changing identity or failed control fails.
If a platform permits TX, this rejection test fails rather than silently changing
into a receive test. Reconfiguring to normal and verifying actual Echo is a
separate recovery test with a new applied snapshot.

JSON reports, Web summaries and CLI distinguish `verification_layer: tx_boundary`
from `ethernet_receive`. Boundary success never proves13-byte peer reception;
there is no padding, synthetic network, mocked send, alternate transport, or
implicit configuration switch. The real source AF_PACKET send path is unchanged.
