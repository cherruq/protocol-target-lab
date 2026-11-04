# HTTP target

The HTTP worker runs continuously in Docker until explicitly stopped. It uses
Python 3.12's standard library and has no pip packages or external dependencies.
The manager supplies bind address, port, generated response length, and generation
mode as separate command arguments. Manager **0.4.1** uses the unchanged HTTP
server/client image **0.3.0**.

Manual verification is unified in the built-in client tests. There is no
separate business-probe UI or probe API. Startup readiness still checks HTTP
status, response length and fixed content internally before accepting a start.

## Fixed HTTP workspace

The sidebar contains the implemented HTTP protocol and its backend-reconciled
status/error. Selecting HTTP opens its sole workspace directly, including main
configuration, lifecycle controls, logs, and connection tests. There is no
instance list and no create, copy, or delete configuration action.

The single stored HTTP configuration keeps its stable ID. An existing custom ID
is used as-is, along with its applied snapshot, ownership hash and running
container. A valid empty configuration array restores a disabled `http-demo`
default. Multiple HTTP configurations are diagnosed as ambiguous; the manager
protects the original file and containers and does not automatically select,
merge, rename, delete or start them.

Protocol workspaces are distinct from internal resources. The one-shot client
container is not a second HTTP workspace. Future IEC101 must retain its two
independent channels in one protocol workspace, and MQTT-SN's private broker is
an internal dependency; neither is currently implemented by the HTTP phase.

`GET /api/protocols` returns `workspace` (the main configuration view or null),
`status`, and `error`; the sidebar uses these runtime/diagnostic fields rather
than the static `available` flag. `GET /api/instances` and the original ID-based
configuration, lifecycle, log and test endpoints remain compatible. Configuration creation
`POST /api/instances` and deletion `DELETE /api/instances/{id}` return 405.

## Methods and response generation

Supported methods are **GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS**. In the normal
generation mode, every method except HEAD returns a newly selected response body
with `Content-Type: application/octet-stream`. Request bodies are read and logged
but do not become the response. HEAD sends the corresponding response headers and
no body bytes.

- `--response-length`: exact body length in bytes, from 0 through 1048576 inclusive;
  default 64.
- `--response-mode=fixed`: repeat ASCII byte pattern `0123456789abcdef` and truncate
  to the requested length. The same settings always produce the same bytes.
- `--response-mode=random`: use `os.urandom(length)` separately for each response.
  Random bodies are binary and are not guaranteed to be valid text. Natural
  repeated values are possible, especially at length 0 or 1.

| Path | Response delimiter |
| --- | --- |
| `/ok` | Content-Length, equal to the configured byte length |
| `/chunked` | Transfer-Encoding: chunked, no Content-Length |
| `/close` | Connection: close, no length or transfer-encoding header |

All seven methods work on all three paths. OPTIONS also returns
`Allow: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`. Unsupported methods, including
TRACE and CONNECT, return 405 with the same Allow header. Unknown paths return 404.
The target does not implement a forward proxy, CONNECT tunnel, resource mutation,
or a persistent document store; these methods exercise HTTP exchanges.

`/ok` and `/chunked` support repeated requests on one connection. Request bodies
are limited to 1 MiB. Chunked request bodies are unsupported and receive 501.
Connections have a five-second socket timeout, and at most 64 run concurrently.
These limits do not expire the service or cap its lifetime request count.

## Logs and lifecycle

JSON events go to stdout. The ready event declares supported `methods`,
`response_length`, `response_mode`, and whether legacy POST echo is active.
Request and response events include `body_length`, a hexadecimal preview of at
most 256 bytes, and `body_truncated`. They describe HTTP bodies rather than a full
wire capture. Docker's bounded log driver and the manager provide retention and
streaming. SIGTERM closes active sockets and the listening socket.

## Independent validation

Validate the running HTTP service without changing its configuration:

```sh
python3 public-tests/http_smoke.py --host 192.0.2.20 --port 18090 --response-length 64 --response-mode fixed --output evidence/http-fixed.json
python3 public-tests/http_smoke.py --host 192.0.2.20 --port 18090 --response-length 1024 --response-mode random --output evidence/http-random.json
```

Replace the documentation address with the actual target address and use its
configured settings. The public client checks two rounds of seven methods on
three paths, exact response length and deterministic fixed bytes, normal framing,
OPTIONS Allow, unsupported methods, 404, connection reuse, and raw HEAD responses.
For random mode it compares repeated requests for every body-producing
method/path; a few retries avoid treating a natural short random collision as a
constant response. At lengths 0 and 1 it skips statistical variation checks.
Reports include body length, SHA256 and at most 256 bytes of hexadecimal preview,
so large response bodies do not become large evidence files. The client exits
nonzero on failure and never starts containers or changes workspace configuration.

## Legacy applied-configuration compatibility

An explicit `--response-body=TEXT` starts the **new worker in compatibility mode**:
GET and HEAD use that UTF-8 text, while POST echoes the received request body on
all three paths. The newly supported PUT/PATCH/DELETE/OPTIONS methods return that
same configured text. Legacy text is limited to 65536 UTF-8 bytes. This mode exists
so previously applied instance snapshots can be restored without changing their
GET/HEAD/POST behavior. It cannot be combined with either `--response-length` or
`--response-mode`.

