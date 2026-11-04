# Agent CLI

`plabctl` is installed by the same deb as the manager. It is a lightweight entry
point to the same native binary, using the management HTTP API for workspace
commands. It does not edit the server's files or invoke local Docker for these
commands. The Web UI is for interactive use; the CLI exposes the same implemented
HTTP, DNS, MQTT, Telnet, IEC104 and MQTT-SN workspaces to automation. Both control the same saved settings and resources.

API commands default to `http://127.0.0.1:18000`. Set `PLAB_URL` or pass `--url`
(the explicit option wins). HTTP root URLs only: no credentials, path, query or
fragment. The built-in client tests run on the target manager host, not on the
machine running `plabctl`; they do not prove cross-node reachability.

## Commands

| Command | Result |
| --- | --- |
| `health` | Management process health/version; not protocol readiness |
| `protocols` | Implemented protocols, actual state/errors and workspace |
| `schema http` | Configuration schema and supported methods |
| `show http` or `status http` | Current protocol descriptor including saved/applied state |
| `config get http` | Saved configuration |
| `config get http --applied` | Applied configuration, or null before the first successful start |
| `config set http --file config.json` | Validate and save a complete configuration |
| `config set http --file -` | Read complete JSON from stdin |
| `config set http --data '{...}'` | Save complete inline JSON |
| `config set http --port 18091 --response-length 512 --response-mode fixed` | Atomically edit specified HTTP fields in the latest saved configuration |
| `start http`, `stop http`, `restart http` | Perform and wait for that exact lifecycle operation |
| `connection-info http` | Connection URL/template and curl commands |
| `logs http` | One bounded log snapshot |
| `logs http --follow` | JSON Lines snapshots when logs change |
| `tests list http` | Available methods/paths, latest result and manager session |
| `tests run http --method ALL --path /ok` | Run a disposable client and wait for the matching result and cleanup |
| `tests result http` | Inspect the latest retained result; querying does not assert it passed |
| `tests result http --id TEST_ID --wait` | Wait for and assert the specified retained result |
| `environment` | Docker/image availability and manager diagnostics |
| `assets list` | Configured image availability and immutable image ID |

Field editing supports `--bind-ip`, `--port`, `--response-length`, and
`--response-mode`. File/data input and field options are mutually exclusive.
Configuration input is bounded to 512 KiB and uses the same validation as the
manager. Field edits use PATCH and merge only specified fields under the server's
configuration lock, preserving unrelated concurrent saves. They require manager
0.5.1 or newer; older managers reject PATCH, with no fallback to a stale full PUT.
File/data commands intentionally replace the complete saved configuration.
A port/address-only edit preserves a legacy body's behavior. Explicit
length/mode editing converts it to the generated response format. Saving never
starts or restarts the service; apply using `start http` or `restart http`.

The CLI resolves the protocol's existing workspace ID. Custom legacy IDs remain
usable. It never creates, copies or deletes protocol configurations. A read-only
configuration diagnostic remains read-only through the API.

## Machine contract

API commands write one JSON object to stdout. `--json` is accepted explicitly but
is already the default. Errors are also JSON on stdout, with nonzero process exit
codes. Help/version and legacy local administration retain their existing output formats.

```json
{"schema_version":1,"ok":true,"command":"config.get","context":{"protocol":"http","instance_id":"http-demo"},"data":{"bind_ip":"0.0.0.0","port":18091,"response_length":512,"response_mode":"fixed"}}
```

| Exit code | Meaning |
| --- | --- |
| 0 | Query/save succeeded, awaited operation/test succeeded, or async request was accepted |
| 1 | The matching lifecycle operation or client test failed, including cleanup failure |
| 2 | Invalid command, options, endpoint or configuration input |
| 3 | Transport failure or invalid/incompatible API reply |
| 4 | API rejected the request, protocol/workspace unavailable, or no result to await |
| 5 | Total CLI deadline exceeded |
| 6 | Interrupted, manager restarted, workspace changed or result replaced |

