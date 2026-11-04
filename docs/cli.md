# Agent CLI

`plabctl` is installed by the same deb as the manager. It is a lightweight entry
point to the same native binary, using the management HTTP API for workspace
commands. It does not edit the server's files or invoke local Docker for these
commands. The Web UI is for interactive use; the CLI exposes the same implemented
HTTP, DNS and MQTT workspaces to automation. Both control the same saved settings and resources.

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
