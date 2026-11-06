# HTTPS, DNS-over-TLS and fixed response scenarios

These are extensions of the existing HTTP and DNS workspaces. The Web page and
`plabctl` edit the same saved configuration; save does not apply it. Use Restart
and apply to replace a running source. Old configuration serialization, IDs,
applied snapshots and container adoption remain compatible.

## TLS fixture and connection

HTTP image `0.4.0` and DNS image `0.2.1` include an intentionally public laboratory
certificate and key generated for this project. The key is public test material;
no remote private key was copied. Download the certificate from the workspace's
certificate link or `GET /api/tls/lab.crt` and save it as `lab.crt`.
Built-in clients verify this trust anchor and the name `protocol-target-lab.test`.
Connecting to an IP does not disable certificate or hostname verification.

HTTP `tls_enabled: true` switches its configured TCP port to HTTPS. It does not
add a second HTTP workspace or configure TLS for the manager Web page. Example:

```sh
plabctl --url http://192.168.10.102:18000 config set http --tls-enabled true
plabctl --url http://192.168.10.102:18000 restart http
plabctl --url http://192.168.10.102:18000 tests run http --method ALL --path /ok
curl --noproxy '*' --cacert lab.crt --resolve protocol-target-lab.test:18091:192.168.10.102 https://protocol-target-lab.test:18091/ok
```

Substitute the actual applied HTTP port for 18091. DNS adds `tls_enabled` and
`tls_port` (default 1853). UDP/TCP retain the existing `port` and can be enabled
independently. At least one transport is required. Enabled TCP and TLS must use
different host ports. Only enabled endpoints are published. DNS TLS-only is valid.
The real dnsmasq 2.90 remains the standard DNS implementation; TLS forwards
length-prefixed DNS messages to that real process in the same container.

```sh
plabctl --url http://192.168.10.102:18000 config set dns --tls-enabled true --tls-port 1853
plabctl --url http://192.168.10.102:18000 restart dns
plabctl --url http://192.168.10.102:18000 tests run dns --method TLS --name ALL
```

## HTTP response paths

The existing `/ok`, `/chunked`, `/close` paths retain the configured generated
length and fixed/random mode, all seven methods, and legacy recovery behavior.
The following additional paths are fixed laboratory fixtures copied from the
explicit behaviors in the reference `http_peer.py`. Their response bytes are
independent of generated length/mode. The earlier HTTP lab/probe scripts cover
subsets or port aliases of these same paths.

| Paths | Behavior |
|---|---|
| `/head`, `/health` | HEAD without body; `/head` holds the connection for 5 seconds |
| `/chunk-extension`, `/split-length` | Chunk extensions/trailer or delayed split length response |
| `/flood` | 0.6-second delayed fixed response, connection close |
| `/no-content`, `/not-modified` | 204/304, no body, 5-second connection hold |
| `/informational`, `/informational-error`, `/only-informational` | 100 followed by 200/500, or 100 only |
| `/truncated`, `/chunk-truncated` | Deliberately truncated body/framing |
| `/invalid-status`, `/status-099`, `/invalid-chunk` | Deliberately invalid status/chunk bytes |
| `/conflicting-length`, `/negative-length` | Deliberately conflicting/negative length headers |
| `/not-found`, `/server-error` | Fixed 404/500 |
| `/stall` | 30-second delay followed by fixed normal response |
| `/auth/basic`, `/auth/cookie`, `/auth/header`, `/auth/query` | Fixed public experiment credentials; positive and negative checks |

Select HEAD for `/head` and `/health`, GET for other fixed paths. ALL selects the
appropriate fixture method and two rounds; on the three generated paths it still
runs all seven methods. HTTPS supports the same paths. Unknown paths remain 404.
A fixed malformed-response check passes only when actual bytes match its preset;
it does not mean the output was valid HTTP. Reports distinguish raw wire bytes,
parsed status, TLS evidence and expected behavior. Auth checks include accepted
and rejected requests.

The built-in `/stall` test checks a named 0.75-second early quiet window with
successful health controls before and after; it does not wait 30 seconds. HEAD,
204 and 304 checks compare complete headers and a named held-open window. Separate
real TLS verification measured the full 30-second stall and 5-second holds.

## DNS original fixture sets

`response_profile: standard` uses real dnsmasq and configured A/AAAA records.
`response_profile: legacy-fixtures` uses exact request/response fixture replay.
The original four JSON files and their SHA256 values are public under
`workers/dns/fixtures/`; `catalog.json` lists every selectable ID:

| fixture_set | Scope |
|---|---|
| `final` (default) | 35 UDP and 20 stream fixtures; stream fixtures work over TCP/TLS |
| `short` | Original short UDP fixture, UDP-only |
| `wrong-id` | Original wrong-ID UDP fixture, UDP-only |

The last two original files have identical request bytes and different responses,
so they are separate sets. They require UDP enabled and TCP/TLS disabled while
active. In standard mode a saved fixture-set selection is inactive and retained.

Fixtures include positive record encodings, negative rcodes, EDNS, wrong fields,
compression errors, short/oversized/trailing data, silence, delayed/split/truncated
stream frames, multi-response streams and fixed NOTIFY/UPDATE/DSO messages.
This is controlled byte replay, not a zone update, notification or DSO service.
Only a complete matching request selects a fixture; unknown requests do not
receive a default success. Transaction IDs in fixture requests are fixed.

```sh
plabctl --url http://192.168.10.102:18000 config set dns --response-profile legacy-fixtures --fixture-set final
plabctl --url http://192.168.10.102:18000 restart dns
plabctl --url http://192.168.10.102:18000 tests run dns --method ALL --path ALL
plabctl --url http://192.168.10.102:18000 tests run dns --method TLS --path stream/template-dso
```

ALL covers enabled transports only; with UDP, TCP and TLS enabled the final set
runs 150 checks (two rounds per fixture and transport). Individual catalog IDs
can be selected in Web or CLI. Tests check actual bytes, connection behavior and
bounded timing; silent stream cases use same-connection positive controls.
Normal JSON reports, exit codes, ownership, deadlines and disposable cleanup are
shared with the existing clients. Health checks have an internal 2-second deadline
before the manager's 3-second Docker exec deadline.

DNS client reports have a 768 KiB cap so all three enabled transports can verify
32 maximum-length AAAA names without discarding successful semantic results.
