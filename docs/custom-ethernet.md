# Fixed-response Ethernet workbench

This software target passively receives Ethernet II frames on one actual interface,
using a real Linux classic BPF socket filter compiled by libpcap 1.10.5. Each
admitted incoming frame with the configured optional payload prefix causes one
fixed response. Ethernet has no application ACK. The source runs continuously
until stopped; it has no duration or request-count expiry.

The default link is an owned, internal Docker bridge with a separate source and
one-time inverse peer. `host-interface` uses an existing Ethernet interface and
its actual MAC. These are separate delivery layers: software veth exchange does
not establish physical VLAN, FCS, runt-frame or arbitrary LAN forwarding support.
No general Ethernet carrier, OS bridge, VLAN device or interface helper is added.

The manager owns the source and exact network identity. The source and inverse
peer run as UID 0 with all capabilities dropped except `NET_RAW`, without Docker
socket mounts, `NET_ADMIN`, host PID/IPC, OS address changes or route/neighbour
changes. Optional multicast/promiscuous memberships belong to the source socket
and are released when it closes.

## Configuration

All ten fields are required. The API schema exposes the complete default. This
shortened illustration omits the long default response and request hex strings:

```json
{
  "wire_profile": "ethernet-fixed-response",
  "link": {"mode": "docker-bridge"},
  "local_mac": "02:00:00:00:02:20",
  "peer_mac": "02:00:00:00:02:10",
  "packet_filter": "ether proto 0x88b5 and ether src 02:00:00:00:02:10",
  "request_marker_hex": "504c41422d52455155455354",
  "response": {
    "mode": "payload",
    "payload": {
      "destination_mac": "02:00:00:00:02:10",
      "source_mac": {"mode": "interface", "value": "02:00:00:00:02:20"},
      "ether_type": 34997,
      "payload_hex": "504c41422d524553504f4e5345",
      "vlan": {"enabled": false, "vid": 7, "pcp": 0, "dei": false}
    },
    "frame_hex": "02000000021002000000022088b5504c41422d524553504f4e5345"
  },
  "promiscuous": false,
  "multicast_macs": [],
  "test_request": {"frame_hex": "02000000022002000000021088b5504c41422d52455155455354"}
}
```

Both response banks are saved and hashed, including the inactive bank, disabled
VLAN values and saved source override. Selecting `payload` constructs destination,
source, optional single 0x8100 tag, EtherType and payload; selecting `frame` submits
the exact raw frame. Source mode `interface` uses `local_mac`, whose actual NIC
identity is checked at runtime. `override` changes transmitted Ethernet bytes;
it does not change the NIC MAC. Raw frame source bytes are similarly independent.

MACs and hex are canonical lowercase. Hex has no `0x`, separators or whitespace.
Local and peer MACs must be different nonzero unicast addresses. The optional
marker is `null` or 1–64 bytes and matches the exact payload prefix after the
ordinary or single 802.1Q header. It is independent of the BPF expression.

Payload EtherType is 1536–65535 excluding 0x8100/0x88a8/0x9100; explicit VLAN
uses VID 0–4094, PCP 0–7 and DEI. Payload is 0–65521 bytes, with the complete
constructed stored bank at most 65535 bytes (tagged payload at most 65517).
Raw bank and test fixture are complete 14–65535-byte frames. Static checks cover
both banks; actual MTU checks apply to the selected response and peer request.
No application padding or truncation silently repairs the configuration.

The test request is an opaque fixture. Changing a filter, source override, marker
or response does not rewrite it. An arbitrary filter may intentionally reject it;
the built-in test then fails honestly. Some raw response destinations also cannot
arrive on the configured peer. The tool does not enable peer promiscuous mode to
manufacture success. A multicast response joins its exact destination on the peer.

