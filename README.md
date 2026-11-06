# Protocol Target Lab

A Linux protocol test target manager. The native Rust service serves an embedded
React Web application, JSON API, and live logs. Protocol workers run in Docker
containers with independently managed lifecycles.

The current implementation supports **seventeen protocols: HTTP, DNS, MQTT, Telnet, IEC104, MQTT-SN, RTP, RTCP, DL/T645, IEC101, BFD, VXLAN, ARP-client, Custom Ethernet, IGMP, MPLS and PROFINET**, with manager version **0.22.0**,
HTTP server/client image **0.4.0**, DNS server/client image **0.2.0**, MQTT server/client image **0.1.1**, Telnet server/client image **0.1.0**, IEC104 server/client image **0.1.1**, MQTT-SN server/client image **0.1.1**, RTP receiver/client image **0.1.0**, RTCP receiver/client image **0.1.0**, DL/T645 meter/client image **0.1.0**, IEC101 dual-channel slave/client image **0.1.0**, BFD peer/client image **0.1.0**, VXLAN ARP responder/client image **0.1.0**, ARP-client requester/inverse-peer image **0.1.0**, Custom Ethernet fixed-responder/client image **0.1.0**, IGMP native-member/query-client image **0.1.0**, MPLS target/client image **0.1.0**, and PROFINET native-DCP/software-PTCP/client image **0.1.0**. Each protocol has one fixed workspace and
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

## HTTPS and DNS TLS

The existing HTTP workspace can switch its port to HTTPS. DNS supports independently
enabled UDP, TCP and TLS endpoints, retaining real dnsmasq for normal queries.
HTTP adds 24 fixed reference response paths; DNS includes all 57 saved raw fixtures
in selectable sets. Built-in clients validate the public laboratory certificate
and verify actual response bytes and explicitly bounded timing. See
[HTTPS, DNS TLS and response scenarios](docs/http-dns-tls.md) for configuration,
certificate download, all paths, fixture IDs and test boundaries.

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
not need Node, npm, Cargo, or Nginx on the host. The Rust core and API client do
not use host Python. The deb additionally depends on **Python 3** for the optional
local `plabctl serial` PTY helper and typed `plabctl igmp link` helper. The latter only creates new project-owned kernel VXLAN devices; existing physical links remain read-only. See [IGMP](docs/igmp.md). The serial helper is installed at
`/usr/libexec/protocol-target-lab/iec101_serial.py` and invoked with Python isolated
mode. The host also needs **iproute2** for the manager's read-only `ip -j`
address/interface checks before BFD operations; the deb declares this dependency.
Protocol workers and their Python runtimes run inside their own containers.

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
`protocol-target-lab/http:0.4.0`. Build artifacts are under `target/` and `dist/`.
The manager package is `dist/protocol-target-lab_0.17.0_amd64.deb`.

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
packages available to APT. The manager deb declares `docker.io`, Python 3 for the local serial helper,
iproute2 for BFD address/interface checks, and its detected native library
dependencies. The project does not automatically replace another
Docker provider; a host with Docker CE can run development builds directly, while
the current deb installation baseline is `docker.io`.