Lifecycle operations and `tests run` wait by default. `--no-wait` returns an
explicit `accepted: true` object with operation/test ID and session, not a success
assertion about the protocol. `--wait` can be given explicitly. Do not combine the
two flags. Queries such as `show` and `tests result` return available state with
exit 0, even when that state describes an error; use the waiting command when the
exit code must express execution success.

`--timeout N` sets the whole command deadline (default 120 seconds, range
1..3600), covering lookup, request, polling and input. Individual JSON API requests
are bounded to 10 seconds. `logs --follow` emits JSON Lines and uses the total
deadline; Ctrl-C returns code 6. Streams ending unexpectedly return code 3.
Timeout or Ctrl-C does not cancel already accepted manager work. The error
`context` retains any received operation/test ID, so inspect state before retrying.
The CLI never silently retries a mutation. An interrupted/replaced result returns
code 6 instead of claiming that another operation passed. A restart that first
loses the HTTP connection can produce transport code 3 before the new session is
observed; neither outcome claims success. Test results are kept
only in bounded memory by the manager and are lost when it restarts.

Manager 0.5.0 adds session/operation correlation needed for reliable waits. Waiting
mutations reject an older incompatible manager before submitting work. Read-only
queries may also work with older versions.

## Automation example

Use a workspace assigned to this automation; Web edits and CLI edits share it.

```sh
export PLAB_URL=http://192.0.2.20:18000
plabctl protocols
plabctl schema http
plabctl config get http > saved-query.json
# To save a configuration from a previous query, extract its data field.
jq '.data' saved-query.json | plabctl config set http --file -
plabctl start http || exit $?
for path in /ok /chunked /close; do
    plabctl tests run http --method ALL --path "$path" > "result-${path#/}.json" || exit $?
done
plabctl logs http > logs.json
plabctl stop http
```

`jq` is an optional caller tool; neither the CLI nor the installed manager needs
it. A CLI binary run from another node needs the usual included native library
baseline and license sidecars. The example address is reserved for documentation.

For asynchronous execution:

```sh
plabctl tests run http --method POST --path /chunked --no-wait > accepted.json
test_id=$(jq -r '.data.test.test_id' accepted.json)
plabctl tests result http --id "$test_id" --wait > result.json
```

## Existing local administration

These retain their previous behavior and can require local root privileges:

```sh
sudo plabctl start                 # Start the manager through systemd
sudo plabctl stop-all              # Stop manager first, then its owned resources
sudo plabctl status                # Persisted configuration and Docker diagnostics
sudo plabctl doctor
sudo plabctl assets import ./dist/http-assets
```

`plabctl start http` is an API request to start HTTP. Bare `plabctl start` is a
local administrative request to start the management service. Workspace/API
commands do not read privileged local configuration or use systemctl. Invoking
`plabctl` without arguments prints help; the manager's own default invocation
continues to serve the Web application. Local commands accept only their exact
listed argument forms; extra or unknown arguments are rejected before any local
service/Docker operation. A help-looking value after an option is treated as
that option's value, not as a successful help request.

## DNS automation (manager 0.6.0)

Use `dns` with the same `schema`, `show`, `config get/set`, lifecycle, logs,
connection-info and tests commands. `--file`, stdin and `--data` accept the full
DNS configuration. Field edits use atomic PATCH; shared binding flags remain
`--bind-ip` and `--port`. DNS-specific fields are `--udp-enabled true|false`,
`--tcp-enabled true|false`, and `--records-json '[...]'` (replaces the record list).
HTTP response fields are rejected for DNS and DNS fields are rejected for HTTP.

```sh
plabctl config set dns --port 15354 --udp-enabled true --tcp-enabled true
plabctl config set dns --records-json '[{"name":"device.test","record_type":"A","value":"192.0.2.28","ttl":60},{"name":"device.test","record_type":"AAAA","value":"2001:db8::28","ttl":60}]'
plabctl start dns
plabctl tests list dns
plabctl tests run dns --method UDP --name device.test
plabctl tests run dns --method TCP --name device.test
plabctl tests run dns --method ALL
plabctl connection-info dns
plabctl logs dns
plabctl stop dns
```

