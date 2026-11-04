# DNS workspace

DNS uses the real, unmodified dnsmasq 2.90 resolver engine with an original
Python configuration wrapper and independent standard-library DNS client.
This workspace implements a local static DNS target: configured A/AAAA answers,
NODATA for other types at known names, and NXDOMAIN for unknown names. It does
not forward queries to an upstream server. System hosts and default dnsmasq
configuration are explicitly excluded. DHCP, TFTP, authoritative-zone support,
and script hooks are excluded at compile time. The default target port is 15353; host resolver configuration is not changed.

A single protocol workspace controls one DNS service. Its configuration is:

```json
{"bind_ip":"0.0.0.0","port":15353,"udp_enabled":true,"tcp_enabled":true,"records":[{"name":"device.test","record_type":"A","value":"192.0.2.28","ttl":60}]}
```

The host binding accepts IPv4 unicast or wildcard addresses and ports 1–65535.
Enable UDP, TCP, or both. The container always listens on internal port 15353;
Docker publishes only the selected transports at the configured host address
and port. A disabled transport is not published. The service process is
non-root and remains in the foreground; Docker captures query/startup/shutdown
logs. It creates no persistent query-log file and has no expiry timer.

Configure 1–32 address records, with at most 16 addresses in each name/type
RRset. Names use ASCII letters, digits, and interior hyphens; labels contain
1–63 characters and the whole name at most 253 characters. A final dot is
accepted and removed; comparisons are case insensitive. A and AAAA require
IPv4 and IPv6 addresses respectively. Duplicate name/type/address entries are
rejected. Each RRset shares an integer TTL from 0 to 86400; A and AAAA RRsets
at the same name can have different TTLs. Names are exact; a configured record
does not create wildcard answers for its subdomains. dnsmasq may create PTR
answers for configured addresses; PTR configuration/testing is outside this
workspace's A/AAAA contract.

## Build and offline materials

```sh
# Online preparation: fixed Python base plus compiler image, no host install.
scripts/dns-fetch-deps.sh
# No network during this build; requires the prepared local image cache.
scripts/dns-images.sh
# Runtime image, manifest, complete upstream source, licenses and build recipes.
scripts/dns-assets.sh
```

The output image is `protocol-target-lab/dns:0.1.1`. Its base digest, pristine
source URL/SHA-256, and compiler flags are recorded in
`images/dns/dependencies.lock.json`. The compiler image uses the same Debian
bookworm base as runtime, avoiding a newer-libc build dependency. Online apt
packages can change; `dist/dns-build-packages.txt` records the prepared compiler
package versions and `dist/dns-build-image-inspect.json` records its image ID.
The runtime build performs no downloads. For a fresh offline build, transfer
the fixed base and prepared `protocol-target-lab/dns-build:2.90` Docker images
with `docker save`/`docker load` as well as the public source tree. The runtime
asset export supports offline service installation; it is not a compiler-cache
archive and does not claim complete nine-protocol offline delivery.

The runtime image and `dist/dns-assets/sources/` carry the full pristine
upstream source archive and both GPL texts, alongside the exact build recipes.
See `third-party/dnsmasq/README.md` for corresponding-source and redistribution
requirements. The wrapper/client use MIT; dnsmasq retains its upstream
GPL-2.0-or-GPL-3.0 license choice. Base-image software retains its own licenses.

## Read-only client

The same image contains `/opt/protocol-target-lab/client.py`. Use it through a
one-shot container, overriding the default server entrypoint:

```sh
docker run --rm --network=host --entrypoint python3 protocol-target-lab/dns:0.1.1 \
  -u /opt/protocol-target-lab/client.py --host 127.0.0.1 --port 15353 \
  --method ALL --path ALL \
  --config-json '{"bind_ip":"0.0.0.0","port":15353,"udp_enabled":true,"tcp_enabled":true,"records":[{"name":"device.test","record_type":"A","value":"192.0.2.28","ttl":60}]}'
```

`--method` accepts UDP, TCP, or ALL. ALL tests only enabled transports; an
explicit disabled transport fails without a network request. `--path` accepts
ALL or one configured name. The applied configuration supplies the expected
records; it cannot override the destination or inject arbitrary query names.
The client does not start a service or modify configuration.

For each selected transport it queries each selected RRset twice and verifies
transaction ID, question, response flags/rcode, every address and exact TTL.
It also tests a missing type at each known name and a fresh unknown name.
TCP requests/responses use and verify the two-byte length frame. UDP advertises
EDNS payload size 1232, so a valid 16-address RRset with a maximum-length name
fits without TCP fallback. A conventional non-EDNS client may receive a
standards-compliant truncated UDP response for large RRsets.

stdout contains one JSON result with `passed`, `checks`, `summary`, and elapsed
`seconds`; exit status is 0 for pass and 1 for failure. Every check records a
structured request, response, bounded 128-byte wire preview and error when
applicable. No packet dump grows with record payload size. The report has a
512 KiB cap; supplementary wire hex is omitted if necessary while all semantic
checks, original lengths and hashes are retained. Each socket has a three-second timeout, and the whole run a 30-second
deadline. The client reports unreachable targets, malformed packets, incorrect
records, and invalid configuration as JSON failures.


For a cross-node check from a prepared source checkout, save the applied DNS
configuration as JSON and run:

```sh
make smoke SCENARIO=dns-basic TARGET_ADDR=192.0.2.20 TARGET_PORT=15353 DNS_CONFIG_FILE=applied-dns.json
```

`DNS_TRANSPORT=UDP|TCP|ALL` and `DNS_NAME=ALL|configured.name` can narrow the
check. Built-in Web/CLI tests run on the management host; only a client run from
another machine establishes reachability from that machine.