`packet_filter` preserves exact nonblank UTF-8, rejects NUL and exceeds neither
2048 bytes nor 512 compiled instructions. Compilation uses a live EN10MB context
on the selected interface, snaplen 262144, optimization and unknown netmask. The
program is installed with `SO_ATTACH_FILTER` and read back with `SO_GET_FILTER`;
there is no userspace predicate fallback or invented kernel-drop counter.
Accepted positive returns must be the full capture snaplen, preventing BPF from
turning an oversized frame into a seemingly valid clipped prefix.

## Runtime and compiler entry points

The image is `protocol-target-lab/custom-ethernet:0.1.0`. Its default entry point is
`python3 -u /opt/protocol-target-lab/server.py`. It requires:

```text
--config-json JSON --expected-filter-sha256 HEX
PLAB_RUNTIME_ID=32-lowercase-hex-characters
```

`compile.py --config-json JSON --interface IFACE` opens the real live compiler
context and a temporary filtered socket, checks selected frame/MTU and returns a
single JSON result. It does not send custom frames. Its interface can have a
separate probe MAC; payload source construction still uses configured `local_mac`.
`--verify-memberships` is allowed only for a private bridge probe. A host probe
always remains nonpromiscuous and adds no multicast membership while an old
source is alive. Requested host memberships are applied by the final source;
failure is surfaced without fallback. The manager bounds the whole owned probe
and cleanup to ten seconds with 128 MiB and 32 processes.

All three Python entry points also accept repeated `--config-json-part TEXT`
instead of `--config-json`. Ordered nonempty UTF-8 parts are each at most 60000
bytes (at most 16 parts); concatenation preserves the configuration and hash.
This avoids Linux's single-argument size limit for maximum banks. The two forms
are mutually exclusive. Use CLI configuration files for large user input.

Compiler success contains `schema_version`, `protocol`, `passed`,
`config_sha256`, `interface`, `active_frame`, `filter`, `library` and
`capture_snaplen`. Failure returns JSON and exit 1. Source startup recompiles and
requires its program SHA to match the immutable manager-provided expected SHA.

## Private observer

TCP 18087 is unpublished on the private bridge; host mode binds only loopback.
It provides bounded, read-only `GET /v1/status` and
`GET /v1/events?after_event_id=N&limit=1..16[&request_sha256=HEX]`.
Requests have an absolute one-second deadline, an 8 KiB header limit and a 64 KiB
response limit. Eight slots are acquired before spawning handlers. There are 256
retained events; pagination reports `matched`, `returned`, `truncated`,
`next_event_id` and `cache_evictions`. HTTP activity does not advance the source
main-loop heartbeat.

Status includes these exact fields:

- `schema_version`, `protocol`, `boot_id`, `runtime_id`, `config_sha256`,
  `worker_ready_after_bind`, `uptime_ms`, `event_loop_age_ms`.
- `interface: {name, ifindex, mac, mtu}`, `response_mode`, `link_mode`.
- `filter: {instructions, sha256, installed, readback_instructions,
  packet_socket_inode}`; each instruction is `[code,jt,jf,k]`.
- `library: {version, sha256}`, `capture_snaplen: 262144`,
  `recv_budget: 262144`, `max_accepted_original_and_normalized_rx: 65535`.
- `counters: {received, outgoing_ignored, rejected, accepted, tx_actual,
  log_dropped}`, `next_request_id`, `next_event_id`, `cache_evictions`.
- `last_received` is null or a bounded frame summary plus `request_id`,
  `normalized` summary and `decoded` Ethernet fields; `last_sent` is null or
  the submitted response summary with `request_id`.

Frame summaries contain `wire_length`, `raw_sha256`, `preview_hex` (at most 128
bytes) and `truncated`. Decoded fields are `destination_mac`, `source_mac`,
`ether_type`, `vlan`, `payload_offset`, `payload_length`. VLAN metadata records
VID/PCP/DEI and whether the TPID was actually supplied by AUXDATA. If VLAN_VALID
is set without TPID_VALID, Linux's conventional 0x8100 default is used and marked
as inferred. A zero TCI is valid. A restored tag is never recursively stripped.
Nested VLAN and outer 0x88a8/0x9100 RX are rejected. Original and reconstructed
frames over 65535 bytes, truncated capture/control data and unsupported headers
cannot trigger a response. Raw TX remains opaque and independent of RX policy.

