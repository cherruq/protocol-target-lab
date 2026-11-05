import test from "node:test";
import assert from "node:assert/strict";
import {
  profinetDefaults,
  isProfinetConfig,
  validateProfinetConfig,
  normalizeProfinetConfig,
  validateProfinetIpSuite,
  validProfinetInitialName,
  profinetNScenarios,
  profinetFScenarios,
  sameProfinetConfig,
  profinetReportLabel,
  type ProfinetConfig,
} from "../src/profinet-config.ts";
import {
  workspaceIpEndpoint,
  sameWorkspaceConfig,
  updateWorkspaceDrafts,
} from "../src/workspace-config.ts";
import { mplsDefaults } from "../src/mpls-config.ts";
const clone = () => structuredClone(profinetDefaults);
test("PROFINET strict6 fields require all three roles and literal owned-only link without fake ports", () => {
  const c = clone();
  assert.equal(Object.keys(c).length, 6);
  validateProfinetConfig(c);
  assert.equal(workspaceIpEndpoint(c), null);
  assert.equal(sameWorkspaceConfig(c, mplsDefaults), false);
  for (const key of Object.keys(c)) {
    const v = { ...c } as Record<string, unknown>;
    delete v[key];
    assert.equal(isProfinetConfig(v), false);
  }
  for (const v of [
    { ...c, port: 34964 },
    { ...c, wire_profile: "mpls-single-label-ipv4-icmp-echo" },
    { ...c, link: { mode: "host-interface", interface: "eth0" } },
    { ...c, ptcp_n: { ...c.ptcp_n, enabled: false } },
    { ...c, ptcp_f: { ...c.ptcp_f, truncated_follow_up_size: true } },
    { ...c, dcp: { ...c.dcp, storage_path: "/tmp/x" } },
    { ...c, ptcp_n: { ...c.ptcp_n, scenario: { mode: ["good"] } } },
    { ...c, ptcp_f: { ...c.ptcp_f, scenario: { mode: "good", duration: 1 } } },
  ])
    assert.equal(isProfinetConfig(v), false);
});
test("initializer station policy is strict ASCII lower first-label-reserved/240B, not native runtime policy", () => {
  for (const v of [
    "a",
    "a--b",
    "a.port-123",
    "port-123a",
    "1.2.3.a",
    "a".repeat(63) +
      "." +
      "b".repeat(63) +
      "." +
      "c".repeat(63) +
      "." +
      "d".repeat(48),
  ])
    assert.equal(validProfinetInitialName(v), true, v);
  for (const v of [
    "",
    "UPPER",
    "a..b",
    ".a",
    "a.",
    "-a",
    "a-",
    "port-123",
    "port-123.foo",
    "port-123-12345",
    "port-123-12345.foo",
    "1.2.3.4",
    "a".repeat(64),
    "a".repeat(63) +
      "." +
      "b".repeat(63) +
      "." +
      "c".repeat(63) +
      "." +
      "d".repeat(49),
    "汉字",
  ])
    assert.equal(validProfinetInitialName(v), false, v);
});
test("native initializer IP rules preserve allzero exception and reject network/broadcast/31/32 and management policy is backend actual preflight", () => {
  for (const s of [
    { ip: "0.0.0.0", netmask: "0.0.0.0", gateway: "0.0.0.0" },
    { ip: "198.18.86.20", netmask: "255.255.255.0", gateway: "198.18.86.20" },
    { ip: "198.18.86.20", netmask: "128.0.0.0", gateway: "0.0.0.0" },
  ])
    validateProfinetIpSuite(s);
  for (const s of [
    { ip: "0.0.0.0", netmask: "255.255.255.0", gateway: "0.0.0.0" },
    { ip: "127.0.0.1", netmask: "255.255.255.0", gateway: "0.0.0.0" },
    { ip: "240.1.2.3", netmask: "255.255.255.0", gateway: "0.0.0.0" },
    { ip: "198.18.86.0", netmask: "255.255.255.0", gateway: "0.0.0.0" },
    { ip: "198.18.86.255", netmask: "255.255.255.0", gateway: "0.0.0.0" },
    { ip: "198.18.86.20", netmask: "255.255.255.254", gateway: "0.0.0.0" },
    { ip: "198.18.86.20", netmask: "255.255.255.255", gateway: "0.0.0.0" },
    { ip: "198.018.86.20", netmask: "255.255.255.0", gateway: "0.0.0.0" },
    { ip: "198.18.86.20", netmask: "255.0.255.0", gateway: "0.0.0.0" },
    { ip: "198.18.86.20", netmask: "255.255.255.0", gateway: "198.18.87.1" },
    { ip: "198.18.86.20", netmask: "255.255.255.0", gateway: "198.18.86.0" },
  ])
    assert.throws(
      () => validateProfinetIpSuite(s),
      undefined,
      JSON.stringify(s),
    );
});
test("four actual role MACs are distinct and canonicalized without modifying native initializer", () => {
  const c = clone();
  c.dcp.mac = "02:AB:00:00:86:20";
  assert.equal(normalizeProfinetConfig(c).dcp.mac, "02:ab:00:00:86:20");
  assert.equal(c.dcp.mac, "02:AB:00:00:86:20");
  for (const mac of [
    c.test_peer_mac,
    c.ptcp_n.mac,
    c.ptcp_f.mac,
    "00:00:00:00:00:00",
    "01:80:c2:00:00:0e",
  ])
    assert.throws(() =>
      validateProfinetConfig({ ...clone(), dcp: { ...clone().dcp, mac } }),
    );
});
test("N5/F11 combinations retain concurrent identities and inactive F size, no delay role switching", () => {
  assert.equal(profinetNScenarios.length, 5);
  assert.equal(profinetFScenarios.length, 11);
  for (const n of profinetNScenarios)
    for (const f of profinetFScenarios) {
      const c = clone();
      c.ptcp_n.scenario.mode = n;
      c.ptcp_f.scenario.mode = f;
      validateProfinetConfig(c);
      assert.equal(
        normalizeProfinetConfig(c).ptcp_f.truncated_follow_up_size,
        37,
      );
    }
  for (const size of [16, 45])
    validateProfinetConfig({
      ...clone(),
      ptcp_f: { ...clone().ptcp_f, truncated_follow_up_size: size },
    });
  for (const size of [15, 46, 16.5, NaN, Infinity])
    assert.throws(() =>
      validateProfinetConfig({
        ...clone(),
        ptcp_f: { ...clone().ptcp_f, truncated_follow_up_size: size },
      }),
    );
  assert.equal(
    isProfinetConfig({
      ...clone(),
      ptcp_n: { ...clone().ptcp_n, scenario: { mode: "missing-follow-up" } },
    }),
    false,
  );
});
test("historical three-node report labels use own N/F snapshots, not current selectors or mutable native values", () => {
  const old = clone(),
    label = profinetReportLabel("ALL", old);
  const now = clone();
  now.ptcp_f.scenario.mode = "missing-follow-up";
  assert.notEqual(profinetReportLabel("ALL", now), label);
  assert.equal(profinetReportLabel("ALL", old), label);
  assert.match(label, /非实时native/);
  assert.equal(sameProfinetConfig(old, now), false);
  assert.equal(profinetReportLabel("ALL", {}), "ALL");
});
test("invalid inactive numeric draft survives protocol switch and is not silently normalized away", () => {
  const bad = clone();
  bad.ptcp_f.truncated_follow_up_size = NaN;
  assert.ok(isProfinetConfig(bad));
  const d = updateWorkspaceDrafts({}, "profinet", bad, profinetDefaults);
  assert.ok(
    Number.isNaN(
      (d.profinet as ProfinetConfig).ptcp_f.truncated_follow_up_size,
    ),
  );
  assert.throws(() => normalizeProfinetConfig(bad));
  assert.equal(sameWorkspaceConfig(profinetDefaults, clone()), true);
});
