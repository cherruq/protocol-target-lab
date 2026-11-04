# Protocol Target Lab

A Linux protocol test target manager. The native Rust service serves an embedded
React Web application, JSON API, and live logs. Protocol workers run in Docker
containers with independently managed lifecycles.

The current implementation is **HTTP, DNS, MQTT, Telnet, IEC104, MQTT-SN, RTP and RTCP**, with manager version **0.12.0**,
HTTP server/client image **0.3.0**, DNS server/client image **0.1.1**, MQTT server/client image **0.1.1**, Telnet server/client image **0.1.0**, IEC104 server/client image **0.1.1**, MQTT-SN server/client image **0.1.1**, RTP receiver/client image **0.1.0**, and RTCP receiver/client image **0.1.0**. Each protocol has one fixed workspace and
one main configuration. The sidebar shows the protocol and its actual state;
selecting it opens configuration, start/stop/restart, responses, logs, and tests
directly. There is no instance list or create/copy/delete configuration workflow.
The other planned protocol families and the complete offline release are later
milestones.

Third-party license and copyright texts are shipped in `THIRD_PARTY_LICENSES.txt`,
with a component index in `third-party/licenses.json`. The deb installs them in
`/usr/share/doc/protocol-target-lab`; packaging also puts notice files beside
standalone binaries in `dist/`. Include these notices whenever distributing a
standalone manager. After changing Cargo/npm dependencies, prepare their caches,
run `make licenses`, and review the regenerated inventory. `make test` checks
reproducibility; packaging rejects stale lockfile/license hashes without network.

## CLI for agents

The same deb installs `plabctl`, an API client for agent automation. It uses the
same workspace, saved/applied configuration, lifecycle and tests as the Web UI.
API commands print JSON and return nonzero on rejected, failed, interrupted or
timed-out work. Starts/stops/restarts and client test runs wait for completion by
default, matching the exact operation/test ID and manager session.

```sh
plabctl --url http://192.0.2.20:18000 protocols
plabctl --url http://192.0.2.20:18000 config get http
plabctl --url http://192.0.2.20:18000 config set http --port 18091 --response-length 1024 --response-mode random
plabctl --url http://192.0.2.20:18000 start http
plabctl --url http://192.0.2.20:18000 tests run http --method ALL --path /ok
plabctl --url http://192.0.2.20:18000 logs http
plabctl --url http://192.0.2.20:18000 stop http
```

Substitute the actual manager address; the example uses a documentation address.
Field options atomically patch the latest saved configuration, preserving other
concurrent edits; complete JSON input intentionally replaces it. Saving
configuration does not apply it. `start http` or `restart http` applies
it explicitly. API commands also work without local root access or configuration
files. The existing bare `start`, `status`, `doctor`, `stop-all` and local asset
import commands retain their administrative behavior. See [CLI reference](docs/cli.md)
for stdin configuration, asynchronous calls, exit codes and automation examples.

## Runtime and build baseline

The supported package baseline is **Ubuntu 24.04 LTS, amd64, systemd, Ubuntu docker.io**.
The manager runs directly on the host and invokes the installed Docker CLI using
argument arrays. Its Web files are embedded at compilation time; production does
not need Node, npm, Python, Cargo, or Nginx on the host. The protocol workers run inside their own containers.

For development, install the Rust toolchain specified in `rust-toolchain.toml`,
Node 22.12+ with npm (Node 24 was tested), Docker Engine with its CLI, GNU make, Python 3 (license inventory verification), and Debian packaging tools
(`dpkg-dev`, `binutils`, `file`). Use Ubuntu 24.04 to compile release packages.
Binaries built on a newer Ubuntu may require a newer glibc; the packaging script
rejects dependencies newer than Ubuntu 24.04's glibc 2.39.

## Prepare and build

```sh
make fetch-deps
make build-ubuntu24
make images
make fetch-dns-deps
make dns-images
make deb PLAB_BINARY=.local/build/ubuntu24/target/release/protocol-target-lab
```

