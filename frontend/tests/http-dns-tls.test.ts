import assert from "node:assert/strict";
import { test } from "node:test";
import { defaults, normalizeConfig, sameStoredConfig, validateConfig } from "../src/config.ts";
import { dnsDefaults, dnsConnectionCommands, normalizeDnsConfig, sameDnsConfig, type DnsConfig } from "../src/dns-config.ts";
import { httpMethodsForPath, httpResponseStatus, testPaths } from "../src/client-tests.ts";
import { workspaceIpEndpoint, updateWorkspaceDrafts } from "../src/workspace-config.ts";

test("HTTP TLS stays explicit and legacy normalization preserves enabled transport without changing the saved object", () => {
  assert.deepEqual(normalizeConfig(defaults), defaults);
  assert.deepEqual(normalizeConfig({ ...defaults, tls_enabled: false }), defaults);
  const legacy = { bind_ip: "127.0.0.1", port: 18443, response_body: "测试", tls_enabled: true };
  assert.deepEqual(normalizeConfig(legacy), { bind_ip: "127.0.0.1", port: 18443, response_length: 6, response_mode: "fixed", tls_enabled: true });
  assert.equal(legacy.response_body, "测试");
  assert.equal(sameStoredConfig(defaults, { ...defaults, tls_enabled: false }), true);
  assert.equal(sameStoredConfig(defaults, { ...defaults, tls_enabled: true }), false);
  assert.equal(sameStoredConfig(legacy, { ...legacy, tls_enabled: false }), false);
  assert.throws(() => validateConfig({ ...defaults, tls_enabled: "true" as unknown as boolean }));
});

test("DNS TLS-only configuration uses its independent endpoint and preserves old default JSON", () => {
  assert.deepEqual(normalizeDnsConfig(dnsDefaults), dnsDefaults);
  assert.deepEqual(normalizeDnsConfig({ ...dnsDefaults, tls_enabled: false, response_profile: "standard", fixture_set: "final" }), dnsDefaults);
  const tlsOnly = { ...dnsDefaults, udp_enabled: false, tcp_enabled: false, tls_enabled: true };
  assert.doesNotThrow(() => normalizeDnsConfig(tlsOnly));
  assert.deepEqual(workspaceIpEndpoint(tlsOnly), { bind_ip: "0.0.0.0", port: 1853 });
  assert.deepEqual(workspaceIpEndpoint({ ...tlsOnly, tls_port: 18853 }), { bind_ip: "0.0.0.0", port: 18853 });
  assert.equal(sameDnsConfig(dnsDefaults, { ...dnsDefaults, tls_enabled: false, tls_port: 1853, response_profile: "standard", fixture_set: "final" }), true);
});

test("DNS TLS validates independent ports and exact enabled transports", () => {
  for (const tls_port of [0, 65536, -1, 1.5, NaN])
    assert.throws(() => normalizeDnsConfig({ ...dnsDefaults, tls_enabled: true, tls_port }));
  assert.throws(() => normalizeDnsConfig({ ...dnsDefaults, tls_enabled: true, tls_port: dnsDefaults.port }));
  assert.doesNotThrow(() => normalizeDnsConfig({ ...dnsDefaults, tcp_enabled: false, tls_enabled: true, tls_port: dnsDefaults.port }));
  assert.throws(() => normalizeDnsConfig({ ...dnsDefaults, tls_enabled: "false" as unknown as boolean }));
  assert.throws(() => normalizeDnsConfig({ ...dnsDefaults, response_profile: "other" as DnsConfig["response_profile"] }));
  assert.throws(() => normalizeDnsConfig({ ...dnsDefaults, fixture_set: "other" as DnsConfig["fixture_set"] }));
});

test("short and wrong-id fixtures require explicit UDP-only selection without editing the caller's transports", () => {
  for (const fixture_set of ["short", "wrong-id"] as const) {
    const invalid = { ...dnsDefaults, response_profile: "legacy-fixtures" as const, fixture_set };
    const before = structuredClone(invalid);
    assert.throws(() => normalizeDnsConfig(invalid));
    assert.deepEqual(invalid, before);
    const valid = normalizeDnsConfig({ ...invalid, tcp_enabled: false });
    assert.equal(valid.fixture_set, fixture_set);
    assert.throws(() => normalizeDnsConfig({ ...valid, tls_enabled: true }));
  }
});

test("TLS and fixed-scenario edits produce pending drafts and remain isolated from another protocol", () => {
  const dnsDraft = { ...dnsDefaults, response_profile: "legacy-fixtures" as const, tls_enabled: true };
  const first = updateWorkspaceDrafts({}, "dns", dnsDraft, dnsDefaults);
  const second = updateWorkspaceDrafts(first, "http", { ...defaults, tls_enabled: true }, defaults);
  assert.deepEqual(second.dns, dnsDraft);
  assert.equal((second.http as typeof defaults).tls_enabled, true);
  const third = updateWorkspaceDrafts(second, "http", defaults, defaults);
  assert.equal(third.http, undefined);
  assert.deepEqual(third.dns, dnsDraft);
  assert.equal(sameDnsConfig(dnsDefaults, dnsDraft), false);
  assert.equal(sameDnsConfig(dnsDefaults, { ...dnsDefaults, tls_port: 18853 }), false);
  assert.equal(sameDnsConfig(dnsDefaults, { ...dnsDefaults, fixture_set: "short" }), false);
});

test("HTTP normal paths retain every method while fixed paths offer their intended method and ALL", () => {
  assert.equal(new Set(testPaths).size, testPaths.length);
  assert.equal(testPaths.length, 27);
  for (const path of ["/ok", "/chunked", "/close"])
    assert.deepEqual(httpMethodsForPath(path), ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "ALL"]);
  for (const path of ["/head", "/health"])
    assert.deepEqual(httpMethodsForPath(path), ["HEAD", "ALL"]);
  for (const path of testPaths.filter((p) => !["/ok", "/chunked", "/close", "/head", "/health"].includes(p)))
    assert.deepEqual(httpMethodsForPath(path), ["GET", "ALL"]);
});

test("raw malformed responses remain distinguishable from no response", () => {
  assert.equal(httpResponseStatus({ status: null, body_length: 0, wire: { body_length: 30 } }), "已收到原始报文，未解析 HTTP 状态");
  assert.equal(httpResponseStatus({ status: null, body_length: 0, wire: { body_length: 0 } }), "未收到响应");
  assert.equal(httpResponseStatus({ status: 200 }), "200");
});

test("DNS fallback commands follow enabled transports and fixed profile instead of inventing dig over TLS", () => {
  const tlsOnly = { ...dnsDefaults, udp_enabled: false, tcp_enabled: false, tls_enabled: true };
  assert.deepEqual(dnsConnectionCommands(tlsOnly), ["plabctl tests run dns --method TLS --path ALL"]);
  assert.deepEqual(dnsConnectionCommands({ ...dnsDefaults, tcp_enabled: false }), ["dig @<目标IP> -p 15353 device.test A"]);
  assert.deepEqual(dnsConnectionCommands({ ...dnsDefaults, udp_enabled: false }), ["dig +tcp @<目标IP> -p 15353 device.test A"]);
  assert.deepEqual(dnsConnectionCommands({ ...dnsDefaults, response_profile: "legacy-fixtures" }), ["plabctl tests run dns --method ALL --path ALL"]);
});
