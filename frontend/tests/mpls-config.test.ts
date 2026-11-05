import test from "node:test";
import assert from "node:assert/strict";
import {
  mplsDefaults,
  mplsScenarios,
  isMplsConfig,
  validateMplsConfig,
  normalizeMplsConfig,
  sameMplsConfig,
  changeMplsLink,
  mplsReportLabel,
  type MplsConfig,
} from "../src/mpls-config.ts";
import {
  workspaceIpEndpoint,
  sameWorkspaceConfig,
  updateWorkspaceDrafts,
  discardWorkspaceDraft,
} from "../src/workspace-config.ts";
import { igmpDefaults } from "../src/igmp-config.ts";
import { defaults } from "../src/config.ts";
const clone = () => structuredClone(mplsDefaults);
test("MPLS exact9 shape and literal disambiguate portless L2 from all existing schemas", () => {
  const c = clone();
  assert.equal(Object.keys(c).length, 9);
  assert.ok(isMplsConfig(c));
  validateMplsConfig(c);
  assert.equal(workspaceIpEndpoint(c), null);
  assert.equal(sameWorkspaceConfig(c, igmpDefaults), false);
  assert.equal(sameWorkspaceConfig(c, defaults), false);
  for (const value of [
    { ...c, port: 5000 },
    { ...c, wire_profile: "rtp" },
    { ...c, link: { mode: "docker-bridge", interface: "eth0" } },
    { ...c, link: { mode: "host-interface" } },
    { ...c, scenario: { mode: "normal", duration_ms: 1 } },
    { ...c, scenario: { mode: ["normal"] } },
    { ...c, scenario: { mode: { toString: "normal" } } },
    { ...c, scenario: { mode: true } },
    { ...c, label: true },
    { ...c, source_ip: null },
  ])
    assert.equal(isMplsConfig(value), false);
  for (const key of Object.keys(c)) {
    const v = { ...c } as Record<string, unknown>;
    delete v[key];
    assert.equal(isMplsConfig(v), false);
  }
});
test("MPLS label16/1048575 and reply TTL1/255 accepted; fractional/bool/nonfinite/reserved rejected", () => {
  for (const label of [16, 1048575])
    for (const reply_ttl of [1, 255])
      validateMplsConfig({ ...clone(), label, reply_ttl });
  for (const label of [0, 15, 1048576, 16.5, NaN, Infinity])
    assert.throws(() => validateMplsConfig({ ...clone(), label }));
  for (const reply_ttl of [0, 256, 1.5, NaN, Infinity])
    assert.throws(() => validateMplsConfig({ ...clone(), reply_ttl }));
});
test("MPLS roles validate nonzero unicast/distinct canonical addresses; input case normalizes only on explicit save", () => {
  const c = { ...clone(), source_mac: "02:AB:00:00:58:20" };
  assert.equal(normalizeMplsConfig(c).source_mac, "02:ab:00:00:58:20");
  assert.equal(c.source_mac, "02:AB:00:00:58:20");
  for (const source_mac of [
    "00:00:00:00:00:00",
    "01:00:5e:00:00:01",
    "xx:ab:00:00:58:20",
    c.client_mac,
  ])
    assert.throws(() => validateMplsConfig({ ...clone(), source_mac }));
  for (const source_ip of [
    "0.1.2.3",
    "239.1.2.3",
    "224.0.0.1",
    "255.255.255.255",
    "198.018.58.20",
    c.client_ip,
  ])
    assert.throws(() => validateMplsConfig({ ...clone(), source_ip }));
});
test("all14 scenario selectors persist exactly including short13, with no silent/normal reset", () => {
  assert.equal(mplsScenarios.length, 14);
  for (const mode of mplsScenarios) {
    const c = { ...clone(), scenario: { mode } };
    validateMplsConfig(c);
    assert.deepEqual(normalizeMplsConfig(c).scenario, { mode });
    assert.equal(sameMplsConfig(c, clone()), mode === "normal");
  }
  assert.equal(
    isMplsConfig({ ...clone(), scenario: { mode: "short-ethernet-padded" } }),
    false,
  );
});
test("host link replacement contains only two keys, keeps page-local invalid interface draft without leaking it into bridge save", () => {
  let c = changeMplsLink(clone(), "host-interface", "bad iface");
  assert.equal(c.link.mode, "host-interface");
  assert.throws(() => validateMplsConfig(c));
  const cached = c.link.mode === "host-interface" ? c.link.interface : "";
  c = changeMplsLink(c, "docker-bridge");
  assert.deepEqual(normalizeMplsConfig(c).link, { mode: "docker-bridge" });
  c = changeMplsLink(c, "host-interface", cached);
  assert.deepEqual(c.link, { mode: "host-interface", interface: "bad iface" });
  for (const iface of ["eth0", "enp0s31f6", "a_1.2-3"])
    validateMplsConfig({
      ...clone(),
      link: { mode: "host-interface", interface: iface },
    });
  for (const iface of ["", "lo:1", "../x", "abcdefghijklmnop"])
    assert.throws(() =>
      validateMplsConfig({
        ...clone(),
        link: { mode: "host-interface", interface: iface },
      }),
    );
});
test("historical MPLS ALL title belongs to own snapshot, never current scenario or metadata", () => {
  const old = clone();
  const before = mplsReportLabel("ALL", old);
  const current = { ...old, scenario: { mode: "silent" as const } };
  assert.match(before, /normal/);
  assert.match(mplsReportLabel("ALL", current), /silent/);
  assert.equal(mplsReportLabel("ALL", old), before);
  assert.equal(mplsReportLabel("ALL", { ...old, wire_profile: "http" }), "ALL");
});
test("sixteenth draft survives legacy edits/saves and malformed numeric draft remains editable", () => {
  let d = updateWorkspaceDrafts(
    {},
    "http",
    { ...defaults, response_length: 345 },
    defaults,
  );
  d = updateWorkspaceDrafts(
    d,
    "igmp",
    { ...igmpDefaults, groups: ["239.1.2.3"] },
    igmpDefaults,
  );
  const bad = { ...clone(), label: NaN };
  assert.ok(isMplsConfig(bad));
  d = updateWorkspaceDrafts(d, "mpls", bad, mplsDefaults);
  assert.ok(Number.isNaN((d.mpls as MplsConfig).label));
  const next = discardWorkspaceDraft(d, "igmp");
  assert.ok(next.http && next.mpls);
  assert.equal(sameWorkspaceConfig(mplsDefaults, clone()), true);
  assert.equal(
    sameWorkspaceConfig(mplsDefaults, { ...clone(), reply_ttl: 63 }),
    false,
  );
  assert.ok(
    !("mpls" in updateWorkspaceDrafts(next, "mpls", clone(), mplsDefaults)),
  );
});