DNS tests default to enabled transports and all configured names. `--method` is
`UDP`, `TCP`, or `ALL`; disabled transports are rejected. `--name` (alias for
`--path`) selects a configured name or `ALL`, never an arbitrary resolver/target.
`--name` and `--path` are mutually exclusive. Tests use the applied snapshot,
including when the saved draft differs. Response summaries contain wire DNS
RCODE, question, addresses, TTL and framing rather than HTTP status codes.

DNS validation permits 1..32 A/AAAA records and at most 16 addresses per name/type
RRset. Names use ASCII hostname labels (1..63 bytes, total <=253), are matched
case-insensitively and may have one trailing dot. Each RRset needs a consistent
TTL (0..86400); duplicate canonical name/type/address entries are rejected.
At least one transport must remain enabled. The DNS report limit is 512 KiB;
client and manager deadlines remain 30 and 45 seconds.

## MQTT automation (manager 0.7.0)

Use `mqtt` with the shared schema/show/config/lifecycle/logs/connection-info/tests
commands. Complete file/stdin/data JSON uses bind_ip, port, max_connections and
max_packet_size. Atomic field options are `--bind-ip`, `--port`,
`--max-connections`, and `--max-packet-size`; fields from other protocols are
rejected. Saving does not restart the broker.

```sh
plabctl schema mqtt
plabctl config set mqtt --port 18884 --max-connections 2 --max-packet-size 128
plabctl start mqtt
plabctl tests run mqtt --method ALL
plabctl tests run mqtt --method MQTT311_QOS2
plabctl tests run mqtt --method MQTT5_QOS2
plabctl logs mqtt
plabctl stop mqtt
```

The six cases are MQTT311_QOS0/1/2 and MQTT5_QOS0/1/2 (expand each suffix to one
case), plus ALL. The path defaults to `plab/test`, a fixed prefix expanded to
unique per-test topics. Both versions and all three QoS values verify real
subscriber delivery; results retain a bounded packet trace. The client report
limit is 512 KiB and the existing JSON/exit-code/session/timeout contract applies.
A saved max_connections=1 is legal, but independent publisher/subscriber testing
requires at least2 applied connections and otherwise returns a clear diagnostic.

## Telnet automation (manager 0.8.0)

Use `telnet` with the shared workspace commands. Complete configuration JSON
contains bind_ip, port, banner, max_connections and max_line_bytes. Atomic field
options are `--bind-ip`, `--port`, `--banner`, `--max-connections` and
`--max-line-bytes`. Banner is1..256 UTF-8 bytes without ASCII controls; input
lines are64..65536 decoded application bytes excluding the final CRLF. Other
protocol fields are rejected. Saving does not apply changes automatically.

```sh
plabctl config set telnet --port 23230 --banner 'Lab terminal' --max-line-bytes 64
plabctl start telnet
plabctl tests run telnet --method ALL
plabctl tests run telnet --method ECHO
plabctl tests run telnet --method OPTIONS
plabctl connection-info telnet
plabctl logs telnet
plabctl stop telnet
```

Cases are CONNECT, ECHO, OPTIONS, UNKNOWN_OPTION and ALL, using the fixed
`session` path. Each selected case runs twice with bounded packet traces and
checks actual responses or native session metadata. This is a finite experiment
application (ECHO/INFO/CLOSE), not a remote operating-system shell. CLI JSON,
exit codes, operation/session correlation and disposable-client cleanup follow
the existing contract. The report cap is512 KiB.


## IEC104 automation (manager 0.9.0)

Use `iec104` with the shared schema/show/config/lifecycle/logs/connection-info
and tests commands. Complete file/stdin/data JSON has bind_ip, port,
max_connections and the fixed points object. Atomic options are `--bind-ip`,
`--port`, `--max-connections` and `--points-json` (replaces the entire three-role
point table). Other protocol fields are rejected. Saving preserves the applied
service until an explicit start/restart.

```sh
plabctl schema iec104
plabctl config set iec104 --port 24040 --max-connections 1
plabctl config set iec104 --points-json '{"single":{"ca":1,"ioa":1,"value":false},"measured":{"ca":1,"ioa":100,"value":12.5},"command":{"ca":2,"ioa":1}}'
plabctl start iec104
plabctl tests run iec104 --method ALL
plabctl tests run iec104 --method GI
plabctl tests run iec104 --method COMMAND
plabctl logs iec104
plabctl stop iec104
```

