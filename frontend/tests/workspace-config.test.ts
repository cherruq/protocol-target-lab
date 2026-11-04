import assert from "node:assert/strict";
import { test } from "node:test";
import { defaults } from "../src/config.ts";
import { dnsDefaults } from "../src/dns-config.ts";
import { mqttDefaults } from "../src/mqtt-config.ts";
import { telnetDefaults } from "../src/telnet-config.ts";
import { iec104Defaults } from "../src/iec104-config.ts";
import { mqttSnDefaults } from "../src/mqtt-sn-config.ts";
import {
  discardWorkspaceDraft,
  sameWorkspaceConfig,
  updateWorkspaceDrafts,
} from "../src/workspace-config.ts";

test("protocol switches and one save retain the other workspace's unsaved draft", () => {
  const http = { ...defaults, response_length: 128 };
  const dns = { ...dnsDefaults, port: 18253 };
  let drafts = updateWorkspaceDrafts({}, "custom-http", http, defaults);
  drafts = updateWorkspaceDrafts(drafts, "dns-demo", dns, dnsDefaults);
  assert.deepEqual(drafts["custom-http"], http);
  assert.deepEqual(drafts["dns-demo"], dns);
  const next = discardWorkspaceDraft(drafts, "dns-demo");
  assert.deepEqual(next["custom-http"], http);
  assert.equal(next["dns-demo"], undefined);
  assert.deepEqual(drafts["dns-demo"], dns);
});
test("returning an editor to its saved configuration clears only that draft", () => {
  const before = {
    http: { ...defaults, response_length: 128 },
    dns: { ...dnsDefaults, port: 18253 },
  };
  assert.deepEqual(
    Object.keys(updateWorkspaceDrafts(before, "http", defaults, defaults)),
    ["dns"],
  );
  assert.equal(
    sameWorkspaceConfig(dnsDefaults, structuredClone(dnsDefaults)),
    true,
  );
  assert.equal(
    sameWorkspaceConfig(dnsDefaults, { ...dnsDefaults, tcp_enabled: false }),
    false,
  );
  assert.equal(sameWorkspaceConfig(defaults, dnsDefaults), false);
  assert.equal(
    sameWorkspaceConfig(
      { bind_ip: defaults.bind_ip, port: defaults.port, response_body: "test" },
      { ...defaults, response_length: 4 },
    ),
    false,
  );
});

test("three protocol drafts survive switching and a MQTT save clears only MQTT", () => {
  let drafts = updateWorkspaceDrafts(
    {},
    "retained-http",
    { ...defaults, response_length: 256 },
    defaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "dns-demo",
    { ...dnsDefaults, port: 18253 },
    dnsDefaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "mqtt-demo",
    { ...mqttDefaults, max_connections: 16 },
    mqttDefaults,
  );
  assert.deepEqual(Object.keys(drafts), [
    "retained-http",
    "dns-demo",
    "mqtt-demo",
  ]);
  const next = discardWorkspaceDraft(drafts, "mqtt-demo");
  assert.deepEqual(Object.keys(next), ["retained-http", "dns-demo"]);
  assert.equal(
    sameWorkspaceConfig(mqttDefaults, { ...mqttDefaults, max_connections: 16 }),
    false,
  );
  assert.equal(sameWorkspaceConfig(mqttDefaults, defaults), false);
  assert.equal(sameWorkspaceConfig(mqttDefaults, dnsDefaults), false);
});

