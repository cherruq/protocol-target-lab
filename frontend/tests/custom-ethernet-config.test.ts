import test from "node:test";
import assert from "node:assert/strict";
import {
  customEthernetDefaults as defaults,
  isCustomEthernetConfig,
  isCustomEthernetDraft,
  prepareCustomEthernetSave,
  validateCustomEthernetConfig,
  parseCustomEtherType,
  sameCustomEthernetConfig,
  sameCustomEthernetDraft,
  customEthernetReportLabel,
  type CustomEthernetDraft,
} from "../src/custom-ethernet-config.ts";
import {
  updateWorkspaceDrafts,
  sameWorkspaceConfig,
  workspaceIpEndpoint,
  type WorkspaceDrafts,
} from "../src/workspace-config.ts";
const clone = () => structuredClone(defaults);
test("strict10field unique L2 shape and default full78B/64B banks", () => {
  const c = clone();
  assert.equal(Object.keys(c).length, 10);
  assert.equal(c.response.payload.payload_hex.length / 2, 64);
  assert.equal(c.response.frame_hex.length / 2, 78);
  assert.equal(c.test_request.frame_hex.length / 2, 78);
  validateCustomEthernetConfig(c);
  assert.equal(workspaceIpEndpoint(c), null);
  for (const c of [
    { ...defaults, port: 1 },
    { ...defaults, link: { mode: "docker-bridge", interface: "eth0" } },
    {
      ...defaults,
      response: { mode: "frame", frame_hex: defaults.response.frame_hex },
    },
    {
      ...defaults,
      response: {
        ...defaults.response,
        payload: { ...defaults.response.payload, vlan: null },
      },
    },
    { ...defaults, request_marker_hex: undefined },
  ])
    assert.equal(isCustomEthernetConfig(c), false);
});
test("EtherType strict complete hexadecimal input and reserved tag types", () => {
  assert.equal(parseCustomEtherType("0x88B5"), 34997);
  assert.equal(parseCustomEtherType("88b5"), 34997);
  for (const value of [
    "0x",
    "0x88b5junk",
    "0x88b5.1",
    " 88b5",
    "0X88b5",
    "65535",
    "8100",
    "88a8",
    "9100",
    1535,
    65536,
    NaN,
  ])
    assert.throws(() => parseCustomEtherType(value));
});
test("canonical hex/MAC but independent exact filter fixture and both banks persist", () => {
  const c: CustomEthernetDraft = clone();
  c.local_mac = c.local_mac.toUpperCase();
  c.response.payload.payload_hex = c.response.payload.payload_hex.toUpperCase();
  c.packet_filter = " ether proto 0x88b5\n";
  c.response.mode = "frame";
  c.response.payload.vlan = { enabled: false, vid: 0, pcp: 7, dei: true };
  c.response.payload.source_mac = {
    mode: "interface",
    value: "02:00:00:AA:BB:CC",
  };
  const n = prepareCustomEthernetSave(c, defaults).config;
  assert.equal(n.packet_filter, c.packet_filter);
  assert.deepEqual(n.test_request, c.test_request);
  assert.deepEqual(n.response.payload.vlan, c.response.payload.vlan);
  assert.equal(n.response.payload.source_mac.value, "02:00:00:aa:bb:cc");
  assert.equal(n.response.frame_hex, c.response.frame_hex);
  assert.equal(
    n.response.payload.payload_hex,
    c.response.payload.payload_hex.toLowerCase(),
  );
  assert.equal(sameCustomEthernetConfig(n, defaults), false);
});
test("inactive invalid raw draft save uses last server valid bank, retains original and dirty", () => {
  const c: CustomEthernetDraft = clone();
  c.response.frame_hex = "abc";
  c.response.payload.payload_hex = "ff";
  const result = prepareCustomEthernetSave(c, defaults);
  assert.deepEqual(result.retained, ["完整帧响应bank"]);
  assert.equal(result.config.response.frame_hex, defaults.response.frame_hex);
  assert.equal(result.config.response.payload.payload_hex, "ff");
  assert.equal(c.response.frame_hex, "abc");
  assert.equal(sameCustomEthernetDraft(c, result.config), false);
  c.response.mode = "frame";
  assert.throws(() => prepareCustomEthernetSave(c, defaults));
});
test("inactive invalid payload bank retains text across config cache while frame saves", () => {
  const c: CustomEthernetDraft = clone();
  c.response.mode = "frame";
  c.response.payload.ether_type = "0x";
  c.response.frame_hex = "ff".repeat(14);
  assert.equal(isCustomEthernetDraft(c), true);
  assert.equal(isCustomEthernetConfig(c), false);
  const result = prepareCustomEthernetSave(c, defaults);
  assert.deepEqual(result.retained, ["构造响应bank"]);
  assert.deepEqual(result.config.response.payload, defaults.response.payload);
  assert.equal(result.config.response.frame_hex, c.response.frame_hex);
  let drafts: WorkspaceDrafts = updateWorkspaceDrafts(
    {},
    "custom-id",
    c,
    result.config,
  );
  assert.deepEqual(drafts["custom-id"], c);
  drafts = updateWorkspaceDrafts(
    drafts,
    "other",
    structuredClone(defaults),
    defaults,
  );
  assert.deepEqual(drafts["custom-id"], c);
  c.response.mode = "payload";
  assert.throws(() => prepareCustomEthernetSave(c, defaults));
});
test("disabled VLAN and source override invalid local values fallback without falsely saving editor", () => {
  const c: CustomEthernetDraft = clone();
  c.response.payload.vlan.vid = NaN;
  c.response.payload.source_mac.value = "02:";
  const result = prepareCustomEthernetSave(c, defaults);
  assert.equal(result.retained.length, 2);
  assert.deepEqual(result.config, defaults);
  assert.equal(c.response.payload.source_mac.value, "02:");
  assert.ok(Number.isNaN(c.response.payload.vlan.vid));
  c.response.payload.vlan.enabled = true;
  assert.throws(() => prepareCustomEthernetSave(c, defaults));
  c.response.payload.vlan.enabled = false;
  c.response.payload.source_mac.mode = "override";
  assert.throws(() => prepareCustomEthernetSave(c, defaults));
});
test("active payload invalid cannot use inactive lastvalid fallback", () => {
  for (const modify of [
    (c: CustomEthernetDraft) => (c.response.payload.payload_hex = "a"),
    (c: CustomEthernetDraft) => (c.response.payload.ether_type = "0x8100"),
    (c: CustomEthernetDraft) =>
      (c.response.payload.destination_mac = "00:00:00:00:00:00"),
  ]) {
    const c: CustomEthernetDraft = clone();
    modify(c);
    assert.throws(() => prepareCustomEthernetSave(c, defaults));
  }
});
test("both static banks and VLAN full frame bounds are enforced even when inactive", () => {
  const c = clone();
  c.response.payload.payload_hex = "00".repeat(65521);
  validateCustomEthernetConfig(c);
  c.response.payload.vlan.enabled = true;
  assert.throws(() => validateCustomEthernetConfig(c));
  c.response.payload.payload_hex = "00".repeat(65517);
  c.response.payload.vlan.vid = 0;
  c.response.payload.vlan.pcp = 7;
  c.response.payload.vlan.dei = true;
  validateCustomEthernetConfig(c);
  c.response.frame_hex = "00".repeat(65536);
  assert.throws(() => validateCustomEthernetConfig(c));
  c.response.mode = "frame";
  assert.throws(() => prepareCustomEthernetSave(c, defaults));
});
test("marker null/empty UI disabled and exact hex static validation, BPF byte budget", () => {
  const c = clone();
  c.request_marker_hex = "";
  assert.equal(
    prepareCustomEthernetSave(c, defaults).config.request_marker_hex,
    null,
  );
  for (const filter of ["", " \n ", "x\0y", "中".repeat(683)]) {
    c.packet_filter = filter;
    assert.throws(() => prepareCustomEthernetSave(c, defaults));
  }
  c.packet_filter = "中".repeat(682);
  prepareCustomEthernetSave(c, defaults);
  c.request_marker_hex = "ff".repeat(65);
  assert.throws(() => prepareCustomEthernetSave(c, defaults));
  c.request_marker_hex = "0xff";
  assert.throws(() => prepareCustomEthernetSave(c, defaults));
});
test("real identity / destinations / multicast distinct semantics and exact membership list", () => {
  const c = clone();
  c.response.payload.destination_mac = "ff:ff:ff:ff:ff:ff";
  validateCustomEthernetConfig(c);
  c.multicast_macs = ["01:00:5e:00:00:01"];
  validateCustomEthernetConfig(c);
  for (const value of [
    ["ff:ff:ff:ff:ff:ff"],
    ["02:00:00:00:00:01"],
    ["01:00:5e:00:00:01", "01:00:5E:00:00:01"],
  ]) {
    c.multicast_macs = value;
    assert.throws(() => validateCustomEthernetConfig(c));
  }
  c.multicast_macs = [];
  c.local_mac = c.peer_mac;
  assert.throws(() => validateCustomEthernetConfig(c));
});
test("saved disabled/hidden values participate in equality and historical report mode is snapshot-owned", () => {
  const c = clone();
  c.response.payload.vlan.vid = 8;
  assert.equal(sameWorkspaceConfig(defaults, c), false);
  c.response.payload.vlan.vid = 7;
  c.response.payload.source_mac.value = "02:00:00:00:00:55";
  assert.equal(sameWorkspaceConfig(defaults, c), false);
  const label = customEthernetReportLabel("ALL", defaults);
  c.response.mode = "frame";
  assert.match(label, /构造载荷.*4组 \/ 8次交换/);
  assert.match(customEthernetReportLabel("ALL", c), /完整帧/);
  assert.equal(
    customEthernetReportLabel("ALL", { response: { mode: [] } }),
    "ALL",
  );
  assert.equal(
    sameCustomEthernetConfig(
      defaults,
      Object.fromEntries(Object.entries(defaults).reverse()) as typeof defaults,
    ),
    true,
  );
});
test("multicast editor trailing newline remains local draft; save canonicalizes intentional empty lines", () => {
  const c: CustomEthernetDraft = clone();
  c.multicast_macs = "01:00:5e:00:00:01\n";
  const n = prepareCustomEthernetSave(c, defaults).config;
  assert.deepEqual(n.multicast_macs, ["01:00:5e:00:00:01"]);
  assert.equal(sameCustomEthernetDraft(c, n), false);
});
