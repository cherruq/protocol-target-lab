import test from "node:test";
import assert from "node:assert/strict";
import {
  igmpDefaults,
  isIgmpConfig,
  validateIgmpConfig,
  normalizeIgmpConfig,
  igmpHostExample,
  igmpVxlanExample,
  changeIgmpLink,
  sameIgmpConfig,
  igmpReportLabel,
  igmpDescription,
  type IgmpConfig,
} from "../src/igmp-config.ts";
import {
  workspaceIpEndpoint,
  sameWorkspaceConfig,
} from "../src/workspace-config.ts";
const clone = () => structuredClone(igmpDefaults);
test("IGMP exact4 fields/const2-100 and three strict link shapes never become another socket service", () => {
  for (const link of [
    { mode: "docker-bridge" },
    igmpHostExample,
    igmpVxlanExample,
  ]) {
    const c = { ...clone(), link } as IgmpConfig;
    assert.equal(isIgmpConfig(c), true);
    validateIgmpConfig(c);
    assert.equal(workspaceIpEndpoint(c), null);
  }
  for (const c of [
    { ...clone(), port: 2 },
    { ...clone(), groups: null },
    { ...clone(), query_profile: { version: true, max_response_code: 100 } },
    { ...clone(), query_profile: { version: 2, max_response_code: 99 } },
    {
      ...clone(),
      link: {
        mode: "host-interface",
        interface: "eth0",
        interface_ip: "192.0.2.20",
      },
    },
    { ...clone(), link: { mode: "docker-bridge", interface: "eth0" } },
    { ...clone(), link: { mode: "owned-vxlan" } },
  ])
    assert.equal(isIgmpConfig(c), false);
});
test("member groups accept1/16 exact239/8 addresses, preserve order and reject duplicates/control/leadingzeros", () => {
  const c = clone();
  c.groups = Array.from({ length: 16 }, (_, i) => `239.192.19.${i + 1}`);
  validateIgmpConfig(c);
  assert.deepEqual(normalizeIgmpConfig(c).groups, c.groups);
  for (const groups of [
    [],
    [...c.groups, "239.192.19.17"],
    ["224.0.0.1"],
    ["238.255.255.255"],
    ["240.0.0.1"],
    ["239.01.2.3"],
    ["239.1.2.3", "239.1.2.3"],
  ])
    assert.throws(() => validateIgmpConfig({ ...c, groups }));
});
test("host peer-null is explicit external-only; peer interface must be different syntax-valid actual lookup context", () => {
  const c = { ...clone(), link: structuredClone(igmpHostExample) };
  validateIgmpConfig(c);
  assert.match(igmpDescription(c), /仅外部客户端/);
  c.link.peer_interface = "peer0";
  validateIgmpConfig(c);
  for (const patch of [
    { interface: "eth0:1" },
    { interface: "../eth0" },
    { interface_ip: "0.0.0.0" },
    { interface_ip: "239.1.2.3" },
    { peer_interface: "eth0" },
    { peer_interface: "" },
  ])
    assert.throws(() =>
      validateIgmpConfig({ ...c, link: { ...c.link, ...patch } }),
    );
});
test("ownedVXLAN VNI/UDPcarrier/MTU bounds differ from finiteARP VTEP and never imply IGMP port", () => {
  const c: IgmpConfig = {
    ...clone(),
    link: { ...igmpVxlanExample, vni: 1, udp_port: 1024, mtu: 576 },
  };
  validateIgmpConfig(c);
  c.link = { ...igmpVxlanExample, vni: 16777215, udp_port: 65535, mtu: 9000 };
  validateIgmpConfig(c);
  assert.match(igmpDescription(c), /承载UDP 65535（非IGMP端口）/);
  for (const patch of [
    { vni: 0 },
    { vni: 16777216 },
    { udp_port: 1023 },
    { udp_port: 65536 },
    { mtu: 575 },
    { mtu: 9001 },
    { mtu: 1400.5 },
    { local_outer_ip: igmpVxlanExample.peer_outer_ip },
  ])
    assert.throws(() =>
      validateIgmpConfig({
        ...clone(),
        link: { ...igmpVxlanExample, ...patch },
      }),
    );
});
test("owned inner CIDR requires distinct usable sameprefix endpoints and canonical distinct unicast MACs", () => {
  const c: IgmpConfig = {
    ...clone(),
    link: {
      ...igmpVxlanExample,
      local_inner_cidr: "198.18.19.21/30",
      peer_inner_ip: "198.18.19.22",
      local_inner_mac: "02:AA:00:00:19:20",
    },
  };
  validateIgmpConfig(c);
  const n = normalizeIgmpConfig(c);
  assert.equal(
    n.link.mode === "owned-vxlan" && n.link.local_inner_mac,
    "02:aa:00:00:19:20",
  );
  assert.equal(sameIgmpConfig(c, n), true);
  for (const patch of [
    { local_inner_cidr: "198.18.19.20/30" },
    { peer_inner_ip: "198.18.19.23" },
    { peer_inner_ip: "198.18.20.22" },
    { peer_inner_ip: "198.18.19.21" },
    { local_inner_cidr: "198.18.19.21/31" },
    { local_inner_cidr: "198.18.19.21/015" },
    { local_inner_mac: "01:00:5e:00:00:01" },
    { peer_inner_mac: "02:aa:00:00:19:20" },
  ])
    assert.throws(() =>
      validateIgmpConfig({ ...c, link: { ...c.link, ...patch } }),
    );
});
test("link mode cache preserves invalid local edits but submits only selected whole variant", () => {
  let c = clone(),
    cache = {};
  let next = changeIgmpLink(c, "host-interface", cache);
  c = next.config;
  cache = next.cache;
  assert.equal(c.link.mode === "host-interface" && c.link.interface, "");
  assert.throws(() => validateIgmpConfig(c));
  c.link = {
    ...igmpHostExample,
    interface: "my-source",
    peer_interface: "my-peer",
  };
  next = changeIgmpLink(c, "owned-vxlan", cache);
  c = next.config;
  cache = next.cache;
  c.link = { ...igmpVxlanExample, vni: NaN };
  next = changeIgmpLink(c, "docker-bridge", cache);
  c = next.config;
  cache = next.cache;
  assert.deepEqual(c.link, { mode: "docker-bridge" });
  validateIgmpConfig(c);
  next = changeIgmpLink(c, "host-interface", cache);
  assert.deepEqual(next.config.link, {
    ...igmpHostExample,
    interface: "my-source",
    peer_interface: "my-peer",
  });
  next = changeIgmpLink(next.config, "owned-vxlan", next.cache);
  assert.ok(
    next.config.link.mode === "owned-vxlan" &&
      Number.isNaN(next.config.link.vni),
  );
});
test("firstgroup semantics participate in equality and historical labels remain own applied snapshot", () => {
  const old = clone();
  old.groups = ["239.192.19.2", "239.192.19.1"];
  const now = { ...old, groups: [...old.groups].reverse() };
  assert.equal(sameIgmpConfig(old, now), false);
  assert.match(igmpReportLabel("GROUP_QUERY", old), /首组239.192.19.2/);
  assert.match(igmpReportLabel("ALL", now), /首组239.192.19.1/);
  assert.equal(
    igmpReportLabel("ALL", { query_profile: { version: 2 } }),
    "ALL",
  );
  assert.match(igmpReportLabel("ALL", old), /4检查组/);
});
test("all selected config fields are fingerprinted while IP transport display remains absent", () => {
  const a = clone(),
    b = { ...clone(), link: { ...igmpHostExample } };
  assert.equal(sameWorkspaceConfig(a, b), false);
  assert.equal(
    sameWorkspaceConfig(a, {
      bind_ip: "0.0.0.0",
      port: 1,
      response_length: 64,
      response_mode: "fixed",
    }),
    false,
  );
  assert.equal(
    workspaceIpEndpoint({ ...clone(), link: { ...igmpVxlanExample } }),
    null,
  );
});

test("builtin host-null restriction and planned query/report totals never use4checks as report count", async () => {
  const { igmpBuiltinConfigured, igmpPlannedCounts } = await import(
    "../src/igmp-config.ts"
  );
  assert.equal(
    igmpBuiltinConfigured({ ...clone(), link: igmpHostExample }),
    false,
  );
  assert.equal(
    igmpBuiltinConfigured({
      ...clone(),
      link: { ...igmpHostExample, peer_interface: "peer0" },
    }),
    true,
  );
  assert.equal(igmpBuiltinConfigured(clone()), true);
  assert.deepEqual(igmpPlannedCounts("ALL", 16), {
    checks: 4,
    queries: 4,
    reports: 34,
  });
  assert.deepEqual(igmpPlannedCounts("GROUP_QUERY", 16), {
    checks: 2,
    queries: 2,
    reports: 2,
  });
  assert.deepEqual(igmpPlannedCounts("GENERAL_QUERY", 1), {
    checks: 2,
    queries: 2,
    reports: 2,
  });
  assert.equal(igmpPlannedCounts("ALL", 0), null);
  assert.equal(igmpPlannedCounts("unknown", 1), null);
});