`fetch-deps` explicitly downloads the locked Cargo/npm packages and the
public Python base image identified by `images/http/base-image.lock`. It stores
the project's npm cache in `.local/cache/npm`. `images` uses a small allowlisted
build context containing the worker and Dockerfile, has networking disabled,
and requires the locked base image to already exist locally. No worker start
implicitly pulls an image.

Build order is Web (`npm ci`, `npm run build`), then Rust. `make build` compiles
natively for local development. `make build-ubuntu24` compiles in a public
Ubuntu 24.04 builder container, with the host's selected Rust toolchain mounted
read-only and its prepared Cargo cache mounted at `/cargo`. The compile container
has no network and uses `cargo build --release --frozen`; prepare dependencies
first. It writes the native binary under `.local/build/ubuntu24/target/release/`.

The build-only image `protocol-target-lab/build-ubuntu24:phase1` is described by
`packaging/build-ubuntu24.Dockerfile`, based on a fixed public Ubuntu digest. If
missing, the online build command creates it from a Dockerfile-only context and
installs compiler/linker/package tools. `OFFLINE=1` requires this image to already
exist locally and fails if it is missing. `PLAB_BUILD_IMAGE` can select a prepared
build image.

The HTTP image is
`protocol-target-lab/http:0.3.0`. Build artifacts are under `target/` and `dist/`.
The manager package is `dist/protocol-target-lab_0.12.0_amd64.deb`.

If a compatible manager binary was compiled in a separate Ubuntu 24.04 build
environment, package it without rebuilding on the current host:

```sh
make deb PLAB_BINARY=/path/to/ubuntu24-build/protocol-target-lab
```

After online preparation, these build paths can use the prepared local caches:

```sh
make verify-deps
make build-ubuntu24 OFFLINE=1
make images OFFLINE=1
make deb PLAB_BINARY=.local/build/ubuntu24/target/release/protocol-target-lab OFFLINE=1
```

Offline build mode passes `--offline` to npm, `--frozen` to Cargo, and does not
provide network access to image build steps. A failed cache lookup is an error.
These stage-one cache interfaces do not yet constitute the full clean-machine
offline installation bundle or complete source-dependency distribution.

## Install and use

The release package selects Ubuntu 24.04's `docker.io` package as its Docker
Engine and CLI provider. Install it first, or have the corresponding prepared
packages available to APT. The manager deb declares `docker.io` and its detected
native library dependencies. The project does not automatically replace another
Docker provider; a host with Docker CE can run development builds directly, while
the current deb installation baseline is `docker.io`.

```sh
sudo apt install ./dist/protocol-target-lab_0.12.0_amd64.deb
systemctl status protocol-target-lab.service
plabctl status
```

The package starts the management service. Open `http://<target-address>:18000`.
The Web application has no login. Its sidebar lists the implemented protocols
and shows each backend-reconciled state or diagnostic error. The fixed HTTP workspace starts with a disabled `http-demo` main
configuration on a fresh installation; review its bind address, port, and
response generation settings before starting it. The default target port is
18090 and generated responses default to 64 bytes in fixed mode.

The manager remains available when the Docker backend or HTTP image is missing
and reports the reason. Image import is separate from installation:

```sh
# On a machine containing the built image:
docker save -o http-image.tar protocol-target-lab/http:0.3.0
# On the target:
sudo docker load -i http-image.tar
```

Alternatively, export the versioned HTTP image and its checksum manifest with
`make assets`, transfer `dist/http-assets/`, and run
`sudo plabctl assets import ./dist/http-assets`. The CLI validates the local
manifest before importing the image. This HTTP asset set is separate from the
full offline installation bundle planned for a later phase.

After an image becomes available, retry the workspace operation in the Web UI.
Large image archives are not imported or downloaded by package-maintainer scripts.

## Fixed protocol workspaces

There is one main configuration per protocol. Start, stop, restart, logs, and
connection tests operate directly on that protocol's workspace. Internal runtime
components do not create more workspaces: future IEC101 support must keep both
independent address-width channels in the same workspace, while an MQTT-SN
private broker is an internal dependency. Temporary test containers also remain
internal resources. Only HTTP is currently implemented.

