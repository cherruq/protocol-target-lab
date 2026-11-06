# Public DNS scenario fixtures

The four JSON files are byte-for-byte copies of synthetic protocol material in
`anban@192.168.10.102:~/yz4-protocol-lab/dns/`, collected on 2026-11-06.
`catalog.json` records each original file's SHA-256 and maps every scenario to a
stable public ID. It is checked when the worker/client starts.

The `final` set contains 35 UDP and 20 stream scenarios. TCP and TLS share the
same stream bytes, including their explicit two-byte prefixes, delayed writes,
truncation, multiple messages, held-open connections, DSO and NOTIFY/UPDATE
fixtures. Fragmented writes are not a claim about TCP packet boundaries.

The `short` and `wrong-id` sets each contain one additional UDP fixture. Their
requests are identical and their replies differ, so configuration selects one
set at a time. When active in `legacy-fixtures`, these sets require UDP only;
they are not silently converted to new TCP/TLS behavior. Switching to `standard`
preserves the selected fixture set as an inactive setting and permits all
standard transports. Across all sets there are 57 separately selectable IDs.

`legacy-fixtures` is an exact request/reply laboratory mode. It does not perform
real zone updates, subscriptions or recursive resolution. Unknown requests have
no default success response. The `standard` profile continues to use real
dnsmasq for configured A/AAAA answers, with TLS forwarding to that same process.

The disposable client compares actual received bytes/datagrams and connection
close/hold behavior; malformed replies can be a successful fixture-delivery
test. This is distinct from accepting those replies as valid DNS. Silent
fixtures require real positive controls on the same socket before and after the
silent window. All selected fixtures run twice, without changing the target's
configuration. Ordinary tests have a 30-second deadline; internal health probes
have a separate two-second deadline.
