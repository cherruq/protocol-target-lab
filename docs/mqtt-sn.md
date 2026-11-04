# MQTT-SN workspace

This workspace runs the real Eclipse Paho MQTT-SN UDP gateway 1.5.1, pinned to
commit `e1e1b733e0fecef6bed92798d7f6d6440d9026f2`, together with a private
Mosquitto 2.0.18/full-v1 broker in one managed container. The public MQTT
workspace can be stopped independently. The gateway is transparent; the
included client verifies MQTT-SN QoS1 and real delivery to a separate MQTT
subscriber. This phase does not claim QoS0/QoS2 client acceptance, DTLS, serial
sensor networks, forwarding, aggregation, authentication or persistence.

```json
{"bind_ip":"0.0.0.0","port":1884,"discovery_group":"239.192.0.2","discovery_port":1885,"gateway_id":1,"broker_host":"127.0.0.1","broker_port":28897,"predefined_topics":[{"topic_id":1,"topic":"plab/predefined"}]}
```

The Paho UDP implementation binds all IPv4 interfaces. Therefore `bind_ip` is
fixed to `0.0.0.0`; the UI does not promise a specific-interface binding. The
container uses host networking to preserve native multicast discovery. Its two
UDP ports must differ and be integers 1–65535; the private TCP broker is bound
only to `127.0.0.1` at `broker_port` (1–65535), with no implicit port 1883.
`discovery_group` is an IPv4 multicast address; `gateway_id` is 1–255.
Loopback binding isolates the broker from other machines, while local host
processes can reach it. The worker does not change host interfaces or routes.

There are 1–16 predefined mappings, with unique topic IDs 1–65534 and unique
topic names. Names contain 1–128 visible ASCII bytes (0x21–0x7e), excluding
comma, `+` and `#`, and cannot begin with `$`. This is a finite laboratory
configuration subset: the private broker reserves system/control topic spaces,
and a native MQTT-SN PUBACK alone cannot prove delivery there. It is not a
claim that MQTT forbids every `$` topic. Whitespace and arbitrary UTF-8 are intentionally unsupported
by this configuration, reflecting the native CSV parser. `plab/test` and its
`plab/test/` descendants are reserved for nonce-based normal-topic checks.
Mappings use the native global `*` client mapping. Unknown/null fields, booleans
in integer fields, duplicate mappings and invalid types are rejected.

A documented original project native patch protects REGISTER table exhaustion:
a full per-client topic table returns native REGACK TopicId 0 and congestion
code 0x01 with the request MsgId, preserving existing topics and sessions. The
original source, exact patch and hash-verifying applier ship with the image.
This is not an upstream backport. The image exposes the required
`mqtt-sn-register-capacity=bounded-v1` capability.

The native fixed client-object pool is 64. It is not an advertised concurrent
connection limit: disconnected identities can retain table entries. The
included client reuses two equal-length reserved identities, `plab-sn-normal`
and `plab-sn-predef`, reconnects with CleanSession, and obtains a fresh UDP
source port and actual assigned normal topic ID each round. Avoid using those
identities for external manual clients, or running concurrent client checks
against the same gateway: native identity reuse can reconnect an existing
session. There is no wrapper-wide duration or request-count expiry.

The non-root PID1 supervises and reaps both native processes. Any unexpected
component exit stops its peer and fails the worker. SIGTERM is translated to
Paho SIGINT and broker SIGTERM, followed by a bounded wait and forced cleanup
if needed. Runtime configuration, native ring-buffer key files and IPC are
private to the container. No host directory or host IPC namespace is mounted.
Native logs are forwarded as bounded JSON records to stdout, with no expanding
native log file. Docker log rotation is configured by the manager.

## Client checks

The same image contains `/opt/protocol-target-lab/client.py`:

```sh
docker run --rm --network host --entrypoint python3 protocol-target-lab/mqtt-sn:0.1.1 \
  -u /opt/protocol-target-lab/client.py --host 127.0.0.1 --port 1884 \
  --method ALL --path plab/test --config-json "$APPLIED_JSON"
```

