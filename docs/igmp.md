# Linux kernel IGMP membership target

This workspace holds real Linux IPv4 multicast memberships. The running kernel
emits Reports; the source never constructs or sends a raw Report. The disposable
same-image peer sends IGMPv2 Queries and observes actual Reports on a different
interface. A successful HTTP observer request or raw send is not Report delivery,
and IGMP has no acknowledgement or transaction ID.

## Configuration and links

All four fields are required. Unknown fields, nulls and wrong types are rejected.
Groups are 1–16 distinct addresses in 239/8, in configured order. The query profile
is fixed to IGMPv2 and Max Response Code 100 (10 seconds).

```json
{
  "wire_profile": "linux-kernel-igmp-v2",
  "link": {"mode": "docker-bridge"},
  "groups": ["239.192.19.1"],
  "query_profile": {"version": 2, "max_response_code": 100}
}
```

The default link is a dedicated manager-owned internal Docker bridge. Only the
owned source and temporary test peer belong on it. The daemon's endpoint driver
option sets force_igmp_version=2 on that new source interface. It is read back
from the actual namespace. No host-wide setting is changed. Explicit stop removes
only an empty network with verified project ownership; foreign endpoints prevent
removal. Source and peer use real separate veth endpoints and only NET_RAW after
dropping all other capabilities.

An existing-interface configuration is:

```json
{"mode":"host-interface","interface":"eth0","interface_ip":"192.0.2.20","peer_interface":null}
```

The existing source interface must be UP Ethernet with exactly one IPv4 address;
interface_ip must equal that primary address. No addresses, routes, MACs,
IGMP settings or existing memberships are changed. A non-null peer_interface
selects a different existing local Ethernet interface for the builtin peer.
Null requires an explicitly run external peer; an incoming peer cannot be
simulated by PACKET_OUTGOING from the source's own interface. Interface names
belong to each host and are not portable to the remote peer.

The third link creates a narrowly scoped project-owned native VXLAN device:

```json
{
  "mode":"owned-vxlan",
  "outer_interface":"eth0",
  "local_outer_ip":"192.0.2.20",
  "peer_outer_ip":"192.0.2.10",
  "vni":1919,
  "udp_port":47895,
  "mtu":1400,
  "local_inner_cidr":"198.18.19.20/24",
  "local_inner_mac":"02:00:00:00:19:20",
  "peer_inner_ip":"198.18.19.10",
  "peer_inner_mac":"02:00:00:00:19:10"
}
```

VNI is 1–16777215, UDP port 1024–65535 and MTU 576–9000, at most the actual
underlay MTU minus 50. Inner prefix length is 16–30. Inner peer and source must
be distinct usable addresses in that prefix with distinct nonzero unicast MACs.
The existing underlay address and route must match. The source still runs with
NET_RAW only; a separate root host helper performs setup. No generic L2 carrier,
automatic SSH or modification of an existing VXLAN interface is provided.

## Typed link ownership

`plabctl igmp link start/status/stop` invokes the installed typed Python helper.
The peer owner runs its peer specification explicitly on its own host. The
helper needs root, Python3 and iproute2; the image contains no replacement kernel.
It accepts only the project link schema, not arbitrary shell commands or ip args.

The helper writes a root-only durable intent receipt before creation and uses a
fixed per-network-namespace global lock followed by the state-directory lock.
The atomic NEWLINK marker is a nonzero 31-bit group derived from the full random
owner UUID. Name, group, complete core attributes, boot ID, network namespace
and trusted receipt must all match; a name or group alone never proves ownership.
The full owner alias is installed only on this verified newly created DOWN device.
Linux on the tested nodes ignores IFLA_IFALIAS during creation, so this delivery
does not claim an atomic full-alias operation. Ready devices require both group
and full alias, and a recorded ifindex must remain unchanged.

A marked partial creation with empty or exact owned alias can resume or be
cleaned after verification. Foreign aliases, group collisions, wrong namespace,
extra IPv4/IPv6 addresses, unexpected routes, upper devices, unrelated native
VTEPs sharing the UDP port, and live multicast references prevent deletion.
Only automatic all-hosts membership with one reference is exempt. When the source
has closed, some host daemons can still hold mDNS membership on a newly UP device.
Any 239/8 data-group, unknown group or extra all-hosts reference refuses cleanup
before any DOWN operation. If remaining references are exclusively 224.0.0.251,
the helper can journal its original UP state, bring only the verified owned
device DOWN, and wait at most one second for voluntary drops. This is not a
deletion whitelist: actual references must reach zero before a second identity
and reference check permits deletion. A still-held mDNS socket prevents deletion.
Failure preserves the receipt and attempts to restore the original UP state,
reporting actual restoration success or failure. Pending journal state is not
ready; readonly status/preflight never changes it. Explicit start can recover
that state only after checking that no data/foreign membership would be reset.
Receipts remain when cleanup cannot be proved safe. Lock files retain their inodes intentionally.
A readonly preflight failure preserves the previous source; failure after link
replacement begins can require rollback and may change source CID/PID.

