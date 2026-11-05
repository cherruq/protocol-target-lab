import test from "node:test";
import assert from "node:assert/strict";
import {
  currentCustomEthernetRuntime,
  type CustomEthernetRuntime,
} from "../src/custom-ethernet-runtime.ts";
import { actualProtocolExchanges } from "../src/protocol-tests.ts";
const sample: CustomEthernetRuntime = {
  schema_version: 1,
  protocol: "custom-ethernet",
  boot_id: "boot",
  runtime_id: "runtime",
  config_sha256: "a".repeat(64),
  worker_ready_after_bind: true,
  event_loop_age_ms: 5,
  uptime_ms: 50,
  interface: { name: "eth0", ifindex: 2, mac: "02:00:00:00:02:20", mtu: 1500 },
  link_mode: "docker-bridge",
  response_mode: "payload",
  filter: {
    instructions: [[6, 0, 0, 262144]],
    sha256: "b".repeat(64),
    installed: true,
    readback_instructions: [[6, 0, 0, 262144]],
    packet_socket_inode: "1234",
  },
  library: { version: "libpcap version 1.10.5", sha256: "c".repeat(64) },
  counters: {
    received: 0,
    outgoing_ignored: 0,
    rejected: 0,
    accepted: 0,
    tx_actual: 0,
    log_dropped: 0,
  },
  last_received: null,
  last_sent: null,
  next_event_id: 1,
  next_request_id: 1,
  cache_evictions: 0,
};
test("custom runtime requires current CID and actual finite filter/library/interface evidence", () => {
  const envelope = {
    available: true,
    source_container_id: "own",
    runtime: sample,
  };
  assert.equal(currentCustomEthernetRuntime(envelope, "own"), sample);
  assert.equal(currentCustomEthernetRuntime(envelope, "other"), null);
  assert.equal(
    currentCustomEthernetRuntime({ ...envelope, available: false }, "own"),
    null,
  );
  for (const modify of [
    (r: CustomEthernetRuntime) => (r.interface.mtu = NaN),
    (r: CustomEthernetRuntime) =>
      (r.filter.instructions = [[6, 0, 0, 4294967296]]),
    (r: CustomEthernetRuntime) => delete r.counters.accepted,
    (r: CustomEthernetRuntime) => (r.protocol = "arp-client" as never),
  ]) {
    const r = structuredClone(sample);
    modify(r);
    assert.equal(
      currentCustomEthernetRuntime({ ...envelope, runtime: r }, "own"),
      null,
    );
  }
});
test("actual recent evidence is bounded and missing/oversized preview never becomes ready history", () => {
  const r = structuredClone(sample);
  r.last_sent = {
    request_id: 2,
    wire_length: 78,
    raw_sha256: "d".repeat(64),
    preview_hex: "ff".repeat(78),
    truncated: false,
  };
  const env = { available: true, source_container_id: "own", runtime: r };
  assert.equal(currentCustomEthernetRuntime(env, "own"), r);
  r.last_sent.preview_hex = "ff".repeat(129);
  assert.equal(currentCustomEthernetRuntime(env, "own"), null);
  r.last_sent = {};
  assert.equal(currentCustomEthernetRuntime(env, "own"), null);
});
test("exchange proof count is explicit and never inferred from planned8 or groups4", () => {
  assert.equal(
    actualProtocolExchanges({ total: 4, passed: 4, actual_exchanges: 8 }),
    8,
  );
  assert.equal(
    actualProtocolExchanges({ total: 4, passed: 0, actual_exchanges: 0 }),
    0,
  );
  assert.equal(
    actualProtocolExchanges({ total: 4, passed: 2, actual_exchanges: 3 }),
    3,
  );
  for (const value of [
    { total: 4 },
    null,
    [],
    { actual_exchanges: "8" },
    { actual_exchanges: -1 },
    { actual_exchanges: 1.2 },
  ])
    assert.equal(actualProtocolExchanges(value), null);
});