Run it on the gateway host because the independent broker observer intentionally
connects to loopback. It does not change configuration or start any server.
Each selected case runs twice; `ALL` performs eight checks:

- CONNECT: real MQTT-SN CleanSession CONNECT/CONNACK and DISCONNECT exchange.
- REGISTER_PUBLISH: register a new `plab/test/<nonce>` topic, validate REGACK's
  assigned topic ID and MsgId, publish QoS1, validate PUBACK, and independently
  subscribe to the actual topic through MQTT 3.1.1 to compare payload bytes.
- PREDEFINED_PUBLISH: perform the same end-to-end QoS1 delivery proof for every
  configured predefined topic ID/name, without pretending a PUBACK alone proves
  broker delivery.
- DISCOVERY: join the configured group on its discovery port before sending
  SEARCHGW to the primary UDP endpoint, then receive native multicast GWINFO.
  Validate gateway ID, primary source port, a matching host source address and
  actual multicast destination via Linux packet metadata. Paho sends GWINFO
  from its primary UDP socket. For a local/loopback target, the client joins
  using the local multicast-group route, matching the native gateway's sender.
  For a remote target, it joins on the IPv4 interface selected by the unicast
  route to that target's primary UDP port. This avoids a VPN multicast default
  route selecting the wrong receiver interface; it changes no system routes.
  SEARCHGW is retried at most once per 0.5 seconds, at most six queries within
  the same absolute three-second discovery deadline; retries never extend it.
  Reports include `membership_interface_ipv4`, `queries_sent` and each actual
  query in the trace. Business PUBLISH is not retried. Exact remote source IP, primary
  source port, configured ID and actual destination group checks remain active.
  No artificial unicast response or DEBUG_NW flag
  is used. GWINFO has no transaction ID; association is by the bounded receive
  window and endpoint/group/ID tuple, not a nonexistent nonce.

The process emits one JSON report and exits 0 on complete success or 1 on any
failure. `checks[].response.trace` contains bounded, directional MQTT-SN and
MQTT wire events; `response.deliveries` includes PUBACK fields and independently
received topic/payload metadata. Discovery reports the observed source and
multicast destination. Packet previews are at most 128 bytes, payloads include
original length and SHA-256, and reports are capped at 512 KiB. Socket waits are
at most three seconds and the entire run is limited to 30 seconds. An absent
service or observer failure produces a structured failing report.

## Supply chain and offline use

Run `scripts/mqtt-sn-fetch-deps.sh` explicitly online to obtain the hash-locked
Paho archive, fixed public Python base and compiler cache. Runtime construction
with `scripts/mqtt-sn-images.sh` uses `--network=none`, the pinned archive and
the content-locked Mosquitto input image. For development rebuilds only, explicitly
load `sources/build-input/broker-input-image.tar` from the MQTT-SN assets if the
broker input is absent; an arbitrary mutable tag is rejected.
Compiler cache preparation uses online Debian packages and records installed
versions; offline construction requires those caches already present.

`scripts/mqtt-sn-assets.sh` exports the runtime image, complete Paho archive and
notices, complete broker source/patch/license materials, an immutable broker
input archive for development rebuilds, wrapper and client sources, build recipes and a SHA-256 manifest. Runtime and source redistribution
must retain those materials together. The final independent Python image does
not inherit public MQTT response/client capability labels from its broker input.

Only the MQTT-SN runtime image belongs to the deployment import list. Its broker
binary is already inside that image; deployment does not load or retag the
public MQTT image. The separately hashed `sources/build-input` archive has no
public repository tag. For an offline source rebuild, explicitly load that
archive, prepare/import the compiler and Python base caches, then run the build
script. Docker engines may identify the same archive by a config ID or an OCI manifest
ID. The resolver first tries known IDs and local candidates, then untagged
local images. It accepts only the SHA-256 of the complete canonical RootFS and
runtime Config, together with the required capability labels; a fresh rebuild
with different layers or any configuration drift is rejected. Both known IDs
and the content fingerprint are recorded in the lock. The script uses the
actual local engine ID to create a task-owned temporary FROM tag and removes it on exit; the public MQTT tag is not changed.