The public client's counterpart is `--body=TEXT`; it verifies POST echo and all
seven methods on this new compatibility-mode worker. It is mutually exclusive
with the new generation parameters. This seven-method client is not intended to
validate the original three-method worker image.

```sh
python3 public-tests/http_smoke.py --host 192.0.2.20 --port 18090 --body=hello --output evidence/http-legacy.json
```

## Version 0.2.0 verification

Verified on 2026-11-04. The worker passed ten real-socket matrices totaling 610
checks and five invalid-CLI cases, including empty, one-byte, maximum-size,
random and legacy responses. An independent agent passed 29 management and
compatibility checks and 381 HTTP subchecks against real Docker containers.
That upgrade exercise started the actual v1 manager and image before switching
to v2; the original container ID, start time, PID and configuration fingerprint
remained unchanged, and opening the new manager did not rewrite the v1 file.

The actual v2 deb was built for and installed on Ubuntu 24.04. A separate Linux
node passed 266 public HTTP checks across fixed 64-byte, random 1024-byte, empty,
and random 1 MiB responses. Real browser verification covered the method list,
the length/mode form, legacy notices, explicit draft application, empty responses,
and fresh random responses. Raw environment evidence remains in ignored local
verification directories. These results do not claim a whole-host reboot or a
complete offline distribution.

## One-shot client in the HTTP image

The HTTP image also contains `/opt/protocol-target-lab/client.py`. The default
image entrypoint continues to start the HTTP server. Override it with `python3`
to run a separate one-shot client container against the running HTTP service:

```sh
docker run --rm --network host --entrypoint python3 protocol-target-lab/http:0.3.0 -u /opt/protocol-target-lab/client.py --host 192.0.2.20 --port 18090 --method GET --path /ok --response-length 64 --response-mode fixed
```

`--method` selects GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, or ALL. `--path`
selects `/ok`, `/chunked`, or `/close`. A single method makes two requests to that
path; ALL initially makes two requests per method, fourteen in total. In random
mode, identical initial samples can trigger up to three additional requests for
that method. Every extra request is included in the same bounded report. Use the target's
actual response length and mode. In normal mode, POST/PUT/PATCH/DELETE/OPTIONS send
a small binary test request but expect generated response bytes, rather than a
request echo. HEAD is checked using a raw socket so unexpected bytes following
its headers cannot be hidden by an HTTP client's HEAD handling.

The client emits exactly one JSON report on stdout with a top-level `passed`,
per-request checks containing request/response evidence, and
`summary: {total, passed, failed}`. A successful report exits 0; connection,
protocol, configuration, and deadline failures produce a JSON failure report and
exit 1. Body evidence uses original captured length, SHA256, and at most 256 bytes
of hexadecimal preview. Response header evidence is also bounded; oversized
headers fail the check instead of expanding the report without limit.

The client has a thirty-second overall deadline, three-second socket timeouts,
and reads at most 1 MiB plus one detection byte per response body. For random
responses of at least two bytes, identical initial samples trigger up to three
additional requests before diagnosing a constant response. The client does not
require every random value to be unique. Lengths 0 and 1 skip statistical
variation checks entirely. Retries still share the same overall deadline.

Use `--legacy-body=TEXT` for a target running legacy applied parameters. It is
mutually exclusive with the generation parameters and checks POST echo plus
configured GET/HEAD text. If ALL or a newer method is used against an original
three-method worker, unsupported responses are reported as failures; the client
does not silently skip them. The client never changes configuration or starts a
server. A client-capable image has label
`io.protocol-target-lab.http-client-schema=1` in addition to response schema 2.

### Web test execution and cleanup

The HTTP workspace connection panel submits `POST /api/instances/{id}/tests`
with a method and one of the three supported paths. HTTP 202 acknowledges a test ID. Poll
`GET /api/instances/{id}/tests` for the latest structured result; acknowledgement
alone is not success. The result records the exact source container and applied
configuration. Draft settings are never used or written by testing.

The manager runs the same immutable HTTP image with the client entrypoint in a
separate `--rm` container. Test labels are distinct from managed service labels,
so discovery cannot adopt the client as a server. Execution is serialized with
resource changes; reports are bounded, nonzero client exit status preserves valid
failure JSON, and the target identity is checked again before reporting success.
If the target changes during execution, even successful individual requests do
not produce an overall success.

Normal completion and timeout paths explicitly verify cleanup. After manager
restart, previous-session client containers are removed; failed cleanup is
retried when Docker recovers. `stop-all` also cleans the deployment's clients.
The UI shows cleanup failures and interrupted-session notices. It displays only
the latest result for the HTTP workspace, backed by a bounded in-memory cache
with no persistent history. This is a same-host check; use an independent node
to validate external reachability.

Version 0.3.0 verification (2026-11-04) included 27 independent real Docker/API
checks, real HTTP failures, 42 maximum-size method exchanges, malformed and
oversized reports, a 45-second execution timeout, cleanup retry, process SIGKILL
recovery, and target replacement during testing. A stop-all integration check
used real Docker/locks/configuration with a process-local systemctl shim limited
to the test manager PID; it was not a real systemd check. Ubuntu 24.04 installation
and GET/POST/HEAD/ALL client execution were also tested on the deployed service,
with its server ID/start time/PID and configuration unchanged.
