import assert from "node:assert/strict";
import { test } from "node:test";
import { defaults } from "../src/config.ts";
import { dnsDefaults } from "../src/dns-config.ts";
import { mqttDefaults } from "../src/mqtt-config.ts";
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
