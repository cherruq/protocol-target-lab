# HTTP target

The HTTP worker runs continuously in Docker until explicitly stopped. It uses
Python 3.12's standard library and has no pip packages or external dependencies.
The manager supplies bind address, port, generated response length, and generation
mode as separate command arguments.

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

Validate an already-running instance without changing its configuration:

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
nonzero on failure and never starts containers or modifies instances.

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