Existing single-HTTP configurations retain their original ID, ownership hash,
applied snapshot, and running container, including custom IDs other than
`http-demo`. An old valid file with an empty `instances` array is populated with
a disabled default HTTP configuration. An old file containing multiple HTTP
configurations enters diagnostic protection: the manager preserves the original
file and containers and does not automatically choose, merge, rename, delete, or
start any of them. The UI reports the ambiguity rather than presenting an
arbitrarily selected configuration.

`GET /api/protocols` returns `workspace` (the main configuration view or null),
`status`, and `error` for each implemented protocol. These runtime/diagnostic
fields drive the sidebar; the static `available` flag only identifies an
implemented protocol. The persisted `instances` array and the read-only
`GET /api/instances` endpoint remain for compatibility. Existing ID-based
configuration, lifecycle, logs and test URLs continue to work; IDs are not
renamed during upgrade. Disabled intent remains disabled across upgrades.
`POST /api/instances` and
`DELETE /api/instances/{id}` return 405 because configuration creation and
deletion are no longer supported.

Manual HTTP verification uses the client tests in the connection panel. The
separate business-probe button and `POST /api/instances/{id}/probe` endpoint
have been removed. Startup and explicit start readiness checks remain internal
and verify an actual HTTP response against the applied startup settings.

## HTTP and logs

Configure `bind_ip`, `port`, `response_length` (0 through 1048576 bytes), and
`response_mode` (`fixed` or `random`) in the Web UI. The UI lists GET, HEAD, POST,
PUT, PATCH, DELETE and OPTIONS. Every supported method except HEAD returns the
configured generated body; HEAD sends the corresponding headers without a body.
POST and the other request-body methods do not echo their request in this mode.

Fixed content repeats the ASCII byte pattern `0123456789abcdef` and truncates it
to the exact requested length. Random content uses fresh binary bytes per
response. A zero length means an empty body. The `/ok`, `/chunked`, and `/close`
paths use fixed-length, chunked, and connection-close delimiting respectively.
OPTIONS and unsupported-method responses expose the supported method list in
Allow. See [HTTP details](docs/http.md) for limits and the public validation client.

Saving updates the draft; an explicit start/restart applies it. Existing v1
`response_body` configurations remain readable, with their exact ownership hash
and old applied behavior preserved. The UI converts them only into an editing
draft and explains the behavior change. Save and explicitly restart to adopt
length/mode generation. Until then, an old running container is adopted unchanged
and may still support only the original GET/HEAD/POST methods. Automatic recovery
uses its saved legacy snapshot and the new worker's compatibility arguments.
Explicit saves write schema version 2; both v1 and v2 files remain readable.

Manager 0.8.0 continues to use HTTP image
`protocol-target-lab/http:0.3.0`; if a customized environment file still selects an
older image, update `PLAB_HTTP_IMAGE` after importing the new version. The manager
checks image capability before stopping the running HTTP service to apply new options.

The **Connection and verification** panel runs GET, POST and the other method
checks directly. Select `/ok`, `/chunked` or `/close`, then a method or all methods.
The HTTP image contains both server and client programs: a one-shot container
runs the client against the workspace's applied configuration, reports pass/fail
and bounded request/response details, and is removed after completion. No client
packages are installed on the management host. Existing server containers are
not restarted for a test.

The endpoint validates the unique owned running target first. It serializes test
execution with lifecycle operations, limits the client to a 30-second deadline
and the Docker attachment to 45 seconds, and limits the report to 128 KiB.
Cleanup is ownership-scoped and retried after Docker recovery. Manager restart
cleans previous-session test containers; stop-all/remove also clean test
containers. Missing client images and cleanup failures remain visible in the UI.
Only the latest result for the HTTP workspace is shown. The internal result
cache remains bounded; results are not a persistent history and are lost on
manager restart.
This built-in test runs on the target host and does not prove external or
cross-node reachability. The public standalone client remains available for that.

The workspace log panel shows worker stdout/stderr and management events through
SSE, with pause, copy, and download controls. Body previews are bounded and include
original body length and a truncation flag. Docker worker logs are capped at two
5 MiB files per container; the manager does not maintain a historical database.

