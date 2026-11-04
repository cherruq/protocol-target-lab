# Telnet workspace

This workspace runs the real, unmodified telnetlib3 4.0.3 asyncio protocol
stack, with wcwidth 0.6.0 and a finite original laboratory application. It
provides no operating-system login, shell execution, filesystem command, or
credentials. A single protocol workspace controls one TCP service.

```json
{"bind_ip":"0.0.0.0","port":2323,"banner":"Protocol Target Lab Telnet","max_connections":16,"max_line_bytes":4096}
```

The host binding accepts an IPv4 unicast/wildcard address and port 1–65535.
The container listens only on internal IPv4 TCP 2323; Docker bridge publishing
maps the configured host endpoint. `max_connections` is an integer 1–128,
counting concurrent accepted connections, not all historical connections.
`max_line_bytes` is an integer 64–65536 and counts the decoded application line,
including its command but excluding one final CRLF. An escaped IAC IAC is one
application byte. The banner is nonempty UTF-8, at most 256 encoded bytes, and
contains no ASCII control character (0–31 or DEL). Unknown/null fields and
incorrect types are rejected.

The non-root server stays in the foreground, logs bounded JSON event summaries
to stdout, and has no global duration, request count, or session idle expiry.
SIGTERM closes the listener and current connections. Exceeding the concurrent
connection limit rejects only the excess connection; an overlong decoded line
receives `ERROR line too long` then closes that connection.

## Native negotiation and the experiment application

Incoming bytes pass through the native incremental IAC parser. The wrapper
retains native `super()` behavior for TTYPE, NAWS, TSPEED, XDISPLOC and
NEW_ENVIRON callbacks; it observes actual values and exposes native session
metadata through INFO. It does not manufacture a protocol acknowledgement for
options whose RFCs have none. Native terminal-type iteration/loop termination
is preserved. Unsupported option requests receive native DONT/WONT. AYT is
unhandled by this library and is explicitly reported as unsupported; no
artificial AYT response is added. Compression is disabled.

After negotiation, the server sends:

```text
PLAB TELNET {configured banner}\r\n
```

Commands are byte-oriented and terminated by CRLF:

- `ECHO <data>` returns the original data followed by CRLF. Native writer IAC
  escaping remains active. Delimiter CRLF ends the command; other in-band
  bytes retain the native protocol stack's interpretation.
- `INFO` returns one JSON line with native terminal type, rows/columns, speed,
  display location, received environment values, observed callback names and
  `ayt: "unhandled"`. Values come from the live connection, not expected test
  constants. Display strings are bounded to 256 UTF-8 bytes.
- `CLOSE` closes the connection normally. Unknown input returns
  `ERROR unknown command`; it is never executed.

Two independent resource guards apply to negotiation. An incremental per-frame
SB budget of 65536 wire bytes bounds unfinished subnegotiation before native
parsing; it resets after SE and does not expire a normal long session. Empty
or malformed native negotiation exceptions are isolated to that connection
with a bounded event, rather than an event-loop traceback. NEW_ENVIRON permits
at most 16 distinct environment names per connection, 8192 total UTF-8 bytes
in the merged current mapping, and at most 256 bytes per name/value, checked
before native metadata is updated; exceeding
these bounds closes the connection. Updating an existing valid variable still
uses the native callback. Native output is also checked after each input chunk;
a transport write buffer exceeding 65536 bytes is aborted locally. Callback
history is a fixed set of observed option names.

## Build and offline assets

```sh
scripts/telnet-fetch-deps.sh  # explicitly online: fixed base and public packages
scripts/telnet-images.sh      # offline pip install and image build, no network
scripts/telnet-assets.sh      # dist/telnet-assets runtime image + full materials
```

The image is `protocol-target-lab/telnet:0.1.0`. Exact public wheel/sdist URLs,
versions and SHA-256 are in `images/telnet/dependencies.lock.json`;
`requirements.lock` enables pip's `--require-hashes` mode. Dependencies are
installed with `--no-index --no-deps` from the local wheel cache. No compiler,
TLS library, host Python package installation, or source patch is needed. Both
build and runtime use the fixed Python 3.12 bookworm digest. A fresh offline
build requires that base image and the public source tree including the cached
wheels/sdists. The prepared `telnet-build:4.0.3` image is an optional reusable
dependency cache and is recreated without network by the image script.

The runtime and exported assets contain complete upstream wheel/sdist archives,
ISC/MIT notices, the CPython license for telnetlib3's bundled standard-library
backport, and exact build recipes. Installed wheel license metadata is retained.
See `third-party/telnetlib3/README.md`. The original wrapper/client are MIT;
upstream and base-image components retain their own licenses.

## Read-only client

The same image contains `/opt/protocol-target-lab/client.py`. Override the
server entrypoint to run a one-shot test:

```sh
docker run --rm --network=host --entrypoint python3 protocol-target-lab/telnet:0.1.0 \
  -u /opt/protocol-target-lab/client.py --host 127.0.0.1 --port 2323 \
  --method ALL --path session \
  --config-json '{"bind_ip":"0.0.0.0","port":2323,"banner":"Protocol Target Lab Telnet","max_connections":16,"max_line_bytes":4096}'
```

Methods are CONNECT, ECHO, OPTIONS, UNKNOWN_OPTION, or ALL, each run twice.
`--path` is `session`. CONNECT checks the actual welcome and CLOSE/EOF. ECHO
includes literal 0xFF, NUL, TAB and ESC, with fragmented writes and escaped IAC.
OPTIONS negotiates TTYPE, NAWS, TSPEED, XDISPLOC and NEW_ENVIRON in order, then
compares INFO to the independently selected random terminal/window/speed,
display, and environment values. Window negotiation includes an escaped 0xFF
inside SB. UNKNOWN_OPTION verifies native rejection of unassigned WILL/DO
options. The client starts no service and changes no configuration.

stdout is one JSON result with `passed`, per-scenario `checks`, `summary` and
elapsed `seconds`; exit status is 0 for pass and 1 for failure. Each check
records bounded payloads, original lengths and hashes, native INFO when
relevant, and `response.trace`/`response.negotiations` for actual wire traffic.
Per-socket timeout is three seconds, total deadline 30 seconds, and JSON report
limit 512 KiB. Incremental decoding has independent byte/event/SB limits.
Errors, unreachable targets and malformed responses produce JSON failures.

```sh
python3 -m unittest discover -s workers/telnet -p 'test_*.py'
```
