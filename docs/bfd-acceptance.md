# BFD acceptance scope

Manager0.15.0 and BFD image0.1.0 introduce an autonomous IPv4 single-hop active
Control peer. This document separates worker evidence, independent native
interoperability and formal manager/package/LAN delivery. It does not declare
shared deployment, whole-host reboot or final merge complete.

## Worker protocol and scenarios

Required configuration includes the literal bfd-ipv4-single-hop profile, explicit
local/peer IPv4, existing interface, high source port, nonzero discriminator,
Tx/Rx parameters, DetectMult and a complete tagged scenario. Destination port is
fixed3784; actual receive TTL255, source port/IP and IP_PKTINFO interface/local
destination are verified before state/timer mutation. Complete24-byte Controls
may have UDP trailing bytes, whose actual length/hash and bounded preview are
recorded without treating them as another Control.

All six TARGET-side modes must be exercised: normal, poll, quiet, wrong-your,
ttl254 and short. Scenarios arm only after actual bidirectional Up and a
successfully submitted normal Up. A validated new Down/AdminDown peer identity
creates a new epoch; same-epoch timeout/Down/recovery do not rearm. Wrong-Your
excludes both retained epoch identity and current RemoteDiscr, including a legal
Up-period My change. Poll cannot complete from an early Final before an actual
P transmission. Fault transforms apply to periodic and Final traffic alike.

ALL validates the CURRENT applied mode twice with fresh epochs. Full six-mode
coverage uses six explicit configurations, not hidden worker reconfiguration.
For fault modes the client continues valid traffic while the target emits the
specified fault; client detection/Down and subsequent same-identity recovery
prove the correct direction. Quiet needs actual fresh suppression evidence;
malformed output needs received wire bytes matching fresh source-epoch events.
AdminDown cleanup is distinct from timeout and checks source/own epoch before
sending, so a replacement cannot receive stale cleanup traffic.

Frozen worker verification includes22 Python tests and all six modes with two
successful same-image rounds each. Targeted actual-wire tests cover retained
My10 versus UpMy11 Wrong-Your exclusion, early Final before real Poll, and a
65507-byte UDP payload with bounded65483-byte trailing metadata. Source hashes
link the final client-only cleanup improvement to unchanged receiver/state/wire
components used in host-network resource checks.

## Resource, health and identity layers

Default loopback127.0.0.1/127.0.0.2 is real software BFD without host address
changes. The runtime is host-network uid0 with cap-dropALL plus NET_RAW only,
which was checked through effective process capabilities. UDP receiver/sender
forbid reuse; observer127.0.0.1:18084 permits only TCP TIME_WAIT reuse and is not
exposed on the LAN. Existing endpoint conflicts must preserve the old worker.

The read-only observer has8 pre-thread connection slots, an absolute1s request
budget, bounded request/reply size and256 cached events with16-event queries.
Worker checks exercised slow headers, denied excess connections, bounded
invalid-packet events, unchanged valid-RX accounting, large UDP tails and clean
stop/listener release. A controlled main-loop stall left HTTP responding with
an increasing stale heartbeat, proving HTTP traffic cannot refresh protocol
loop health. This test fixture is not an installed product control hook.

Health must verify actual binds and exact owned CID/image/PID/StartedAt/socket
inode ownership plus runtime nonce/boot/config identity. A running worker with
no peer remains Down; health must not create an internal fake peer or repeatedly
restart it because of that legitimate state. Manager runtime/API/CLI must expose
current state separately from running. Revalidate source identity after tests.

Built-in tests require the configured peer address/interface on their execution
host and exclusive peer_ip:3784. They refuse active/recent peers. If the peer is
remote, run there using its interface name and trusted task-scoped private
observation; never spoof an address, change routes or expose observer control
publicly to manufacture local success. Budget/observability preconditions for
large timers or short fault windows fail before test traffic. The full client
budget is120s, phase cap15s and report512KiB; BFD test CLI waiting defaults150s.

## Independent native and formal delivery layers

Original FRR8.4.4 is a separate independent oracle in an isolated direct-L2
Docker topology. Its original executable, source/package provenance and native
behavior must be checked separately. Require real Up, Poll/Final and controlled
loss/Down/recovery with actual source-port/TTL observations; a config -C dry-run
is not native interaction. Its broader sockets/capabilities stay inside that
task topology. FRR is not bundled in the standard-library runtime or deb, and
its GPL/source obligations apply to any separate oracle redistribution.

Formal acceptance additionally requires the supported Ubuntu24.04 amd64 offline
binary/deb, installed docs/CLI, explicit iproute2 dependency for read-only host
interface checks, actual source adoption/restart behavior, private observer
identity protection, endpoint conflict protection and preservation of all ten
previous protocol configurations/hashes/resources. Separate-node wire evidence
must identify its actual peer/interface and observer layer; it cannot be inferred
from loopback or native-isolated tests. Deployment and merge outcomes are recorded
by the release verification after those steps, rather than assumed here.

Runtime/source assets retain original MIT Python sources, tests and pinned base
provenance, including CPython/OS notices. This phase does not claim a complete
OS/compiler source bundle, Echo/Auth/Demand/multihop/IPv6, routing convergence,
physical link/electrical measurements or guaranteed submillisecond scheduling.

## Observed deployment boundary

Single-hop acceptance requires actual incoming TTL255. The physical LAN
cross-node normal attempt observed TTL254, correctly rejected those Controls,
and failed to establish Up: zero passed and one failed scenario check. The
remaining LAN scenarios were not executed. This establishes a limitation of
that tested path, without identifying its particular forwarding mechanism.
TTL validation was not relaxed and host routing/firewall configuration was not
changed. Final-image independent FRR normal/quiet interoperation uses a separate
task-owned direct L2 topology; six-mode product tests use software loopback.
Manager/package adoption with an ongoing loopback peer is a separate lifecycle
check and must not be described as physical LAN acceptance.