## Lifecycle and configuration

```sh
sudo plabctl start       # Start the manager and restore enabled services
plabctl status
plabctl doctor
sudo plabctl stop-all    # Stop manager first, then this deployment's workers
```

`systemctl restart protocol-target-lab` restarts the manager and adopts its
existing labeled worker containers. `systemctl stop` stops the manager entry
point; workers continue running. `plabctl stop-all` stops the manager before
cleaning up this deployment's resources and preserves enabled intent for the next
`plabctl start`. The workspace Stop control disables its HTTP service persistently.

Installed paths:

| Path | Purpose |
| --- | --- |
| `/usr/bin/protocol-target-lab` | Native manager and CLI binary |
| `/usr/bin/plabctl` | Link to the same binary |
| `/etc/default/protocol-target-lab` | Service environment, preserved during upgrades |
| `/etc/protocol-target-lab/instances.json` | Current configuration, enabled intent and applied snapshots |
| `/var/lib/protocol-target-lab/` | Deployment runtime state and locks |
| `/run/protocol-target-lab/` | Reserved volatile runtime directory |

Override management listen address, configuration path, state directory and HTTP
image using `PLAB_LISTEN`, `PLAB_CONFIG_FILE`, `PLAB_DATA_DIR`, and
`PLAB_HTTP_IMAGE` in `/etc/default/protocol-target-lab`. Use literal `KEY=VALUE`
assignments, optionally single- or double-quoted; shell expressions are not
executed. Both the service and `plabctl` read this file, so CLI operations use the
same paths. Existing environment variables take precedence. `PLAB_ENV_FILE` may
select a different settings file for development. The Docker socket defaults to
`/var/run/docker.sock`; `PLAB_DOCKER_SOCKET` can select a different local socket.

Upgrades restart only the manager and preserve configuration. Package removal
runs stop-all and retains configuration. Purge removes only this project's
configuration and state directories; it does not delete unrelated containers or
the host's Docker image store.

## Validate

Start HTTP in its workspace, then run the independent client from another
Linux node (or the local node during development):

```sh
make smoke SCENARIO=http-basic TARGET_ADDR=192.0.2.20 TARGET_PORT=18090
# For a customized body:
make smoke TARGET_ADDR=192.0.2.20 TARGET_PORT=18090 RESPONSE_LENGTH=1024 RESPONSE_MODE=random
make test
```

The example is a documentation address; substitute the actual target. The client
does not change workspace configuration or start the service. It verifies two rounds of all three response
forms, all seven methods, HEAD without a body, generated POST responses,
repeated connections, Allow headers, and a 404 response. For
retained JSON evidence, invoke `public-tests/http_smoke.py --output <new-file>`.

A complete first-stage acceptance also requires browser configuration and logs,
real Docker start/stop and listener release, manager restart adoption, applied
snapshot restoration, and installation/restart testing on Ubuntu 24.04. Reports
must distinguish local checks, dual-node checks, manager restarts, and actual host
reboots. The complete nine-protocol/offline release is not claimed by this phase.

## Source and licenses

Project source is MIT licensed; see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Cargo/npm lockfiles identify the selected
dependencies. Local reference material, plans, and environment-specific evidence
are excluded from Git under `.local/` and are not part of package build contexts.

## DNS workspace

DNS uses real dnsmasq **2.90** with configurable host IPv4 binding, port,
UDP/TCP switches, and A/AAAA static records (name, address, TTL). Both transports
are enabled by default on port 15353 with `device.test A 192.0.2.28`, TTL 60.
Unknown names receive negative answers; the worker has no upstream recursion.
The container uses a bridge network and publishes only enabled transports.
A port already used by an existing service must be changed before starting.

```sh
plabctl config get dns
plabctl config set dns --port 15354
plabctl start dns
plabctl tests run dns --method ALL
plabctl tests run dns --method TCP --name device.test
plabctl logs dns
plabctl stop dns
```

The Web and CLI share saved/applied state, lifecycle, logs, and the same
single-use DNS client. Tests verify actual IDs, questions, answer sets, TTLs,
negative answers, and TCP framing. Internal startup checks query every enabled
transport. Existing HTTP workspace IDs, configuration fingerprints and containers
remain compatible; valid older installations gain a disabled DNS workspace.
No existing manual DNS service is stopped or imported automatically.