CA is1..65534, IOA is1..16777215 and all three (CA,IOA) pairs must be unique;
max_connections is1..64. The single initial value is a strict boolean and
measured initial value is finite and in float32 range (wire value is rounded
to float32). The command has no configurable value and always targets the
configured single point in simulated memory, including across stations.
Configuration snapshots describe startup settings and do not show live values.

Cases are CONNECT, GI, READ, COMMAND and ALL, each selected case run twice with
fixed `station` path. CONNECT includes STARTDT/TESTFR/STOPDT. GI checks every
configured CA, actual monitoring values and ACT_TERM; a command-only station
has no monitoring objects. READ checks actual values. COMMAND reads the current
single value, changes it, confirms COT7 and READ/GI effects, then restores the
previous value. Restoration failure makes the test fail. These are simulated
point changes, not physical execution. Direct commands do not require an
invented ACT_TERM. CLI JSON/exit/session/cleanup contracts remain unchanged;
reports are bounded to512KiB.

IEC104 image0.1.1 uses a source-rebuilt c1042.2.1 with a documented native TCP
framing correction. Startup/adoption require the incremental-v1 capability;
original image0.1.0 is a retained failing fixture and is not deployed.


## MQTT-SN automation (manager0.10.0)

Use `mqtt-sn` with the shared configuration/lifecycle/logs/connection-info/test
commands. Atomic options are `--port`, `--discovery-group`, `--discovery-port`,
`--gateway-id`, `--broker-port` and `--predefined-topics-json` (replaces the list).
Full JSON also contains bind_ip0.0.0.0 and broker_host127.0.0.1; those fixed
addresses express native wildcard listening and private loopback isolation.
`--bind-ip`/`--broker-host` cannot select different addresses.

```sh
plabctl schema mqtt-sn
plabctl config set mqtt-sn --port 18998 --discovery-port 18999 --broker-port 28997
plabctl config set mqtt-sn --predefined-topics-json '[{"topic_id":1,"topic":"lab/predefined"}]'
plabctl start mqtt-sn
plabctl tests run mqtt-sn --method REGISTER_PUBLISH
plabctl tests run mqtt-sn --method PREDEFINED_PUBLISH
plabctl tests run mqtt-sn --method DISCOVERY
plabctl tests run mqtt-sn --method ALL
plabctl logs mqtt-sn
plabctl stop mqtt-sn
```

The two UDP ports must differ; TCP broker port is a separate transport. Gateway
ID is1..255, discovery group is IPv4 multicast, and all ports are1..65535.
The list has1..16 entries with unique topic IDs1..65534 and unique names. Names
are1..128 visible ASCII bytes without whitespace, comma,+ or # and cannot
begin with$. This restricted configuration avoids private-broker reserved
namespaces; it does not redefine MQTT topic validity. The plab/test
name and its descendants are reserved for verification.

Cases CONNECT, REGISTER_PUBLISH, PREDEFINED_PUBLISH, DISCOVERY and ALL use fixed
`plab/test` path and two rounds. Both publication cases validate QoS1 receipt
at an independent MQTT subscriber; PUBACK alone is insufficient. Predefined
tests cover every configured mapping. DISCOVERY receives actual multicast
GWINFO with matching gateway ID and source; it does not allocate an SN client.
Tests reuse the two reserved identities plab-sn-normal/plab-sn-predef with
clean sessions, new UDP source ports and fresh normal-topic registration.
Users must choose distinct IDs, including avoiding short prefixes of these
reserved names. Native client-table capacity is not a maximum-concurrent-count
setting; arbitrary new identities can consume retained native entries.

Tests execute on the manager host to observe the loopback-only private broker.
A remote CLI controls that same host-side run and does not itself prove LAN
reachability. Cross-node acceptance uses an external SN publisher and independent observation
of the target loopback broker over a task-scoped private control channel; the
broker is not opened to the LAN. The JSON/exit/session/cleanup contract remains shared, with a512KiB report
cap, three-second sockets and30-second total test deadline.