Package cleanup examines all trusted target and explicit-peer receipts in the
installation's own data/igmp-links directory, even when a peer uses a different
deployment UUID or the manager document has never been created. It invokes the
same ownership, route, namespace and live-reference guards for each receipt;
unsafe devices and their receipts remain, and partial failure is reported.
The package cleanup deadline is 30 seconds overall, at most five seconds per
receipt. It does not scan other explicit --state-dir locations: users manage
those separately. Uninstall/purge must preserve unsafe outstanding receipts
and coordination lock inodes rather than recursively erase that state directory.

## Actual testing and observation

The source holds a native UDP membership socket and an independent AF_PACKET
capture socket. The private read-only observer is TCP18088, not an IGMP business
port. Default bridge mode does not publish it. Runtime proof ties actual packet,
UDP and observer socket inodes, namespace, interface, source PID/CID and boot to
the managed source. Owned-VXLAN runtime additionally exposes a verified receipt
and actual group/alias/ifindex; saved configuration alone is not ownership proof.

GENERAL_QUERY sends two General Queries and requires coverage of all configured
groups in each round. GROUP_QUERY sends two queries for the first configured
group. ALL runs both: four checks and four actual Queries, requiring 2N+2 matched
Reports for N groups. Group membership can share an Ethernet multicast MAC;
matching uses the actual IPv4/IGMP group. Checks require a fresh captured source
Query plus a later native outgoing Report and the peer's actual incoming Report,
with matching canonical IPv4 SHA256. Ethernet padding is excluded from this hash.
Other queriers and IGMP report suppression mean timing is not unique causation.
Only actual IGMPv2 Reports satisfy the v2 test. Valid native v1/v2/v3 Reports seen
before queries are counted as historical observations; v3 observation uses L2
membership for 224.0.0.22, without an IP membership join by the peer.

Startup warmup is a conservative bound, not a measured effective kernel QRV.
The source records sysctl QRV, interface and all-interface force versions, and
v2/v3 unsolicited intervals before joining. Forced-v2 uses max(sysctl QRV,1);
auto/complex mode uses max(sysctl QRV,7), since learned mr_qrv is not exposed.
The bound is (QRV upper−1) × (max(intervals)+1000ms) + 2000ms, reduced by actual
join age. Each period includes a conservative timer-rounding allowance. Parameter
changes are sticky and make causal testing unavailable. Preexisting or later
additional membership references also make testing unavailable while the native
member remains healthy. Health never creates a fake querying peer.

Before peer creation the remaining warmup plus selected rounds ×12 seconds plus
10 seconds of control/cleanup must fit 90 seconds. Each round and total deadline
are absolute; traffic cannot renew them. Larger valid kernel timers can therefore
make the test unavailable rather than cause a hidden configuration change.
Reports separate check counts, actual_queries, actual_reports and
prequery_reports. Bounded real progress is emitted on stderr; stdout is one final
JSON report, with exit0 for pass and exit1 for failure.

The explicit same-image peer entry point is:

```sh
docker run --rm --network host --user 0:0 --cap-drop ALL --cap-add NET_RAW \
  --entrypoint python3 protocol-target-lab/igmp:0.1.0 \
  -u /opt/protocol-target-lab/client.py --config-json "$CONFIG_JSON" \
  --interface eth1 --source-ip auto --target-ip 192.0.2.20 \
  --target-mac 02:00:00:00:19:20 --observer-host 127.0.0.1 \
  --observer-port 18088 --expected-boot-id "$BOOT_ID" \
  --expected-runtime-id "$RUNTIME_ID" --method ALL --path membership
```

The observer address must actually reach the source observer. An explicit private
TCP forward can carry read-only observer HTTP; it never substitutes for actual
IGMP Query/Report data. The peer uses its own real interface/IP. Source argv is
`--config-json JSON`, with resolved `--interface` and `--interface-ip` for a newly
owned VXLAN; PLAB_RUNTIME_ID supplies the manager's source nonce.

## Rebuilding and evidence boundaries

`make fetch-igmp-deps`, `OFFLINE=1 make igmp-images`, and `make igmp-assets`
prepare the pinned public Python base, rebuild the autonomous standard-library
worker and export runtime plus source/recipe/helper/license materials. Offline
rebuilding requires the prepared locked base cache. CPython and base OS copyright
files remain in the image; this is not a full kernel/OS source distribution.

Software bridge testing, two-namespace native VXLAN, host-interface physical LAN
and manager lifecycle evidence are separate layers. A successful software topology
does not establish a physical underlay path. Host policy-route replication or
foreign multicast users can correctly block exact-owned cleanup; the helper does
not weaken its guards or remove unrelated dependencies to manufacture success.
Current phase acceptance and any environment restrictions are recorded separately.
