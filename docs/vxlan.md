# VXLAN ARP software VTEP

The fixed VXLAN workspace is a finite IPv4 unicast VTEP for Ethernet/IPv4 ARP.
It validates a current VXLAN/Ethernet/ARP Request and returns a newly constructed
ARP Reply, or the configured target-side fault. It is not a UDP echo, a general
learning bridge, an arbitrary inner-Ethernet carrier or an RTP service dependency.
VLAN/QinQ, multicast VXLAN, GBP/GPE, EVPN, IPv4/ICMP replies and physical network
performance are outside this profile.

All13 configuration fields are required:

```json
{
  "wire_profile":"vxlan-ipv4-arp",
  "bind_ip":"127.0.0.1","port":4789,
  "peer_ip":"127.0.0.2","peer_port":4789,
  "source_port":55029,"vni":1000,
  "inner_ip":"198.18.0.20","inner_mac":"02:00:00:00:00:20",
  "requester_ip":"198.18.0.10","requester_mac":"02:00:00:00:00:10",
  "reply_padding":0,"scenario":{"mode":"normal"}
}
```

The profile is a required literal. Addresses are explicit unicast IPv4; the
whole0/8 range is rejected except exact requester_ip0.0.0.0 for ARP probes.
Inner roles must have different IPs and nonzero unicast MACs. MAC input uses six
two-hex octets; mixed case is accepted and canonically saved/hashed in lowercase.
Port/peer_port are1..65535, source_port49152..65535, VNI0..16777215. VNI0 is
supported. reply_padding is exactly0 or18, producing inner42 or60 bytes excluding
FCS, and VXLAN UDP bodies50 or68 bytes. Null, unknown keys, wrong scalar types and
invalid ranges are rejected. Saving checks syntax; start checks actual local
address membership independently of whether a permissive bind could succeed.

The runtime uses host networking, uid0:0 and cap-dropALL plus NET_BIND_SERVICE
only. There is no NET_RAW/NET_ADMIN, kernel device, Docker-socket mount or host
network mutation. It owns two exclusive UDP sockets: bind_ip:port receives, and
bind_ip:source_port sends to the FIXED peer_ip:peer_port. It does not reply to
the Request's source port. UDP reuse is forbidden. Same outer IP is permitted
only if port, source_port and peer_port are distinct; different outer IPs may use
equal numeric ports. The default pair is real loopback without address addition.
VXLAN can traverse routed underlays; no BFD TTL255 restriction is imposed.

## Request gate and target modes

A valid Request needs the complete8-byte VXLAN header with I=1 and matchingVNI,
Ethernet EtherType0806, broadcast or inner_mac destination, requester_mac source,
ARP htype1/ptype0800/hlen6/plen4/opcode1, requester SHA/SPA and configured inner
TPA. The outer source must equal peer_ip. Request source port has no added
high-port restriction. Request THA is ignored, and other base VXLAN flag/reserved
bits are accepted and recorded. This does not implement their extension semantics.
Trailing request bytes are padding with bounded length/hash/preview, not a second
packet. Invalid Requests never produce a Reply or suppression business event.

Normal Reply has I=1/reserved-zero and the configured VNI. Its Ethernet source
and ARP SHA/SPA are the inner target; destination and THA/TPA are the validated
current requester. Reply does not echo Request reserved bits or trailing nonce.
Each accepted Request receives the applied mode:

| Mode | Target output |
| --- | --- |
| normal | Complete normal Reply |
| silent | Causal suppression, no datagram |
| wrong-vni | VNI+1 with24-bit wrap |
| clear-i | I bit cleared |
| wrong-eth-dst | Inner destination MAC last octet XOR1 |
| wrong-sha | ARP SHA last octet XOR1 |
| wrong-spa | ARP SPA last octet XOR1 |
| wrong-tha | ARP THA last octet XOR1 |
| wrong-tpa | ARP TPA last octet XOR1 |
| short-header | Exactly the first7 bytes |
| short-arp | Exactly the first49 bytes, regardless of Reply padding |

Scenario is an exact `{ "mode": "..." }` object; changing it replaces the whole
tagged object. Modes persist until explicit application/restart. A malformed
Request to the target is a different test direction from its intentionally
malformed Reply; one cannot substitute for the other.