MQTT-SN image0.1.1 includes a documented project registration-capacity guard.
Startup/adoption require bounded-v1; the original0.1.0 candidate is retained as
a failing fixture and is not deployed as the workspace runtime.

Discovery selects the target-facing membership interface for remote targets;
local targets use the native multicast route. Up to six idempotent SEARCHGW
queries share one absolute three-second budget. Retries do not relax gateway
identity/source/destination checks or change host routing.

## RTP automation (manager 0.11.0)

```sh
plabctl config set rtp --bind-ip 0.0.0.0 --port 15004 --max-packet-size 2048
plabctl start rtp
plabctl tests list rtp
plabctl tests run rtp --method ALL
plabctl connection-info rtp
plabctl logs rtp
plabctl stop rtp
```

RTP uses the same schema/config/lifecycle/query commands. Full JSON has
`bind_ip`, `port` (1..65535) and `max_packet_size` (64..65507); field edits are
atomic and preserve other values. Packet capacity counts the entire UDP payload,
not a minimum RTP packet size. Methods are `BASIC`, `CSRC_EXTENSION`, `PADDING`,
`SEQUENCE` and `ALL`, with fixed path `stream` and two rounds per case.

The target receives RTPv2 without sending an RTP response. Test success requires
fresh actual receiver observations correlated by boot ID, counter, raw/payload
hashes and header fields. The observer is a private, read-only control interface;
its address is derived from the exact owned container and cannot be overridden
through Web/API/CLI configuration. The client sends RTP to the published host
UDP endpoint. Opaque payload validation does not imply media decoding/playback,
RTCP feedback, measured network loss or jitter. Same-host tests do not establish
separate-node reachability.

## RTCP automation (manager 0.12.0)

```sh
plabctl config set rtcp --port 15005 --max-packet-size 2048
plabctl start rtcp
plabctl tests run rtcp --method ALL
plabctl connection-info rtcp
plabctl logs rtcp
plabctl stop rtcp
```

Full JSON requires `bind_ip`, `port`, `max_packet_size` and the literal
`packet_profile:"sr-sdes"`. Partial flags preserve that profile. Capacity is
64..65507 complete UDP bytes; RTCP alignment limits a legal compound to 65504
but does not require capacity settings to be aligned. The fixed path is `session`;
cases are `SR_SDES`, `REPORT_BLOCKS`, `SDES_ITEMS`, `PADDING` and `ALL`, twice each.

The receiver accepts its supported SR+SDES CNAME profile without replying or
requiring RTP to run. Native sender counters are declared values, not measured
receiver statistics. NTP64 is reported as an exact hexadecimal string plus two
uint32 words. Fresh private receive observations, not send/HTTP status, prove
success; users cannot override the derived observer through configuration.

## DL/T645 automation (manager 0.13.0)

```sh
plabctl config set dlt645 --port 20646 --meter-address 000000000001
plabctl start dlt645
plabctl tests run dlt645 --method ALL
plabctl connection-info dlt645
plabctl logs dlt645
plabctl stop dlt645
```

Full JSON requires all fields shown by `schema dlt645`, including literal
`wire_profile:"dlt645-2007-tcp"` and `security:{"mode":"reject"}`. Field flags
include `--energy-hundredths`, `--period-minutes`, `--max-connections`,
`--programming-key-enabled` and `--security-json` (replaces the complete tagged
security object). Hexadecimal fixture strings retain their original case in
saved/applied snapshots and fingerprints; validation accepts either case.

Tests use path `meter`. ALL runs only READ_ADDRESS, READ_DATA, STREAM and
ERROR_RESPONSE twice each. WRITE_PERIOD is separately available with the
applied simulated programming key; it temporarily writes and verifies restoration
of the period read at test start. SECURITY_FIXTURE is separately available in
fixture mode; it verifies fixed bytes with `crypto_verified=false`.

Read-only clients discover the current address and validate current values;
startup configuration does not overwrite legitimate in-memory wire mutations.
The TCP software profile supports the documented limited command set; serial
hardware, actual energy/relay behavior, 1997 mode and ESAM are not implied.