See [DNS build and protocol details](docs/dns.md) and [CLI reference](docs/cli.md).
The DNS image distribution includes dnsmasq source, build instructions and license
materials. Keep those materials with redistributed images.

## MQTT workspace

MQTT uses real Eclipse Mosquitto **2.0.18** with two documented upstream
packet-size backports and an anonymous plain-TCP lab
listener. Configure host IPv4 binding, port, connection limit (1..128) and
maximum packet size (128..1048576 bytes). The default host port is 18883;
choose an unused port when another broker already occupies it. No extra 1883
listener is created. TLS, websockets, authentication and durable sessions are
outside this initial MQTT workspace.

```sh
plabctl config set mqtt --port 18884 --max-connections 32 --max-packet-size 1048576
plabctl start mqtt
plabctl tests run mqtt --method ALL
plabctl tests run mqtt --method MQTT5_QOS2
plabctl logs mqtt
plabctl stop mqtt
```

The same-image disposable client verifies MQTT 3.1.1 and 5.0, QoS 0/1/2, two
rounds per case. A separate subscriber must receive the exact topic/payload;
publisher and subscriber acknowledgements are both checked. Test topics and
client IDs use unique suffixes. At least two allowed connections are required
for this independent publisher/subscriber test; a one-connection broker remains
a valid service configuration and reports why this test cannot run.

Use `make fetch-mqtt-deps`, `make mqtt-images` and `make mqtt-assets` for explicit
online preparation, offline image build and runtime/source export respectively.
The manager never pulls images at service start. Existing HTTP/DNS workspace
IDs, saved/applied data, ownership hashes and containers are preserved; older
valid installations gain a disabled MQTT workspace. See [MQTT details](docs/mqtt.md).

## Telnet workspace

Telnet uses the real **telnetlib3 4.0.3** stack and its native option callbacks.
The finite lab application supports `ECHO <data>`, `INFO` and `CLOSE`; it does
not provide a system login or run shell commands. INFO exposes the actual
session's native TTYPE/NAWS/TSPEED/XDISPLOC/NEW_ENVIRON metadata, so clients can
verify one-way subnegotiations without invented wire acknowledgements. AYT is
not advertised as supported when the native stack leaves it unhandled.

Configure host binding/port (default2323), a nonempty banner (at most256 UTF-8
bytes, no ASCII control characters), active connection limit1..128 and decoded
application input-line limit64..65536 bytes, excluding its final CRLF. The
welcome line is `PLAB TELNET <banner>`. Normal service has no short-run quota;
malformed/over-budget connections are closed individually. Native subnegotiation,
environment metadata and output queues have separate bounded resource policies.

```sh
plabctl config set telnet --port 23230 --banner 'Protocol Target Lab Telnet' --max-connections 16 --max-line-bytes 4096
plabctl start telnet
plabctl tests run telnet --method ALL
plabctl tests run telnet --method OPTIONS
plabctl logs telnet
plabctl stop telnet
```

Disposable tests cover welcome, byte echo/IAC escaping, real native option
callbacks and unsupported-option rejection. Use `make fetch-telnet-deps`,
`make telnet-images` and `make telnet-assets` for explicit preparation, offline
build and image/source/license export. See [Telnet details](docs/telnet.md).


## IEC104 workspace

IEC104 runs real **c104 2.2.1** with a documented native TCP framing correction over plain TCP with STARTDT/STOPDT/TESTFR,
general interrogation, point reads and direct single commands. Three fixed
roles expose editable CA/IOA addresses: one M_SP_NA_1 boolean, one M_ME_NC_1
float32 measurement, and one C_SC_NA_1 command that updates the configured
single point in simulated memory. Startup values are configuration, rather
than live telemetry. TLS, physical control, reset services and additional
command families are outside this workspace.

```sh
make fetch-iec104-deps
make iec104-images OFFLINE=1
make iec104-assets
plabctl config set iec104 --port 24040
plabctl start iec104
plabctl tests run iec104 --method ALL
plabctl logs iec104
plabctl stop iec104
```