## Causal observation and tests

A private read-only observer binds only127.0.0.1:18085. The manager correlates
actual owned CID/image/PIDStartedAt and all three socket inodes with runtime
nonce, boot ID and canonical normalized configuration hash. `GET /v1/status`
shows binding, counters, last valid Request and main-loop heartbeat. A bound UDP
socket is not a tunnel-connected/Up state. Health sends no fake ARP, and HTTP
threads cannot refresh a stalled protocol loop.

`GET /v1/events?after_event_id=N&limit=16&request_sha256=HASH` provides bounded
causal records. Every received datagram gets a request_id and full raw SHA;
accepted/rejected and actual-send/suppression records retain that same cause.
Actual sendto success establishes socket submission, not remote delivery. The
observer uses8 slots before thread creation, absolute1s requests, at most64KiB
responses,256 cached events,16 events per query and128-byte previews.

The same-image client uses:

```sh
python3 /opt/protocol-target-lab/client.py --host 127.0.0.1 --port 4789 \
  --method ALL --path arp --config-json "$APPLIED_CONFIG_JSON" \
  --observer-host 127.0.0.1 --observer-port 18085 \
  --expected-boot-id "$SOURCE_BOOT_ID" --expected-runtime-id "$SOURCE_RUNTIME_ID"
```

ARP, RESERVED_BITS, REQUEST_THA and INVALID_REQUEST run twice; ALL is8 checks
for the CURRENT applied mode. It never reconfigures the target to run11 modes.
ARP covers broadcast/unicast destinations, RESERVED_BITS verifies ignored header
bits, REQUEST_THA verifies that field is ignored, and INVALID_REQUEST checks
wrongVNI/wrongTPA rejection even in a target fault mode.

Each Request carries a fresh16-byte nonce in legal18-byte Ethernet padding.
ARP has no transaction ID and Reply intentionally does not echo it. Fresh
exclusive peer_port binding, Request SHA/counter baseline, causal source events
and independently received exact-mode Reply bytes jointly prove the supported
interaction. The sending socket uses a different source port, so a direct UDP
echo to that port fails. Silent/reject success also requires fresh source evidence
and a0.5s no-response observation; timeout alone cannot pass. No HTTP200 or sendto
result stands in for actual reply delivery.

The complete run is limited to30s, each check to an absolute3s including observer
and0.5s quiet observation, and the report to512KiB. Socket waits are bounded;
foreign/duplicate traffic cannot reset deadlines. JSON stdout/exit0 means all
checks passed; errors retain bounded evidence and exit1. Cleanup only closes
owned sockets; this stateless profile has no AdminDown or interface teardown.

Tests require peer_ip already assigned on the execution host and an exclusive
peer_ip:peer_port receiver. Actual netlink address checks reject nonlocal
addresses even under permissive ip_nonlocal_bind;127/8 aliases need an existing
loopback interface. For remote peers run there with trusted private observer
access, for example an explicitly managed task SSH loopback forward. The client
does not spoof addresses, configure routes, auto-SSH or expose observer on LAN.

## Build and independent native layer

`scripts/vxlan-fetch-deps.sh` prepares the locked Python base explicitly online;
`scripts/vxlan-images.sh` builds without network; `scripts/vxlan-assets.sh` exports
the runtime, original MIT sources/tests, lock, recipes, notice and documentation.
Image protocol-target-lab/vxlan:0.1.0 has no new pip/native runtime dependency.
CPython/OS notices remain in the pinned base. Prepared inputs are required for
offline rebuild; complete OS/kernel/compiler sources are not claimed.

Original Linux kernel VXLAN is a separate oracle in an authorized task-owned
Docker L2 network/private namespace. Only that oracle gets NET_ADMIN/NET_RAW for
its own device/capture. Verify native neighbor resolution, inner ARP and outer
UDP encapsulation/decapsulation with explicit dstport. Do not alter old/manual
interfaces, host routes/sysctls or use failed ping as a reason to add unclaimed
IP service. Generic L2 carrier/helper work is outside this phase. Loopback,
container-native and separate-node LAN evidence remain distinct layers.
