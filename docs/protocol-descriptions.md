# Shared protocol guidance (manager 0.23.0+)

`plabctl describe <protocol>` returns the same protocol explanations used by the
Web UI, together with the existing schema, saved/applied settings, connection
information and available client-test metadata. All seventeen registered protocols
are covered, including HTTP/HTTPS, DNS UDP/TCP/TLS and their migrated scenarios.
Protocol IDs are those returned by `plabctl protocols`, for example:

```sh
plabctl describe http
plabctl describe dns
plabctl --url http://192.168.10.102:18000 describe profinet
```

The default CLI envelope is JSON: `ok`, `command: "describe"` and `data`.
`data` contains:

| Field | Meaning |
| --- | --- |
| `schema_version`, `manager_version`, `protocol_id`, `language` | Contract, manager build, protocol and language |
| `sections` | Ordered overview, configuration, connection, verification and runtime sections |
| `sections[].items` | Stable text ID, topic, text and optional machine-readable choice key |
| `configuration.schema` | The same object returned by `schema <protocol>` |
| `configuration.saved` / `.applied` | Persisted settings and the last successfully applied snapshot, independently nullable |
| `workspace` | Existing workspace view, including state and errors; null if its configuration is unavailable |
| `connection` | The existing connection-info response, or `available: false` with a reason |
| `verification` | The existing tests-list response (including current cases, paths, limits and availability), or an unavailable reason |
| `commands`, `notes` | Follow-up argument arrays and interpretation notes |

The static sections describe supported branches. Conditional Web explanations
are included in the relevant protocol's sections even when that branch is not
currently selected. Current values, runnable test cases and availability must be
read from the accompanying snapshots and metadata. Text fragments surrounding
runtime values retain stable IDs; resolved runtime values are in the structured
fields, not interpolated into normative text. `choice.group` and `.value` map
scenario/mode/test labels to their machine values.

This command only reads. It does not save/apply settings, start/stop containers,
perform a health probe, send protocol traffic or run a disposable test client.
Connection information can inspect existing Docker resources/observer evidence;
it is bounded to five seconds. A stopped service or unavailable Docker does not
hide static guidance. A corrupt configuration returns no selected workspace or
saved/applied snapshot. Unknown protocols are rejected. CLI query success means
the description was read, not that a target is healthy or its tests passed.

## Single source and consistency

`backend/descriptions/zh-CN.json` is the authoritative text catalog. The native
manager bundles it and serves:

- `GET /api/descriptions`: versioned shared catalog for the Web UI.
- `GET /api/protocols/{id}/description`: protocol-filtered sections plus current
  schema/settings/connection/test metadata, used by `plabctl describe`.

Configuration labels, field notes and validation explanations, protocol scope,
connection instructions, test/scenario labels and result interpretation use
catalog IDs in the Web source. Existing layout, dynamic field values and actual
execution logic remain in their components. Executable connection commands,
preconditions, test cases, limits, runtime evidence and results continue to come
from their existing backend endpoints. `describe` composes those same handlers
rather than defining another set of connection or test rules. The tests-list
`case_labels` uses the shared catalog. MQTT version/QoS labels are generated from
the machine case values; current scenario values remain in the applied snapshot.

The Web UI fetches the catalog before displaying guidance and reloads it when
the manager version changes. A failed or mismatched catalog shows an explicit
unavailable/retry message; the frontend does not ship a second text fallback.
After the initial load, updates do not unmount the workspace or discard unsaved
drafts. Existing CLI commands and workspace/config/container identities remain
compatible.

To edit an explanation, update its backend catalog text. Keep its ID stable and
set its protocol scope and section accurately. New Web guidance must reference
its catalog ID. Never add a separately maintained CLI explanation. For dynamic
semantics, change the shared backend metadata/handler and its corresponding
rendering. Tests check registered-protocol coverage, key validity, late-bound
labels, catalog upgrades and rejection of malformed data. Frontend tests load
this backend catalog only as a fixture; production uses the API.