test("TELNET joins four isolated workspace drafts without overwriting another protocol", () => {
  let drafts = updateWorkspaceDrafts(
    {},
    "http",
    { ...defaults, response_length: 128 },
    defaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "dns",
    { ...dnsDefaults, port: 18253 },
    dnsDefaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "mqtt",
    { ...mqttDefaults, max_connections: 2 },
    mqttDefaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "telnet",
    { ...telnetDefaults, banner: "UTF-8 欢迎" },
    telnetDefaults,
  );
  assert.deepEqual(Object.keys(drafts), ["http", "dns", "mqtt", "telnet"]);
  const after = discardWorkspaceDraft(drafts, "telnet");
  assert.deepEqual(Object.keys(after), ["http", "dns", "mqtt"]);
  assert.equal(sameWorkspaceConfig(telnetDefaults, mqttDefaults), false);
  assert.equal(sameWorkspaceConfig(telnetDefaults, dnsDefaults), false);
  assert.equal(sameWorkspaceConfig(telnetDefaults, defaults), false);
  assert.equal(
    sameWorkspaceConfig(telnetDefaults, {
      ...telnetDefaults,
      banner: "changed",
    }),
    false,
  );
});

test("IEC104 nested startup edits preserve all five protocol drafts and clear only their own save", () => {
  let drafts = updateWorkspaceDrafts(
    {},
    "http",
    { ...defaults, response_length: 128 },
    defaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "dns",
    { ...dnsDefaults, port: 18253 },
    dnsDefaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "mqtt",
    { ...mqttDefaults, max_connections: 2 },
    mqttDefaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "telnet",
    { ...telnetDefaults, banner: "draft" },
    telnetDefaults,
  );
  const iec = structuredClone(iec104Defaults);
  iec.points.measured.value = 22.5;
  iec.points.single.value = true;
  drafts = updateWorkspaceDrafts(drafts, "iec104", iec, iec104Defaults);
  assert.deepEqual(Object.keys(drafts), [
    "http",
    "dns",
    "mqtt",
    "telnet",
    "iec104",
  ]);
  assert.deepEqual(Object.keys(discardWorkspaceDraft(drafts, "iec104")), [
    "http",
    "dns",
    "mqtt",
    "telnet",
  ]);
  assert.equal(iec104Defaults.points.single.value, false);
  assert.equal(iec104Defaults.points.measured.value, 12.5);
  for (const other of [defaults, dnsDefaults, mqttDefaults, telnetDefaults])
    assert.equal(sameWorkspaceConfig(iec104Defaults, other), false);
  assert.equal(sameWorkspaceConfig(iec104Defaults, iec), false);
});

test("MQTT-SN topic edits join six isolated drafts without becoming another protocol's config", () => {
  let drafts = updateWorkspaceDrafts(
    {},
    "http",
    { ...defaults, response_length: 128 },
    defaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "dns",
    { ...dnsDefaults, port: 18253 },
    dnsDefaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "mqtt",
    { ...mqttDefaults, max_connections: 2 },
    mqttDefaults,
  );
  drafts = updateWorkspaceDrafts(
    drafts,
    "telnet",
    { ...telnetDefaults, banner: "draft" },
    telnetDefaults,
  );
  const iec = structuredClone(iec104Defaults);
  iec.points.single.value = true;
  drafts = updateWorkspaceDrafts(drafts, "iec104", iec, iec104Defaults);
  const sn = structuredClone(mqttSnDefaults);
  sn.predefined_topics = [{ topic_id: 42, topic: "browser/predefined" }];
  drafts = updateWorkspaceDrafts(drafts, "mqtt-sn", sn, mqttSnDefaults);
  assert.deepEqual(Object.keys(drafts), [
    "http",
    "dns",
    "mqtt",
    "telnet",
    "iec104",
    "mqtt-sn",
  ]);
  assert.deepEqual(Object.keys(discardWorkspaceDraft(drafts, "mqtt-sn")), [
    "http",
    "dns",
    "mqtt",
    "telnet",
    "iec104",
  ]);
  assert.equal(mqttSnDefaults.predefined_topics[0].topic, "plab/predefined");
  for (const other of [
    defaults,
    dnsDefaults,
    mqttDefaults,
    telnetDefaults,
    iec104Defaults,
  ])
    assert.equal(sameWorkspaceConfig(mqttSnDefaults, other), false);
  assert.equal(sameWorkspaceConfig(mqttSnDefaults, sn), false);
});