```sh
sudo apt install ./dist/protocol-target-lab_0.17.0_amd64.deb
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
docker save -o http-image.tar protocol-target-lab/http:0.4.0
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
components do not create more workspaces: IEC101 keeps both independent
address-width channels simultaneously in one workspace, while an MQTT-SN private broker is an internal dependency. Temporary
test containers also remain internal resources. The fifteen implemented protocols
listed above each have one fixed workspace.

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
`protocol-target-lab/http:0.4.0`; if a customized environment file still selects an
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
reboots. The complete planned protocol inventory and clean-machine offline release are
not claimed by this phase.

## Source and licenses

The original Rust/Web/Python project code is MIT licensed, except the
GPL-3.0-or-later IEC101 native wrapper linked to lib60870. Third-party stacks
retain their original terms; see [LICENSE](LICENSE) and
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

## DL/T645 software meter

The fixed DL/T645-2007 workspace carries a finite software meter's serial bytes
over TCP. Startup address/energy/period, simulated programming key, connection
capacity and optional exact security fixture are configurable. Read-only ALL
tests use current runtime values; explicit period-write tests restore their
observed starting value. See [meter guide](docs/dlt645.md),
[acceptance criteria](docs/dlt645-acceptance.md) and [CLI reference](docs/cli.md).

```sh
make dlt645-images OFFLINE=1
make dlt645-assets OFFLINE=1
sudo plabctl assets import ./dist/dlt645-assets
plabctl config set dlt645 --port 20646
plabctl start dlt645
plabctl tests run dlt645 --method ALL
```

The original standard-library worker requires only the prepared locked Python
base for offline rebuilds. It publishes TCP 20645 without device mounts or an
observer port. It does not claim physical RS485/baud/relay/measurement or ESAM
authentication; fixture transmission is explicitly non-cryptographic.

## IEC101 dual software serial workspace

IEC101 uses official **lib60870-C 2.4.1** in one supervised container. Both
independent channels run together: single-byte link/COT/CA/IOA widths1/1/1/1,
and double-profile widths2/2/2/3. Each has a private raw PTY, native slave child
per TCP session and one active master slot. Normal disconnect cleans only its
channel; an unexpected native/critical supervisor failure stops the whole group
for manager recovery. Native Reset/Status, class1/class2 polls, shared FCB
handling, configured single-point data and complete GI7/20/10 are exercised.

```sh
make fetch-iec101-deps
make iec101-images OFFLINE=1
make iec101-assets OFFLINE=1
sudo plabctl assets import ./dist/iec101-assets
plabctl config set iec101 --file dual-config.json
plabctl start iec101
plabctl tests run iec101 --method ALL --path dual
```

Use the full nested configuration described by `plabctl schema iec101`; the two
host TCP ports must be distinct and unused. Both channels remain in one saved
and applied configuration. ALL/dual performs16 real checks, not an ACK-only GI
assertion. Same-host tests do not establish a separate-node serial byte path.

For a test application that opens serial devices, run the optional root-owned
helper on that application's host, using the target's two configured ports:

```sh
sudo plabctl serial start --host 192.0.2.20 --single-port 24751 --double-port 24752
sudo plabctl serial status
# Open /run/protocol-target-lab/serial/iec101-a and iec101-b in the test application.
sudo plabctl serial stop
```

This local command uses Python3 and does not use the management API or SSH. Both
PTY paths must be visible and permitted in the consuming process's namespace.
Explicit `serial start` reconnects disconnected channels; there is no automatic
replay of bytes after a TCP disconnect. Full GPL native source/wrapper/build
materials accompany the separately imported runtime. The software serial profile
is9600/8N1; it does not establish physical RS232/RS485 electrical behavior,
line rate/parity, half-duplex direction or field hardware operation. See
[IEC101 guide](docs/iec101.md), [acceptance scope](docs/iec101-acceptance.md),
and [CLI reference](docs/cli.md).

## BFD active single-hop peer

BFD runs an autonomous IPv4 single-hop active Control peer in host networking.
It owns its explicit bind address's UDP3784 receiver and configured high source
port, plus a private read-only observer on127.0.0.1:18084. Default addresses
127.0.0.1/127.0.0.2 and interface lo provide genuine software-loopback BFD without
adding host addresses. The worker uses only NET_RAW for interface binding; it
does not configure routes, interfaces or sysctls. Host iproute2 is required for
the manager's read-only address/interface preflight.

```sh
make fetch-bfd-deps
make bfd-images OFFLINE=1
make bfd-assets OFFLINE=1
sudo plabctl assets import ./dist/bfd-assets
plabctl start bfd
plabctl runtime bfd
plabctl tests run bfd --method ALL
plabctl stop bfd
```

Six target-side modes are normal, poll, quiet, wrong-your, ttl254 and short.
Each fault is armed after actual bidirectional Up and runs at most once for a
validated peer epoch; Down/recovery alone does not rearm it. ALL validates the
CURRENT applied mode for two fresh rounds, including actual target output and
recovery. It does not reconfigure the target to claim all six modes in one run.

The runtime query separates a running worker from actual peer Down/Init/Up.
Health reads bounded state and actual socket/process identity; it creates no
fake peer. BFD tests default to150s CLI waiting, while other commands keep120s.
A test can run locally only when the configured peer address/interface already
belongs to that host and its peer_ip:3784 is free. For a remote LAN peer, run the
same-image client on that node with its own interface name and trusted private
observation; Web tests do not spoof remote addresses or change network setup.

The runtime is original MIT Python standard-library code. Original FRR is a
separate independent oracle, not a dependency bundled into the worker or deb.
Software-loopback/native-oracle evidence does not establish a physical fault,
routing convergence or whole-host reboot. See [BFD guide](docs/bfd.md),
[acceptance scope](docs/bfd-acceptance.md) and [CLI reference](docs/cli.md).

## VXLAN ARP target

The fixed VXLAN workspace implements a finite unicast IPv4 Ethernet/ARP responder
with eleven persistent target response modes. It validates each complete Request
before constructing or suppressing a Reply. The server uses two exclusive UDP
sockets and sends to the configured fixed counterpart receive port, independently
of the incoming source port. Web and CLI expose the same configuration, local
runtime observation, lifecycle, logs and disposable same-image client.

`plabctl tests run vxlan --method ALL` checks the current applied mode with eight
fresh Requests and actual receive plus causal source evidence. It does not switch
modes. A remote counterpart must run the client on its own node; built-in API
clients execute on the manager host. Local readiness does not mean a connected
tunnel. This profile provides ARP behavior rather than a general L2 bridge or
IPv4/ICMP service. See [VXLAN details](docs/vxlan.md) and
[acceptance scope](docs/vxlan-acceptance.md).

## Active ARP, RARP and InARP target

The ARP-client workspace continuously sends real Ethernet requests in four modes
and fifteen legal mode/scenario combinations. Its disposable same-image test tool
is the inverse responder. The default uses a deployment-owned internal Docker
bridge with actual separate veth interfaces and configured actual NIC MACs.
The host-interface mode uses an existing Ethernet NIC and its actual MAC.

Role IP fields describe the experiment. They do not configure OS addresses, and
this link-layer protocol has no application TCP/UDP port. Runtime readiness proves
packet socket, interface/filter, source identity and main-loop health. A previous
mapping is historical; it does not mean every subsequent query succeeds. There
is no ARP wire transaction ID or response ACK.

`plabctl tests run arp-client --method ALL` runs four cases twice for the current
applied pair. It does not reconfigure the requester. Legal service timers that
cannot fit the bounded test are rejected before creating the temporary peer.
Builtin host-interface tests require a unique different real peer NIC on the
manager host; an external peer must specify its own actual interface. See the
[ARP-client guide](docs/arp-client.md) and [acceptance scope](docs/arp-client-acceptance.md).

## Custom Ethernet fixed response

The custom-ethernet workspace uses public libpcap1.10.5 to compile the independent
receive expression on the actual Linux Ethernet interface, then installs and reads
back kernel classic BPF. It persistently sends one configured response per matching
incoming frame and optional exact payload prefix. Choose a constructed Ethernet
header plus fixed payload or an opaque complete raw frame. Both response banks,
disabled VLAN values and source override values remain saved when switching modes.

The default isolated software link uses an owned internal Docker network and a
disposable same-image sender/receiver on a separate actual veth. Existing host
interfaces are an explicit alternative. Request fixtures, filters and TX fields are
independent; a nonmatching user fixture fails honestly. ALL checks the current
fixture with four check groups and eight actual exchanges. There is no application
TCP/UDP port or protocol ACK. See [configuration, limits and offline build](docs/custom-ethernet.md) and
[CLI](docs/cli.md).

MPLS adds a finite single-label Ethernet/IPv4 ICMP Echo workspace with fourteen output scenarios, actual packet evidence and a disposable same-image client. See [MPLS](docs/mpls.md); it does not configure host MPLS forwarding or claim a general router.

PROFINET adds native p-net 0.2.0 DCP with a retained native store and simultaneous
software PTCP no-FollowUp/FollowUp nodes on three actual MACs. It uses new private
management/data networks and supports external tools on the data network. See
[PROFINET](docs/profinet.md). Cyclic PLC IO, IRT and hardware clock precision are
outside this finite lab profile.
