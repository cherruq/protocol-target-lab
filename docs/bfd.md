# BFD single-hop software peer

The BFD workspace is an autonomous IPv4 single-hop asynchronous Control peer.
It actively sends real Down/Init/Up Controls, negotiates timers, applies jitter,
handles receive detection and Poll/Final, and supports six explicit target-side
scenarios. It does not implement Echo, authentication, Demand, multihop, IPv6 or
routing-protocol convergence. A running worker and a peer session that is Up are
different facts; an absent peer correctly leaves the running worker Down.

The required configuration is:

```json
{
  "wire_profile":"bfd-ipv4-single-hop",
  "bind_ip":"127.0.0.1",
  "peer_ip":"127.0.0.2",
  "interface":"lo",
  "source_port":55028,
  "local_discriminator":1111901224,
  "min_tx_us":1000000,
  "min_rx_us":1000000,
  "detect_mult":3,
  "scenario":{"mode":"normal"}
}
```

All fields are required. Null, unknown fields, incorrect scalar types and ranges
are rejected. The fixed profile literal identifies BFD independently of other
protocol configuration shapes. Binding and peer addresses must be different,
explicit IPv4 unicast addresses. Interface names use1..15 ASCII letters/digits,
underscore, dot or hyphen, starting with a letter/digit/underscore. Saving checks
syntax; starting checks actual interface/address membership. Linux loopback127/8
aliases are accepted on the loopback interface without adding addresses.

Control destination port is fixed3784. Source port is49152..65535 and remains
stable for the session; local discriminator is a nonzero uint32. Local Tx/Rx
parameters are1000000..4294967295 microseconds and DetectMult1..255. Integer
booleans are rejected. The worker uses host networking and binds only its
configured receiver/sender UDP endpoints plus a private loopback observer.
Both UDP sockets forbid SO_REUSEADDR and SO_REUSEPORT; a conflicting listener
must be preserved and reported. The container runs uid0 with cap-dropALL plus
only NET_RAW for SO_BINDTODEVICE. It does not change host addresses, interfaces,
routes, firewall rules or sysctls, and does not mount devices or a Docker socket.

## Target-side scenarios

`scenario` is a complete tagged object:

| Mode | Required fields | Behavior |
| --- | --- | --- |
| normal | mode | Normal periodic Controls; responds to remote Poll |
| poll | mode, after_up_ms | One target-initiated Poll sequence per validated peer epoch |
| quiet | mode, after_up_ms, duration_ms | Suppresses all outbound Controls during its window |
| wrong-your | mode, after_up_ms, duration_ms | Sends Controls with an incorrect nonzero Your discriminator |
| ttl254 | mode, after_up_ms, duration_ms | Sends otherwise unchanged Controls with actual IP TTL254 |
| short | mode, after_up_ms, duration_ms | Sends the first7 bytes of the intended Control |

Delay is0..3600000ms, fault duration1..3600000ms. Example fault configuration:
`{"mode":"quiet","after_up_ms":1000,"duration_ms":4000}`. Changing mode replaces
the complete object rather than preserving fields from a different tagged shape.
Saving does not apply it; restart explicitly applies the saved configuration.

A scenario arms only after actual bidirectional Up and a successfully submitted
normal local Up datagram. A new validated peer My discriminator in Down/AdminDown
starts a new epoch; valid Up-period My changes update protocol RemoteDiscr without
resetting the epoch. Local timeouts, same-identity Down and recovery do not rearm
it. Fault windows use absolute monotonic time and persist through temporary Down;
all periodic and Final output uses the same fault transform. At expiry normal
output resumes. Wrong-Your excludes both the retained epoch identity and current
RemoteDiscr. Poll completion requires a real P transmission before an eligible
Final; an early Final or send intent is insufficient.

## Wire and observation

Normal outgoing Controls are24 bytes, version1, with actual TTL255 and a legal
high source port. Receive validation uses this datagram's recvmsg TTL/IP_PKTINFO,
exact peer/local destination/interface, flags, lengths and discriminators before
refreshing the receive timer. The finite profile accepts UDP trailing bytes when
the complete Control declares Length24; it records bounded trailing metadata and
does not treat them as another Control. Invalid traffic cannot maintain Up or
prevent independent timer expiry. The local role is Active; two passive peers
are not a supported configuration.

