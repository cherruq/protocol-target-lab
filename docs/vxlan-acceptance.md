# VXLAN finite ARP acceptance scope

Manager0.16.0 and VXLAN image0.1.0 cover a finite unicast IPv4 VXLAN Ethernet/ARP
VTEP. This document states the validation layers; shared deployment, final
package/merge and physical-network outcomes are not presumed from a worker test.

## Required worker behavior

All13 fields, normalized lowercase nonzero unicast MAC roles, VNI0..FFFFFF,
requester0 probe semantics, same-IP endpoint separation and Reply padding0/18
must be validated. Pure save must not claim OS address membership; start/client
must inspect actual assigned addresses independently of a bind success under
ip_nonlocal_bind. Runtime/client use only host-network NET_BIND_SERVICE and do
not create interfaces, routes, sysctls or protocol dependencies.

Complete current Requests must pass outer peer, VXLAN I/VNI, Ethernet and ARP
shape/role gates before any Reply. Request THA and VXLAN base reserved bits retain
the reference ignore/record behavior. Replies are newly constructed and sent to
the configured fixed peer_port from a separate source socket. Arbitrary UDP,
wrong roles/VNI, incomplete ARP, VLAN or non-ARP frames cannot trigger output.

All11 TARGET modes must be exercised: normal, silent, wrong-vni, clear-i,
wrong-eth-dst, wrong-sha, wrong-spa, wrong-tha, wrong-tpa, short-header and
short-arp. Check exact output byte changes/truncations and inner42/60 lengths;
expected parser failure alone is not fault-output proof. ALL means four cases
with two fresh Requests each for the current applied mode. Release coverage
uses11 controlled configurations, not hidden automatic mode changes.

The final worker image completed11x8 same-image checks and24 unit tests. Four
additional boundary configurations completed32 checks: requester0/padding18/
mixed-case MAC/VNI0, same-IP distinct endpoints with maximum VNI/source port,
privileged ports, and short-arp with padding18. Separate private-namespace
ip_nonlocal_bind=1 tests proved plain nonlocal bind can succeed while both worker
and client reject the unassigned address before any ARP. Runtime capabilities
were measured as NET_BIND_SERVICE alone. Exact image/source hashes connect the
candidates; installed manager and LAN results require their own evidence.

## Observation and boundaries

Read-only observer records need a fresh Request SHA/request_id linking actual
accept/reject to actual-send/suppression. A Request nonce in legal padding is not
an invented ARP transaction field and Reply does not echo it. Compare independently
received exact bytes/source/fixed endpoint and causal wire hash. Silent and
invalid-input cases need fresh source evidence plus0.5s quiet observation;
sendto/HTTP success or silence alone cannot establish delivery/intent.

Verify absolute30s/3s run/check deadlines,1s observer requests,8 pre-thread slots,
64KiB replies,256 cached events,128-byte previews, bounded malformed padding and
counter/log growth. Main-loop heartbeat cannot be refreshed by observer threads.
Source identity requires exact owned CID/image/PIDStartedAt/socket ownership plus
runtime nonce/boot/normalized hash before/after operations. Conflicting ports and
incompatible images preserve the previous source. Peer receive-port collisions
are unavailable-test preconditions, not permission to share or evict listeners.

Cover VNI wrap, same-IP distinct ports, privileged ports with the actual minimal
capability set, mixed-case MAC canonicalization, requester0, maximum UDP tails,
all layer truncations/role errors, repeated requests/FD stability and clean socket
release. This stateless service has no BFD-like Up/session or AdminDown cleanup.

## Native kernel and delivery layers

After authorization, use original kernel VXLAN only inside a new task-owned
Docker L2 topology/private namespace. Create the oracle's own VTEP with explicit
VNI/local/remote/dstport, requesterMAC/IP and minimal NET_ADMIN/NET_RAW. Prove
native inner ARP and outer UDP, decapsulation and expected neighbor MAC. The
software target provides no ICMP/IP service; ping failure after successful ARP
must not be relabelled as absent ARP or hidden by expanding scope.

The pre-research iproute2 detailed-JSON VXLAN query SIGSEGV is preserved as an
environment counterexample, not proof that native data plane is unsupported.
Separate new-device creation/data exchange and alternate read-only inspection
from that tool failure. Do not patch native behavior or change global host tools,
interfaces/routes/sysctls to manufacture a pass. Kernel fault tolerance is reported
as observed, not assumed to reject every deliberately malformed target Reply.

An actual isolated Docker L2 test on local Linux7.0.0-42 with iproute2 6.1.0
created an original kernel VXLAN device and captured its42-byte inner ARP Request
and Reply plus50-byte outer VXLAN payloads. The native neighbor became REACHABLE
with the configured target MAC; target UDP Reply was source55029 to peer4789.
The kernel emitted its ARP Request from48090 despite a requested srcport55040;
the original extra pin assertion failure is retained and no successful pin is
claimed. Request source-port pinning is not a finite VTEP contract requirement.
The target ran the final image with only NET_BIND_SERVICE; NET_ADMIN/NET_RAW
were confined to the independent oracle namespace. Its VTEP, two containers and
new L2 network were removed by exact ownership. This local native exchange does
not establish native operation on the different remote7.0.0-31 node that showed
the earlier read-only query crash, nor physical LAN or generic IP delivery.

Formal delivery additionally requires offline Ubuntu24.04 package/binary,
installed CLI/docs, same-source manager adoption and applied restoration,
private observer identity, same-image client correlation, preservation of all11
prior workspaces/resources and separate-node tests on existing authorized
addresses/routes. An external API CLI still starts tests on the manager host;
remote peer addresses require actual execution on that peer node with private
observation. Loopback/container-native evidence cannot stand in for LAN.

The runtime/export is autonomous MIT Python plus pinned CPython/OS provenance.
Kernel/iproute2/capture tools are independent infrastructure with their own terms
if redistributed. No full OS/kernel source release, generic L2 carrier/helper,
EVPN/multicast/VLAN/GBP/GPE, physical line or performance acceptance is claimed.