test("RTP capacity edits preserve all six previous drafts and save only their own workspace", async () => {
  const { rtpDefaults } = await import("../src/rtp-config.ts");
  const configs = [
    defaults,
    dnsDefaults,
    mqttDefaults,
    telnetDefaults,
    iec104Defaults,
    mqttSnDefaults,
  ];
  let drafts = {};
  for (const [index, config] of configs.entries())
    drafts = updateWorkspaceDrafts(
      drafts,
      `previous-${index}`,
      { ...config, port: config.port + 1 },
      config,
    );
  const rtp = { ...rtpDefaults, port: 18324, max_packet_size: 64 };
  drafts = updateWorkspaceDrafts(drafts, "rtp", rtp, rtpDefaults);
  assert.equal(Object.keys(drafts).length, 7);
  const next = updateWorkspaceDrafts(drafts, "rtp", rtp, rtp);
  assert.equal(Object.keys(next).length, 6);
  assert.equal(Object.keys(drafts).length, 7);
  for (const config of configs)
    assert.equal(sameWorkspaceConfig(rtpDefaults, config), false);
  assert.equal(sameWorkspaceConfig(rtpDefaults, rtp), false);
});

test("RTCP fixed profile and capacity join eight isolated drafts without changing RTP", async () => {
  const { rtcpDefaults } = await import("../src/rtcp-config.ts");
  const { rtpDefaults } = await import("../src/rtp-config.ts");
  const configs = [
    defaults,
    dnsDefaults,
    mqttDefaults,
    telnetDefaults,
    iec104Defaults,
    mqttSnDefaults,
    rtpDefaults,
  ];
  let drafts = {};
  for (const [index, config] of configs.entries())
    drafts = updateWorkspaceDrafts(
      drafts,
      `prior-${index}`,
      { ...config, port: config.port + 1 },
      config,
    );
  const rtcp = { ...rtcpDefaults, max_packet_size: 65507, port: 18424 };
  drafts = updateWorkspaceDrafts(drafts, "rtcp", rtcp, rtcpDefaults);
  assert.equal(Object.keys(drafts).length, 8);
  assert.equal(
    Object.keys(updateWorkspaceDrafts(drafts, "rtcp", rtcp, rtcp)).length,
    7,
  );
  for (const config of configs)
    assert.equal(sameWorkspaceConfig(rtcpDefaults, config), false);
  assert.equal(
    sameWorkspaceConfig(rtcpDefaults, structuredClone(rtcpDefaults)),
    true,
  );
  assert.equal(sameWorkspaceConfig(rtcpDefaults, rtcp), false);
});

test("DLT645 tagged fixture joins nine drafts while retaining all prior configs", async () => {
  const { dlt645Defaults, dlt645FixtureDefaults } = await import(
    "../src/dlt645-config.ts"
  );
  const { rtpDefaults } = await import("../src/rtp-config.ts");
  const { rtcpDefaults } = await import("../src/rtcp-config.ts");
  const configs = [
    defaults,
    dnsDefaults,
    mqttDefaults,
    telnetDefaults,
    iec104Defaults,
    mqttSnDefaults,
    rtpDefaults,
    rtcpDefaults,
  ];
  let drafts = {};
  for (const [index, config] of configs.entries())
    drafts = updateWorkspaceDrafts(
      drafts,
      `prior-${index}`,
      { ...config, port: config.port + 1 },
      config,
    );
  const meter = {
    ...dlt645Defaults,
    programming_key_enabled: true,
    security: { ...dlt645FixtureDefaults },
  };
  drafts = updateWorkspaceDrafts(drafts, "dlt645", meter, dlt645Defaults);
  assert.equal(Object.keys(drafts).length, 9);
  assert.equal(
    Object.keys(updateWorkspaceDrafts(drafts, "dlt645", meter, meter)).length,
    8,
  );
  for (const config of configs)
    assert.equal(sameWorkspaceConfig(dlt645Defaults, config), false);
  assert.equal(dlt645Defaults.security.mode, "reject");
  assert.equal(sameWorkspaceConfig(dlt645Defaults, meter), false);
});

