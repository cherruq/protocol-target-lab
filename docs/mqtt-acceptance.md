# MQTT workspace acceptance

Manager 0.7.0 adds a fixed MQTT workspace with Web/CLI configuration, lifecycle,
logs, actual runtime state, restart adoption and same-image disposable tests.
MQTT image 0.1.1 contains native Mosquitto 2.0.18 with two documented upstream
packet-size backports. It exposes anonymous MQTT 3.1.1 and 5.0 over TCP, with
QoS 0/1/2. TLS, authentication, websockets and durable sessions are not included.

## Review finding and correction

Independent raw-wire tests found the initial image 0.1.0 counted incoming packet
size without all Remaining Length bytes, and outgoing recipient limits without
the command byte. A configured or advertised maximum of128 could permit129
complete bytes. Normal delivery tests did not prove this boundary. That image
was not deployed to the shared host and its tag is preserved as historical evidence.

The correction backports the two corresponding upstream expressions, with
source/patch/result hashes, exact application and original source/license texts:
[packet-size patch provenance](../third-party/mosquitto/patches/README.md).
The manager requires `mqtt-packet-size=full-v1` on the prepared image and on
MQTT containers recognized as matching the applied configuration. HTTP/DNS
fingerprints and adoption rules remain unchanged.

Independent tests verify exact accepted/rejected complete sizes for MQTT3.1.1/5,
Remaining Length encoding transitions, the1MiB cap, and MQTT5 recipient limits.
Recipients receive packets exactly at their advertised limit and do not receive
larger ones. Original failures and corrected results are recorded separately.

## Functional and lifecycle coverage

- Six version/QoS cases and ALL use independent subscriber and publisher client
  IDs and unique topics. The subscriber receives the exact payload and both
  sides complete the QoS acknowledgements; each case runs twice.
- Connection and packet limits are validated, passed to the real broker and
  exercised. A two-connection/128-byte broker passes repeated ALL tests. A
  one-connection broker is valid, while the independent two-client test is
  rejected clearly before execution.
- Startup checks perform a real CONNECT/CONNACK, PING/PINGRESP and DISCONNECT.
  They wait for the connection to close so readiness does not consume a slot.
- Saved limits do not change the applied broker until an explicit operation.
  Manager termination adopts the original worker rather than applying a draft.
- Port conflicts, missing/incompatible/unpatched images, invalid full/partial
  configurations and concurrent operations preserve recognized old services.
  Disabled workspaces stay disabled; cleanup is scoped to owned resources.
- Existing HTTP and DNS serialized settings, custom IDs, applied hashes and
  containers survive adding the disabled MQTT workspace, including ID collision.
- Web normal-path validation covers all cases, packet traces, errors, snapshots,
  three-protocol drafts/logs and session changes. The old-image browser run is
  normal-function evidence only; the corrected packet boundary uses fresh
  independent wire tests. Unchanged frontend source/assets are tracked by hash.

## Delivery boundary

The binary/deb are compiled offline on Ubuntu24.04 amd64, embedding Web assets.
The image and asset export include the complete original Mosquitto archive,
backports, build instructions and upstream/bundled license notices. This runtime
asset export is not a complete multi-protocol offline compiler/system bundle.
Built-in tests run on the target host; cross-node checks establish reachability
from the separate client machine. Existing manual protocol services are retained.
No whole-host reboot or Docker daemon settings change is claimed by this phase.