`rx_accepted` and `tx_actual` share a fresh `request_id` and `request_sha256`;
`rx_rejected` includes the reason. Events and stdout logs have bounded previews,
with a 256-entry log queue and visible dropped-log count. Full config/large frame
banks are not returned by status. Filter SHA is SHA256 of the compact JSON
instruction array (without sorted row transformation); config SHA uses canonical
sorted JSON including both banks. Library SHA covers the loaded libpcap file.

## One-time inverse peer

Invoke the same image using `python3 -u /opt/protocol-target-lab/client.py`:

```text
--observer-host PRIVATE_SOURCE_IP --observer-port 18087
--interface LOCAL_PEER_INTERFACE
--expected-boot-id UUID --expected-runtime-id HEX
--method ROUNDTRIP|REPEAT|ALL --path frame --config-json JSON
```

The interface name belongs to the peer's host, not the source. Its actual MAC
must equal `peer_mac`. Default bridge tests use a separate real veth; a host test
needs a different actual peer interface, or the same image on an external host.
The observer can be reached through an SSH control tunnel for external tests;
Ethernet data must still traverse the real interfaces.

Each selected case runs twice. ROUNDTRIP sends once per group; REPEAT sends three
sequential requests per group. ALL therefore has four groups and eight exchanges.
Each group has an absolute four-second budget, each response wait at most 750 ms,
a 50 ms duplicate quiet window, and one shared second of observer I/O. The entire
client including cleanup has 30 seconds. The report distinguishes groups from
`summary.actual_exchanges`, counting completed exchanges with evidence. Exit 0
means all selected groups passed; protocol/runtime failure returns JSON and exit 1.

Response capture validates actual truncation flags, byte bounds and AUXDATA, then
compares the complete opaque bytes. The source request parser's finite VLAN policy
is not imposed on configured raw responses: 0x88a8, 0x9100 and nested raw TX can
be verified without claiming the source accepts those request formats. Response
summaries use `decoded.opaque: true`, outer EtherType and actual AUXDATA metadata.
Unknown AUXDATA TPID uses only Linux's conventional 0x8100 default; it is never
invented from the configured expected response.

Each completed exchange requires actual peer incoming response bytes plus fresh
source admitted request and submitted response hashes after its cursor baseline,
with unchanged boot/runtime/config and socket/filter identity. Submitted bytes
are distinguished from observed bytes. Exact short-frame zero padding to Ethernet
minimum is reported explicitly; AUXDATA-restored tag padding is separately marked.
Fixed opaque frames have no transaction identifier. Late identical responses
remain inherently ambiguous; this controlled observation is not a unique wire
transaction ID, cryptographic proof, or an Ethernet ACK.

## Build and delivery

```sh
scripts/custom-ethernet-fetch-deps.sh
OFFLINE=1 scripts/custom-ethernet-images.sh
OFFLINE=1 scripts/custom-ethernet-assets.sh dist/custom-ethernet-assets
```

Online preparation downloads the official hash-locked libpcap 1.10.5 archive and
prepares the compiler cache from the pinned Python Bookworm base. Runtime image
construction uses `--network=none`; it builds the native library from source,
then copies only the library into the fixed runtime base. The image and exported
assets include the original complete archive, source copyright notices, wrapper,
recipes, lock and project license. Offline rebuilding needs the prepared matching
base/compiler cache. This is not a promise of byte-identical compiler output or
complete OS/toolchain source distribution. CPython and base OS license material
remain in the base. No private reference implementation is represented as MIT.

Worker and independent release evidence is recorded separately. Deployment,
physical-LAN acceptance and merge are pending until their actual reports exist.
