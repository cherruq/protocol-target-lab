# MQTT-SN workspace acceptance

Manager0.10.0 adds a fixed Web/CLI MQTT-SN workspace. Image0.1.1 supervises a
real Paho1.5.1 UDP gateway and a private Mosquitto2.0.18 broker in one container.
The broker is independent of the public MQTT workspace and listens only on
the configured127.0.0.1 TCP endpoint. The native gateway uses host networking
and wildcard IPv4 listening; its discovery response is real multicast.

## Actual delivery and native boundaries

CONNECT, REGISTER_PUBLISH, PREDEFINED_PUBLISH and DISCOVERY run twice. Publication
checks require exact nonce payload/topic receipt by an independent MQTT3.1.1
subscriber after SUBACK readiness. Matching PUBACK fields alone cannot pass.
Predefined tests cover every mapping without substituting REGISTER for predefined
topic-ID semantics. Both publication cases validate QoS1; other native QoS modes,
DTLS/TLS, forwarders, aggregation and sleeping clients are not accepted by this
phase. Native protocol replies are not manufactured by the Python supervisor.

Two equal-length reserved client IDs are reused with clean sessions and fresh
UDP source ports; normal topic IDs are obtained again through REGISTER. Native
client-table entries can persist after disconnect, so the implementation does
not promise a configurable maximum concurrent-client count or evict user IDs
to make tests pass. Health uses SEARCHGW plus a real broker CONNECT/PING and
does not allocate MQTT-SN client IDs. Test IDs and their short prefixes are
reserved because of the upstream client-list matching behaviour.

The predefined CSV reader rewrites some whitespace/UTF-8 bytes. This workspace
therefore exposes a limited visible-ASCII topic subset, with unique IDs/names,
1..16 entries and1..128-byte names. Leading dollar signs are excluded to avoid
private-broker reserved namespaces. A real counterexample receives successful
SN PUBACK for a system topic while the broker denies the publication and the
subscriber receives nothing. This restriction does not redefine MQTT topic
validity; it makes the offered configuration's delivery contract explicit.

## Registration-capacity correction

Independent raw-wire tests reproduce a native SIGSEGV on the51st distinct
REGISTER in one clean session. The original per-client table returns nullptr
at capacity and the old handler dereferences it. The supervisor correctly
detects the crash and stops the broker, but repeated container restarts are
not a substitute for correct bounded request handling.

The [minimal project patch](../third-party/paho-mqtt-sn/patches/README.md) checks
that result and sends a native REGACK with TopicId0, the original MsgId and
congestion code1. It preserves the existing table/session and native protocol
engine. Source/patch/result hashes and exact application guards are shipped;
this is an original correction, not an upstream backport. Image startup/adoption
require bounded-v1 capability. The failing0.1.0 candidate is retained separately
and is not deployed as the workspace runtime.

Coverage checks50 accepted registrations,51/52 congestion responses, continued
delivery on a previously registered topic, another unaffected session, and
successful clean reconnect/reregistration. Configured16-topic/128-byte/ID65534
boundaries and repeated same-ID ALL runs exercise normal long-lived operation.

## Discovery, ownership and recovery

GWINFO arrives on the configured group/discovery port, sourced from the primary
gateway UDP port. Validation checks exact length/type/GWID and source ownership,
not ADVERTISE or unrelated gateway traffic. Local routing can select a LAN IP
for a request sent to loopback; host-side probes calculate that route without
sending a packet. Remote discovery must establish the target source/IP and
actual LAN multicast path. Docker host networking alone is not that evidence.
Remote clients join on the interface selected by the unicast route to their
target; local clients follow the native gateway multicast route. SEARCHGW may
be retried at half-second intervals, at most six times within one absolute
three-second discovery budget. Source/GWID/destination checks remain strict,
and a blackhole still fails; no global host route is modified.
The upstream DEBUG_NW switch applies to a different socket; it is not enabled
as a supposed discovery fix.

Preflight considers primary exclusive UDP, shared discovery UDP and private TCP,
including Docker NAT publications and foreign socket listeners. On restart,
the manager inspects socket inodes inside the worker's private PID namespace,
including its two native children, and checks container identity before/after.
It excludes only exact owned sockets. A foreign shared discovery listener still
blocks changing that endpoint into an exclusive primary listener. Existing
protocol fingerprints, saved/applied settings and container adoption stay intact.

Either native child exiting stops/reaps the other and exits the supervisor with
failure. SIGTERM is translated to the gateway's normal SIGINT and broker SIGTERM,
with bounded teardown. IPC, working files and process namespaces are private;
no host IPC cleanup, management-interface change or extra1883 listener is used.
Docker provides bounded logs. Saved drafts apply only on explicit operations;
manager restart adopts the existing composite container.

## Build and deployment boundary

Runtime/source exports carry the pinned public Paho archive, explicit native
patch, Mosquitto source/backports, complete notices and build recipes. Broker
input is a separately checked source-build cache, not another runtime import or
a replacement of the public MQTT tag. Identical image content may have different
display IDs on different Docker engines; full RootFS/runtime Config and required
capabilities establish equivalence. Changed layers/configuration fail validation.
Offline builds use prepared compiler/base/input caches and no network; this is
not a complete clean-machine system/compiler distribution.

The native Ubuntu24.04 amd64 package embeds Web assets. Installed CLI/API checks,
separate-node SN publishers with independent observation of the target loopback
broker, and manager
restart recovery are distinct evidence layers. They do not establish whole-host
reboot, physical sensor-network behaviour or untested native protocol options.
