import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dnsDefaults,
  normalizeDnsConfig,
  normalizeDnsName,
  type DnsConfig,
} from "../src/dns-config.ts";

test("DNS names normalize case and one terminal dot without mutating the draft", () => {
  const draft = structuredClone(dnsDefaults);
  draft.records[0].name = "Device.TEST.";
  const saved = normalizeDnsConfig(draft);
  assert.equal(saved.records[0].name, "device.test");
  assert.equal(draft.records[0].name, "Device.TEST.");
  for (const bad of [
    "",
    ".",
    "a..test",
    "-a.test",
    "a-.test",
    "测试.test",
    "*.test",
    "a".repeat(64) + ".test",
    "a.test..",
  ])
    assert.throws(() => normalizeDnsName(bad), undefined, bad);
});
test("DNS transport, record count, port and TTL boundaries are enforced", () => {
  for (const ttl of [0, 86400])
    assert.equal(
      normalizeDnsConfig({
        ...dnsDefaults,
        records: [{ ...dnsDefaults.records[0], ttl }],
      }).records[0].ttl,
      ttl,
    );
  const invalid: DnsConfig[] = [
    { ...dnsDefaults, udp_enabled: false, tcp_enabled: false },
    { ...dnsDefaults, records: [] },
    { ...dnsDefaults, port: 0 },
    { ...dnsDefaults, port: 65536 },
    { ...dnsDefaults, bind_ip: "224.0.0.1" },
    { ...dnsDefaults, bind_ip: "255.255.255.255" },
    ...[-1, 86401, 0.5, NaN].map((ttl) => ({
      ...dnsDefaults,
      records: [{ ...dnsDefaults.records[0], ttl }],
    })),
  ];
  invalid.forEach((config) => assert.throws(() => normalizeDnsConfig(config)));
  assert.doesNotThrow(() =>
    normalizeDnsConfig({ ...dnsDefaults, tcp_enabled: false }),
  );
});
test("DNS rejects duplicate canonical addresses and mismatched RRset TTLs", () => {
  const aaaa = {
    name: "DEVICE.test.",
    record_type: "AAAA" as const,
    value: "2001:0db8::1",
    ttl: 60,
  };
  assert.equal(
    normalizeDnsConfig({ ...dnsDefaults, records: [aaaa] }).records[0].value,
    "2001:db8::1",
  );
  for (const records of [
    [
      dnsDefaults.records[0],
      { ...dnsDefaults.records[0], name: "DEVICE.TEST." },
    ],
    [aaaa, { ...aaaa, name: "device.test", value: "2001:db8:0:0:0:0:0:1" }],
    [
      dnsDefaults.records[0],
      { ...dnsDefaults.records[0], value: "192.0.2.29", ttl: 61 },
    ],
    [{ ...dnsDefaults.records[0], value: "192.0.2.256" }],
    [{ ...aaaa, value: "2001:db8:::1" }],
  ])
    assert.throws(() => normalizeDnsConfig({ ...dnsDefaults, records }));
});
test("DNS RRsets allow sixteen records and the zone allows thirty-two", () => {
  const records = Array.from({ length: 32 }, (_, i) => ({
    ...dnsDefaults.records[0],
    name: i < 16 ? "a.test" : "b.test",
    value: `192.0.2.${i + 1}`,
  }));
  assert.equal(
    normalizeDnsConfig({ ...dnsDefaults, records }).records.length,
    32,
  );
  assert.throws(() =>
    normalizeDnsConfig({
      ...dnsDefaults,
      records: records.map((r) => ({ ...r, name: "a.test" })),
    }),
  );
  assert.throws(() =>
    normalizeDnsConfig({
      ...dnsDefaults,
      records: [...records, { ...records[0], name: "c.test" }],
    }),
  );
});