The same-image disposable client verifies real U/I/S frames, GI confirmation,
monitoring data and termination, read values and direct-command confirmation.
COMMAND changes the current simulated single value, checks it through READ/GI,
then restores and verifies the prior value; it reports failure if restoration
fails. It does not invent a command termination ASDU. Public pinned wheel,
full native source, exact project framing patch and build/license materials accompany the runtime image.
See [IEC104 details](docs/iec104.md) and [CLI reference](docs/cli.md).


## MQTT-SN workspace

MQTT-SN runs a real **Eclipse Paho1.5.1** UDP gateway with a documented native registration-capacity guard and a private Mosquitto
broker in one supervised container. Host networking carries actual multicast
GWINFO replies; the native gateway listens on all IPv4 interfaces. The private
broker binds only127.0.0.1 on its configured port and is independent of the
public MQTT workspace. Configuration exposes primary UDP, discovery group/UDP
port, gateway ID, private broker port and1..16 predefined mappings.

```sh
make fetch-mqtt-sn-deps
make mqtt-sn-images OFFLINE=1
make mqtt-sn-assets
plabctl config set mqtt-sn --port 18998 --discovery-port 18999 --broker-port 28997
plabctl start mqtt-sn
plabctl tests run mqtt-sn --method ALL
plabctl logs mqtt-sn
plabctl stop mqtt-sn
```

The disposable client validates QoS1 normal/predefined publications through an
independent MQTT subscriber, two same-ID reconnects with fresh source ports,
and native multicast discovery with exact gateway identity/source checks. Other
MQTT-SN QoS modes are outside this phase acceptance. Predefined topics use a
restricted visible-ASCII subset without a leading dollar sign, because the private
broker reserves system namespaces and the native CSV reader rewrites some
whitespace/Unicode bytes. Private broker supervision, socket conflicts and
restart adoption preserve the existing protocol workspaces. See
[MQTT-SN details](docs/mqtt-sn.md) and [CLI reference](docs/cli.md).

## RTP receiver

RTP uses a single UDP receiver workspace with configurable binding and complete
packet capacity. It parses RTPv2 headers, CSRCs, opaque extensions and padding;
payloads remain opaque and no RTP ACK is generated. Disposable clients and
startup readiness prove actual fresh receive observations through an unpublished
read-only observer in the same container. See [RTP guide](docs/rtp.md),
[acceptance criteria](docs/rtp-acceptance.md) and [CLI reference](docs/cli.md).

```sh
make rtp-images OFFLINE=1
make rtp-assets OFFLINE=1
sudo plabctl assets import ./dist/rtp-assets
plabctl config set rtp --port 15004 --max-packet-size 2048
plabctl start rtp
plabctl tests run rtp --method ALL
```

The image uses the already prepared locked Python base. Startup never pulls.
The observer is not a configurable external service or a protocol reply; only
the RTP UDP endpoint is published. Host-to-private-bridge connectivity on the
supported rootful Linux Docker setup is required for managed receive verification.

## RTCP receiver

The independent RTCP workspace receives SR+SDES CNAME compounds using its fixed
`sr-sdes` profile. It does not send RR/ACK or depend on RTP running. Readiness and
clients prove fresh actual UDP reception through a private read-only observer.
See [RTCP guide](docs/rtcp.md), [acceptance criteria](docs/rtcp-acceptance.md)
and [CLI reference](docs/cli.md).

```sh
make rtcp-images OFFLINE=1
make rtcp-assets OFFLINE=1
sudo plabctl assets import ./dist/rtcp-assets
plabctl config set rtcp --port 15005 --max-packet-size 2048
plabctl start rtcp
plabctl tests run rtcp --method ALL
```

The same prepared locked Python base is required for offline worker builds.
Only UDP 5005 is published; observer TCP 18081 stays inside the private bridge.
The native manager verifies the exact owned source container. Sender-declared
counters and exact NTP hexadecimal fields describe received RTCP data, not
media playback, clock synchronization or measured RTP loss/jitter.