test("IEC101 dual-channel nested drafts join ten workspaces without overwriting prior schemas", async () => {
  const { iec101Defaults, updateIec101Channel } = await import(
    "../src/iec101-config.ts"
  );
  const { dlt645Defaults } = await import("../src/dlt645-config.ts");
  const { rtpDefaults } = await import("../src/rtp-config.ts");
  const { rtcpDefaults } = await import("../src/rtcp-config.ts");
  const configs = [
    defaults,
    dnsDefaults,
    mqttDefaults,
    telnetDefaults,
    iec104Defaults,
    mqttSnDefaults,
    rtpDefaults,
    rtcpDefaults,
    dlt645Defaults,
  ];
  let drafts = {};
  for (const [index, config] of configs.entries())
    drafts = updateWorkspaceDrafts(
      drafts,
      `prior-${index}`,
      { ...config, port: config.port + 1 },
      config,
    );
  const dual = updateIec101Channel(iec101Defaults, "double", {
    port: 18662,
    point: { value: false },
  });
  drafts = updateWorkspaceDrafts(drafts, "iec101", dual, iec101Defaults);
  assert.equal(Object.keys(drafts).length, 10);
  assert.equal(
    Object.keys(updateWorkspaceDrafts(drafts, "iec101", dual, dual)).length,
    9,
  );
  for (const config of configs)
    assert.equal(sameWorkspaceConfig(iec101Defaults, config), false);
  assert.equal(sameWorkspaceConfig(iec101Defaults, dual), false);
  assert.equal(iec101Defaults.double.point.value, true);
});

test("BFD tagged scenarios add an eleventh isolated draft and only its explicit save clears it", async () => {
  const { bfdDefaults, changeBfdMode } = await import("../src/bfd-config.ts");
  const { iec101Defaults, updateIec101Channel } = await import(
    "../src/iec101-config.ts"
  );
  const { rtpDefaults } = await import("../src/rtp-config.ts");
  const { rtcpDefaults } = await import("../src/rtcp-config.ts");
  const { dlt645Defaults } = await import("../src/dlt645-config.ts");
  const configs = [
    defaults,
    dnsDefaults,
    mqttDefaults,
    telnetDefaults,
    iec104Defaults,
    mqttSnDefaults,
    rtpDefaults,
    rtcpDefaults,
    dlt645Defaults,
  ];
  let drafts = {};
  for (const [index, config] of configs.entries())
    drafts = updateWorkspaceDrafts(
      drafts,
      `prior-${index}`,
      { ...config, port: config.port + 1 },
      config,
    );
  const dual = updateIec101Channel(iec101Defaults, "single", {
    point: { value: false },
  });
  drafts = updateWorkspaceDrafts(drafts, "iec101", dual, iec101Defaults);
  const bfd = changeBfdMode(bfdDefaults, "quiet");
  drafts = updateWorkspaceDrafts(drafts, "bfd", bfd, bfdDefaults);
  assert.deepEqual(drafts.bfd, bfd);
  assert.deepEqual(drafts.iec101, dual);
  const saved = updateWorkspaceDrafts(drafts, "bfd", bfd, bfd);
  assert.equal(Object.keys(saved).length, 10);
  assert.equal(Object.keys(drafts).length, 11);
  for (const config of configs)
    assert.equal(sameWorkspaceConfig(bfdDefaults, config), false);
  assert.equal(sameWorkspaceConfig(bfdDefaults, iec101Defaults), false);
  assert.equal(sameWorkspaceConfig(bfdDefaults, defaults), false);
  assert.equal(sameWorkspaceConfig(bfdDefaults, bfd), false);
});
