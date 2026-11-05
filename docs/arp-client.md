# Active ARP / RARP / InARP target

This workspace runs a persistent active Ethernet/IPv4 requester. The disposable
same-image test tool is its inverse responder. It is not a passive ARP server,
a generic L2 carrier or an OS address configurator. There is no on-wire query ID
or response acknowledgement. A mapping is a checked received response for one
current local pending attempt; late identical responses remain ambiguous.

## Required configuration

```json
{
  "wire_profile": "ethernet-ipv4-active-arp",
  "link": {"mode": "docker-bridge"},
  "source_mac": "02:00:00:00:01:10",
  "source_ip": "198.18.1.10",
  "server_mac": "02:00:00:00:01:20",
  "server_ip": "198.18.1.20",
  "assigned_ip": "198.18.1.10",
  "mode": "whois",
  "request_scenario": {"mode": "normal"},
  "interval_ms": 500,
  "timeout_ms": 1000,
  "retries": 0
}
```

All12 fields are required. Unknown/null/wrong types are rejected. MACs are
nonzero unicast, distinct and normalized lowercase; source/server IPs differ.
IPv4 roles exclude0/8, multicast and all-ones broadcast. assigned_ip may equal
source_ip. Timers are integers10..60000ms; retries0..10. The tagged link and
request_scenario objects are complete replacements when changed.

The default link is a manager-owned internal Docker bridge. Source and temporary
peer each use their own real eth0/veth MAC assigned by Docker. Both run with only
NET_RAW after dropping all capabilities. The bridge contains the owned source
and temporary test peer; foreign endpoints block removal. Restart adoption uses
actual immutable network/CID identity. Stop removes only checked empty owned
networks. No permanent fake responder is started. This is software Ethernet
exchange; it does not imply physical LAN reachability.

The alternative link is `{"mode":"host-interface","interface":"eth0"}`.
The interface must already exist, be Ethernet and have exactly source_mac.
The worker does not change addresses, MACs, promiscuous mode, routes, neighbor
entries or sysctls. The builtin peer needs exactly one different existing local
interface whose real MAC equals server_mac; absent/ambiguous peers are unavailable.
An external peer explicitly supplies its own local --interface name. A second
raw socket on the target's same interface sees PACKET_OUTGOING and cannot be
presented as an incoming peer. Application IP roles do not assign OS addresses;
a RARP mapping never configures an interface or host neighbor table.

## Wire behavior

Ethernet II plus Ethernet/IPv4 ARP uses htype1, ptype0800, hlen6, plen4. Supported
mode request/response pairs are WHOIS and response-fuzz0806/op1→op2,
RARP8035/op3→op4 and InARP0806/op8→op9. response-fuzz sends a genuine normal
WHOIS request to exercise the responding peer; it is not a hidden mutation engine.
Replies must match complete current EtherType/opcode, Ethernet roles, SHA/SPA and
THA/TPA. RARP maps sourceMAC to assignedIP; InARP maps known serverMAC to serverIP.

| Target request scenario | Applicable modes | Mapping expectation |
|---|---|---|
| normal | All4 | Positive |
| wrong-target-ip | whois, response-fuzz | Negative |
| wrong-target-mac | inarp | Negative |
| unknown-tha | rarp | Negative |
| short-arp | All4 | Negative |
| nonzero-rarp-proto | rarp | Positive; request SPA/TPA undefined values |
| nonzero-whois-tha | whois, response-fuzz | Positive; THA does not select queried IP |

There are15 legal combinations. Normal requests submit60 bytes excluding FCS;
short-arp submits37. Physical drivers may pad a short submission: reports retain
both source-submitted and peer-observed hashes/lengths and explicitly identify
an exact37-byte prefix plus23 zero bytes. Submission length is not proof of a
physical runt frame. VLAN, other address widths, Frame Relay and IP payload
forwarding are outside this finite profile.

