import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arpClientDefaults,
  arpClientModes,
  arpClientScenarios,
  arpClientAllowedScenarios,
  isArpClientConfig,
  validateArpClientConfig,
  normalizeArpClientConfig,
  changeArpClientLink,
  sameArpClientConfig,
  arpClientBudget,
  arpClientReportLabel,
  positiveArpClientScenario,
  type ArpClientConfig,
} from "../src/arp-client-config.ts";
import {
  currentArpClientRuntime,
  arpPendingRemainingMs,
  type ArpClientRuntimeEnvelope,
} from "../src/arp-client-runtime.ts";
import { workspaceIpEndpoint } from "../src/workspace-config.ts";
import { defaults } from "../src/config.ts";
import { bfdDefaults } from "../src/bfd-config.ts";
import { vxlanDefaults } from "../src/vxlan-config.ts";
import { iec101Defaults } from "../src/iec101-config.ts";

test("ARP-client preserves all15 legal pairs and rejects incompatible saved pairs without resetting the draft", () => {
  let count = 0,
    positive = 0;
  for (const mode of arpClientModes)
    for (const scenario of arpClientScenarios) {
      const c = {
        ...arpClientDefaults,
        mode,
        request_scenario: { mode: scenario },
      };
      if (arpClientAllowedScenarios[mode].includes(scenario)) {
        assert.doesNotThrow(() => validateArpClientConfig(c));
        count++;
        if (positiveArpClientScenario(c)) positive++;
      } else {
        assert.equal(isArpClientConfig(c), true);
        assert.throws(() => validateArpClientConfig(c), /不兼容/);
        assert.equal(c.request_scenario.mode, scenario);
      }
    }
  assert.equal(count, 15);
  assert.equal(positive, 7);
});
test("ARP-client strict12 fields and tagged links never absorb bind_ip/port or stale interface keys", () => {
  assert.equal(isArpClientConfig(arpClientDefaults), true);
  for (const key of Object.keys(arpClientDefaults)) {
    const c = { ...arpClientDefaults } as Record<string, unknown>;
    delete c[key];
    assert.equal(isArpClientConfig(c), false);
  }
  for (const c of [
    bfdDefaults,
    vxlanDefaults,
    { ...arpClientDefaults, bind_ip: "127.0.0.1" },
    { ...arpClientDefaults, port: 18086 },
    {
      ...arpClientDefaults,
      link: { mode: "docker-bridge", interface: "eth0" },
    },
    { ...arpClientDefaults, link: { mode: "host-interface" } },
    {
      ...arpClientDefaults,
      request_scenario: { mode: "normal", duration_ms: 1 },
    },
    { ...arpClientDefaults, retries: false },
  ])
    assert.equal(isArpClientConfig(c), false);
  for (const mode of [["whois"], {}, true, null])
    assert.equal(isArpClientConfig({ ...arpClientDefaults, mode }), false);
  for (const mode of [["normal"], {}, true, null])
    assert.equal(
      isArpClientConfig({ ...arpClientDefaults, request_scenario: { mode } }),
      false,
    );
  const host = changeArpClientLink(arpClientDefaults, "host-interface");
  assert.deepEqual(host.link, { mode: "host-interface", interface: "" });
  assert.throws(() => validateArpClientConfig(host));
  assert.deepEqual(
    changeArpClientLink(
      { ...host, link: { mode: "host-interface", interface: "real0" } },
      "docker-bridge",
    ).link,
    { mode: "docker-bridge" },
  );
  for (const name of [
    "",
    ".",
    "eth0:1",
    "eth/0",
    "a".repeat(16),
    "网卡",
    "eth 0",
  ])
    assert.throws(() =>
      validateArpClientConfig({
        ...host,
        link: { mode: "host-interface", interface: name },
      }),
    );
  assert.doesNotThrow(() =>
    validateArpClientConfig({
      ...host,
      link: { mode: "host-interface", interface: "real-if.0" },
    }),
  );
});
test("ARP role IPs and actual MACs validate/canonicalize without pretending role IP is an OS endpoint", () => {
  const c = {
    ...arpClientDefaults,
    source_mac: "02:AA:00:00:01:10",
    server_mac: "02:AA:00:00:01:20",
  };
  const n = normalizeArpClientConfig(c);
  assert.equal(n.source_mac, "02:aa:00:00:01:10");
  assert.equal(c.source_mac, "02:AA:00:00:01:10");
  assert.equal(sameArpClientConfig(c, n), true);
  for (const key of ["source_mac", "server_mac"] as const)
    for (const v of [
      "00:00:00:00:00:00",
      "01:00:00:00:00:01",
      "ff:ff:ff:ff:ff:ff",
      "02:0:00:00:00:00",
      "02:00:00:00:01:10 ",
    ])
      assert.throws(() =>
        validateArpClientConfig({ ...arpClientDefaults, [key]: v }),
      );
  assert.throws(() =>
    validateArpClientConfig({ ...c, server_mac: c.source_mac.toLowerCase() }),
  );
  for (const key of ["source_ip", "server_ip", "assigned_ip"] as const)
    for (const ip of [
      "0.0.0.0",
      "0.1.2.3",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "198.018.1.1",
    ])
      assert.throws(() =>
        validateArpClientConfig({ ...arpClientDefaults, [key]: ip }),
      );
  assert.throws(() =>
    validateArpClientConfig({
      ...arpClientDefaults,
      server_ip: arpClientDefaults.source_ip,
    }),
  );
  assert.doesNotThrow(() =>
    validateArpClientConfig({
      ...arpClientDefaults,
      mode: "rarp",
      assigned_ip: arpClientDefaults.source_ip,
    }),
  );
  assert.equal(workspaceIpEndpoint(c), null);
  assert.equal("bind_ip" in c, false);
  assert.equal("port" in c, false);
});
test("ARP timers remain runtime-legal independently of exact integer selected-method test budgets", () => {
  for (const [key, lo, hi] of [
    ["interval_ms", 10, 60000],
    ["timeout_ms", 10, 60000],
    ["retries", 0, 10],
  ] as const) {
    for (const v of [lo, hi])
      assert.doesNotThrow(() =>
        validateArpClientConfig({ ...arpClientDefaults, [key]: v }),
      );
    for (const v of [lo - 1, hi + 1, 1.5, NaN, true, null])
      assert.throws(() =>
        validateArpClientConfig({
          ...arpClientDefaults,
          [key]: v,
        } as ArpClientConfig),
      );
  }
  assert.equal(arpClientBudget(arpClientDefaults).total_ms, 26200);
  assert.throws(
    () => arpClientBudget(arpClientDefaults, "BOGUS" as "ALL"),
    /不支持/,
  );
  const neg = {
    ...arpClientDefaults,
    request_scenario: { mode: "wrong-target-ip" as const },
  };
  assert.equal(arpClientBudget(neg).total_ms, 30000);
  assert.equal(arpClientBudget({ ...neg, retries: 10 }).total_ms, 30000);
  assert.equal(arpClientBudget(neg).testable, true);
  assert.equal(arpClientBudget({ ...neg, timeout_ms: 1100 }).total_ms, 31400);
  assert.equal(arpClientBudget({ ...neg, timeout_ms: 1100 }).testable, false);
  assert.equal(
    arpClientBudget({ ...neg, timeout_ms: 1100 }, "MAPPING").testable,
    true,
  );
  assert.equal(
    arpClientBudget({ ...neg, timeout_ms: 1250 }, "MAPPING").max_phase_ms,
    4000,
  );
  assert.equal(
    arpClientBudget({ ...neg, timeout_ms: 1250 }, "MAPPING").testable,
    true,
  );
  assert.equal(
    arpClientBudget({ ...neg, timeout_ms: 1251 }, "MAPPING").testable,
    false,
  );
  assert.equal(
    arpClientBudget({ ...neg, timeout_ms: 249 }, "OBSERVE_REQUEST").testable,
    false,
  );
  assert.equal(
    arpClientBudget({ ...neg, timeout_ms: 250 }, "OBSERVE_REQUEST").testable,
    true,
  );
  assert.equal(
    arpClientBudget({ ...neg, interval_ms: 60000, timeout_ms: 60000 }).total_ms,
    1332000,
  );
});
test("ARP report labels retain own applied mode/scenario/link and old IP endpoint views serialize nothing", () => {
  const old = {
    ...arpClientDefaults,
    mode: "rarp" as const,
    request_scenario: { mode: "nonzero-rarp-proto" as const },
    assigned_ip: "198.18.1.77",
  };
  const next = { ...arpClientDefaults, mode: "inarp" as const };
  assert.match(
    arpClientReportLabel("ALL", old),
    /rarp.*nonzero-rarp-proto.*docker-bridge.*8项/,
  );
  assert.match(arpClientReportLabel("ALL", next), /inarp.*normal/);
  assert.equal(sameArpClientConfig(old, next), false);
  for (const c of [defaults, bfdDefaults, vxlanDefaults, iec101Defaults]) {
    const before = JSON.stringify(c);
    assert.ok(workspaceIpEndpoint(c));
    assert.equal(JSON.stringify(c), before);
  }
  assert.equal(workspaceIpEndpoint(bfdDefaults)?.port, 3784);
  assert.equal(
    workspaceIpEndpoint(iec101Defaults)?.port,
    iec101Defaults.single.port,
  );
});
test("ARP pending deadline display stays distinct from last historical mapping and local IDs are never ACKs", () => {
  const value: ArpClientRuntimeEnvelope = {
    available: true,
    source_container_id: "owned",
    runtime: {
      schema_version: 1,
      protocol: "arp-client",
      boot_id: "boot",
      runtime_id: "nonce",
      worker_ready_after_bind: true,
      event_loop_age_ms: 5,
      uptime_ms: 1000,
      interface: {
        name: "eth0",
        ifindex: 2,
        hardware_type: 1,
        mac: arpClientDefaults.source_mac,
      },
      link_mode: "docker-bridge",
      mode: "whois",
      request_scenario: "normal",
      pending: {
        query_id: 2,
        retry_index: 0,
        sent_ms: 900,
        deadline_ms: 1900,
        expected_response: true,
        unexpected_responses: 0,
      },
      last_mapping: {
        query_id: 1,
        received_ms: 500,
        mapping_kind: "server_mac_for_target_ip",
        mapping_mac: arpClientDefaults.server_mac,
        mapping_ip: arpClientDefaults.server_ip,
        response_sha256: "sha",
      },
      counters: {
        queries_sent: 2,
        resolved: 1,
        timeouts: 0,
        negative_silent: 0,
        unexpected_responses: 0,
        observed_frames: 1,
        incoming_frames: 1,
        rejected_frames: 0,
        ignored_control: 0,
        ignored_outgoing: 0,
        log_dropped: 0,
      },
      next_event_id: 3,
      cache_evictions: 0,
      protocol_has_transaction_id: false,
      late_identical_response_is_ambiguous: true,
      response_ack_sent: false,
      filter: { name: "arp-rarp-ethertype-v1", attached: true, sha256: "hash" },
    },
  };
  const r = currentArpClientRuntime(value, "owned")!;
  assert.equal(r.pending?.query_id, 2);
  assert.equal(
    currentArpClientRuntime(
      {
        ...value,
        runtime: { ...r, pending: { ...r.pending!, expected_response: false } },
      },
      "owned",
    )?.pending?.expected_response,
    false,
  );
  assert.equal(
    currentArpClientRuntime(
      {
        ...value,
        runtime: { ...r, pending: { ...r.pending!, expected_response: null } },
      } as unknown as ArpClientRuntimeEnvelope,
      "owned",
    ),
    null,
  );
  assert.equal(r.last_mapping?.query_id, 1);
  assert.equal(arpPendingRemainingMs(r, 200), 700);
  assert.equal(arpPendingRemainingMs(r, 1000), 0);
  assert.equal(r.counters.timeouts, 0);
  assert.equal(arpPendingRemainingMs({ ...r, pending: null }, 0), null);
  assert.equal(currentArpClientRuntime(value, "other"), null);
  assert.equal(
    currentArpClientRuntime({ ...value, available: false }, "owned"),
    null,
  );
  assert.equal(
    currentArpClientRuntime(
      {
        ...value,
        runtime: { ...r, response_ack_sent: true },
      } as unknown as ArpClientRuntimeEnvelope,
      "owned",
    ),
    null,
  );
});