A read-only observer binds only127.0.0.1:18084 on the host-network worker. It
never creates a peer, sends test traffic or mutates configuration/state. The
manager validates exact owned container/image/PID/StartedAt/socket-inode identity
and the injected runtime nonce. `GET /v1/status` includes boot/runtime IDs, sorted
canonical configuration hash, actual bind information, main-loop heartbeat age,
local/remote states, epoch/scenario and bounded counters. Only the BFD main loop
updates the heartbeat; HTTP traffic cannot make a stalled protocol loop healthy.
`GET /v1/events?epoch_id=N&after_event_id=N&limit=16` returns bounded fresh events.
There are256 cached events, at most16 per query, at most64KiB per response and8
connection slots acquired before thread creation; request time is an absolute1s.

Socket submission and observer send intent do not establish remote delivery.
Actual independent receive data and fresh epoch/discriminator correlation prove
wire interaction. No BFD ACK is invented. Health checks local binding, observer
identity and loop freshness; session Down alone does not cause a restart loop.

## Same-image client

The disposable client validates the CURRENT applied target scenario twice:

```sh
python3 /opt/protocol-target-lab/client.py --host 127.0.0.1 --port 3784 \
  --method ALL --path session --config-json "$APPLIED_CONFIG_JSON" \
  --interface lo --observer-host 127.0.0.1 --observer-port 18084 \
  --expected-boot-id "$SOURCE_BOOT_ID" --expected-runtime-id "$SOURCE_RUNTIME_ID"
```

Methods are NORMAL, POLL, QUIET, WRONG_YOUR, TTL254, SHORT and ALL. A named method
must match the applied mode. ALL selects every verification phase for that mode,
with two fresh peer epochs; it does not reconfigure the worker or claim to run
all six target modes. Complete release coverage explicitly runs six controlled
configurations. Normal can also initiate a client Poll to verify a real target
Final; that reverse-direction check is labelled separately from target poll-mode
generation.

Before sending, the client checks budget, trusted observer identity, idle state
and exclusive peer_ip:3784 ownership. It refuses to supersede Up/Init or a recent
active peer. Each round uses a fresh random discriminator and stable high source
port. Cleanup sends a real AdminDown and requires observed Down for its own epoch;
this is explicitly not a detection-timeout claim. Cleanup errors preserve the
original failure and make the run fail.

For fault modes the client continues sending valid Controls while observing the
target's actual quiet/wrong-Your/TTL254/short behavior. Invalid target output must
not refresh the client detector. It records its own Down/diag1, then full window
expiry and same-identity bidirectional recovery. The target may go Down/diag3 on
receipt of that valid remote Down; this is a different direction from its own
receive timeout. Quiet requires fresh suppression evidence as well as observed
silence; malformed outputs require actual received wire hashes matching fresh
source-epoch transmissions. Reports contain bounded wire, observer and phase
proof; stdout is one JSON object, success exit0, failure exit1.

The total client budget is120s, each calculated phase at most15s, socket timeout
at most3s and report at most512KiB. Very large legal timers/windows, or a fault too
short to establish the complete detection proof, receive an unavailable-test
precondition diagnosis before sending. The client never reduces timers or extends
a configured fault window. API waits should allow manager cleanup; CLI callers
can use `--timeout 150`.

`FULL.interface` belongs to the target machine. A client on another node must use
its own interface name and already own FULL.peer_ip; no address spoofing or
network reconfiguration is performed. Default loopback runs prove software BFD,
not a LAN path. For a LAN peer, execute on that peer node. A separate-node full
fault test also needs trusted private observation, for example an explicitly
managed task-scoped SSH loopback forward with expected source boot/runtime IDs.
The program does not start SSH or expose the observer on the LAN.

## Build, delivery and limits

Use `scripts/bfd-fetch-deps.sh` for explicit online locked-base preparation,
`scripts/bfd-images.sh` for network-disabled image build and
`scripts/bfd-assets.sh` for runtime/source/provenance export. Image
`protocol-target-lab/bfd:0.1.0` uses only original MIT project code and Python's
standard library. The pinned CPython/Debian base retains its licenses and notices;
prepared base inputs are required for offline rebuilding. A full OS/compiler
source distribution is outside this export.

Original FRR8.4.4 is used separately as an independent native interoperability
oracle on a task-owned direct L2 container network. It is not bundled into the
standard-library runtime, and a native config dry-run is not packet proof. Its
GPL and component notices/source obligations remain separate if it is distributed.
This software profile does not establish physical link failure, routing
convergence, line/electrical measurements, guaranteed submillisecond scheduling
or whole-host reboot recovery.