Only one request attempt is pending. Every actual send, including a retry, gets
a new local query_id/attempt_id and fixed absolute deadline. Bad traffic cannot
reset it. Timeout always increments timeouts; negative_silent increments only
for a negative attempt with zero attributable unexpected responses. Successful
mapping cancels the retry group. Retry groups repeat persistently; manual duration,
packet/query count and logfile limits do not terminate the managed service.

Observer TCP neighbor ARP must not contaminate experiment response counts.
Candidates require real incoming peer Ethernet identity, supported address
layout, response opcode2/4/9 and at least one complete current role IP: SPAserverIP
or TPAsourceIP for ARP/InARP; SPAserverIP or TPAassignedIP for RARP. Requests1/3/8
and unrelated private-IP control replies are ignored_control. Short replies need
complete SPA at32 bytes before association; invalid widths/missing SPA cannot be
guessed. Full validation still rejects wrong roles/mode and all negative attempts.

## Test tool and read-only observation

The manager supplies exact source identity and the actual peer interface:

```sh
python3 -u /opt/protocol-target-lab/client.py \
  --config-json "$APPLIED_JSON" --interface eth0 --method ALL --path peer \
  --observer-host "$SOURCE_BRIDGE_IP" --observer-port 18086 \
  --expected-runtime-id "$RUNTIME_ID" --expected-boot-id "$BOOT_ID"
```

OBSERVE_REQUEST, MAPPING, REJECT_REPLY and TIMEOUT each run twice. ALL is8 checks
for the current applied mode/scenario, not an automatic configuration sweep.
MAPPING injects a complete canonical normal Reply even for negative requests:
it must be received and rejected, never resolve, then timeout without negative_silent.
REJECT_REPLY changes one address while retaining the other attributable role;
positive cases then send a valid response. TIMEOUT withholds replies and checks
the actual source deadline event. A genuine external/kernel reply makes expected
silence fail honestly. Legal response padding carries a fresh nonce; its full
hash joins actual source reception to local query evidence without inventing a
protocol transaction field or ACK.

The source exposes GET /v1/status and GET /v1/events on private TCP18086. Bridge
mode has no published observer port; host mode binds loopback. Status reports
actual interface/MAC, boot/runtime/config, kernel-filter readback/inode, main-loop
freshness, pending attempt and counters. last_mapping is the latest actual mapping
in this boot, historical evidence rather than current connectivity. A running
requester without a peer remains running while timing out. Health never creates
a fake peer or requires a mapping. Events are bounded256/16 per query,64KiB reply,
128-byte previews,8 pre-thread slots and1s absolute HTTP deadline.

Tests use dynamic per-case bounds up to4s, overall30s including cleanup and a45s
manager orchestration cap. The budget is computed before creating the peer. Each case creates a fresh source
baseline and confirms a live pending attempt immediately after actual capture;
all later proof must refer to that same local query, never an older timeout.
Baseline/capture observer calls consume the same fixed1s case control allowance
as final proof, inside the existing case/global absolute deadlines.
Defaults500/1000ms allow positive ALL26.2s and negative ALL30s worst-case budget.
Runtime-valid short/long timers can be unavailable for testing: timeout<250ms,
any selected phase>4s or total>30s are rejected without changing the source.
Single-case selection computes only that case's two rounds. Physical peers,
control ARP and role/OS-IP collisions are not filtered away to manufacture a pass.

## Offline build and materials

```sh
scripts/arp-client-fetch-deps.sh       # Explicit online base preparation
OFFLINE=1 scripts/arp-client-images.sh
OFFLINE=1 scripts/arp-client-assets.sh # dist/arp-client-assets
```

The image uses the digest-locked public Python base and autonomous MIT standard
library code. Assets include runtime, source/build recipes, notice/license and
hash manifest. Rebuild needs that prepared pinned base; this is not a complete
OS/kernel source bundle. Kernel/raw oracle tools are independent validation
infrastructure and are not runtime dependencies. See [acceptance scope](arp-client-acceptance.md)
for measured layers and limits.
