# MQTT workspace

This workspace uses the real Eclipse Mosquitto 2.0.18 broker with the documented
`full-packet-size-v1` upstream backport. It provides anonymous MQTT 3.1.1 and MQTT 5 over plain TCP for a controlled lab.
TLS, websockets, password/SCRAM authentication, bridges, and durable state are
outside this implementation. A single protocol workspace controls one broker.

```json
{"bind_ip":"0.0.0.0","port":18883,"max_connections":32,"max_packet_size":1048576}
```

The host binding accepts an IPv4 unicast or wildcard address and port 1–65535.
The broker listens only on internal IPv4 TCP port 18883; Docker bridge
publishing maps the configured host binding to that port. It does not open
1883. `max_connections` accepts integer 1–128 and `max_packet_size` integer
128–1048576, measured as the entire MQTT packet, including its fixed header.
Unknown keys, nulls, fractional values, and booleans in integer fields are
rejected. These limits are enforced by Mosquitto, not a Python network proxy.
MQTT 5 CONNACK advertises its configured maximum packet size. The backport
counts command + actual Remaining Length encoding + body on incoming packets
and includes the command byte in outgoing client-advertised limits. Image
capability label `io.protocol-target-lab.mqtt-packet-size=full-v1` identifies this
behavior; old image 0.1.0 is retained for regression and does not provide it.

The service wrapper validates the JSON and passes an isolated generated
configuration to Mosquitto through an anonymous Linux memory file descriptor.
It reads no system broker configuration, writes no config or query-log file,
and execs the foreground broker as UID/GID 65532. The broker has no expiry
timer; persistence is disabled, so retained/session data does not survive a
restart. Docker captures connection/protocol logs with the manager's normal
log limits. The generated configuration puts the explicit listener before
listener-specific options, avoiding an implicit default listener on 1883.

## Build and offline assets

```sh
scripts/mqtt-fetch-deps.sh  # online source/base/compiler-cache preparation
scripts/mqtt-images.sh      # network-disabled runtime build using local cache
scripts/mqtt-assets.sh      # dist/mqtt-assets: runtime image, sources, manifest
```

The image is `protocol-target-lab/mqtt:0.1.1`. The fixed Python bookworm base,
Mosquitto source URL/hash, and flags are in
`images/mqtt/dependencies.lock.json`. The broker is built from the unchanged
upstream archive with the explicit two-expression packet-size backport in
`third-party/mosquitto/patches/`, with TLS, cJSON, websockets, systemd, bridges, persistence, and control-topic
support disabled. The runtime has no additional installed broker library
packages. The compiler stays in `protocol-target-lab/mqtt-build:2.0.18`.
Online apt package versions may change; preparation records the image identity
and compiler package versions under `dist/`. To rebuild on a fresh offline
machine, transfer the fixed Python base and prepared compiler images using
`docker save`/`docker load`, plus the public source tree. The runtime asset
export is intended for offline installation and is not a compiler-cache export.

The runtime image embeds the complete unmodified Mosquitto source archive,
backport diff, upstream provenance, exact application script and hashes,
EPL/EDL texts, bundled uthash/utlist notices, and exact build recipes under
`/usr/share/doc/protocol-target-lab-mqtt/`. The asset exporter includes these
materials alongside the image and a SHA-256 manifest. See
`third-party/mosquitto/README.md` for notices and redistribution terms. The
original project Python wrapper/client use MIT; upstream and base-image
components retain their own licenses.

## Read-only delivery client

The same image contains `/opt/protocol-target-lab/client.py`. Its default
entrypoint remains the server; override it for a one-shot test:

```sh
docker run --rm --network=host --entrypoint python3 protocol-target-lab/mqtt:0.1.1 \
  -u /opt/protocol-target-lab/client.py --host 127.0.0.1 --port 18883 \
  --method ALL --path plab/test \
  --config-json '{"bind_ip":"0.0.0.0","port":18883,"max_connections":32,"max_packet_size":1048576}'
```

`--method` accepts `MQTT311_QOS0`, `MQTT311_QOS1`, `MQTT311_QOS2`,
`MQTT5_QOS0`, `MQTT5_QOS1`, `MQTT5_QOS2`, or `ALL`. Each selected scenario runs
twice. `--path` is the fixed test prefix `plab/test`; the client appends a new
random suffix and uses separate random publisher/subscriber IDs for each run.
It never changes broker settings or starts a server.

Each check connects an independent subscriber, verifies its granted SUBACK,
then connects a publisher and sends a random payload. It verifies the actual
subscriber topic, payload, and QoS. QoS 1 completes PUBACK handling on both
sides; QoS 2 completes PUBLISH/PUBREC/PUBREL/PUBCOMP on both sides. A publisher
acknowledgement alone cannot pass the check. MQTT 5 property lengths and
acknowledgement reason codes are parsed and checked. All generated packets fit
within the minimum configured 128-byte maximum. The service can validly allow
one connection, but the independent delivery test requires two: with
`max_connections=1` it fails clearly before making any network request.

stdout is a single JSON report with `passed`, per-scenario `checks`, `summary`,
and elapsed `seconds`; pass exits 0 and failure exits 1. Each check includes
protocol/QoS/topic, bounded payload and packet previews, original lengths and
SHA-256, and a trace of real packet types in both directions. Each socket has
a three-second timeout, the whole run a 30-second deadline, incoming packets
are bounded by the applied limit and a 1 MiB hard ceiling, and the report is
capped at 512 KiB. Invalid options/configuration, connection failures, malformed
packets, incorrect delivery, and failed handshakes produce JSON failures.

Focused standard-library parser/limit tests can be run with:

```sh
python3 -m unittest discover -s workers/mqtt -p 'test_*.py'
```
