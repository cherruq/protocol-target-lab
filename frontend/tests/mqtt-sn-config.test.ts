import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mqttSnDefaults,
  mqttSnDescription,
  isMqttSnConfig,
  sameMqttSnConfig,
  validateMqttSnConfig,
  type MqttSnConfig,
} from "../src/mqtt-sn-config.ts";
import { defaults } from "../src/config.ts";
import { dnsDefaults } from "../src/dns-config.ts";
import { mqttDefaults } from "../src/mqtt-config.ts";
import { telnetDefaults } from "../src/telnet-config.ts";
import { iec104Defaults } from "../src/iec104-config.ts";

test("MQTT-SN validates UDP port separation while allowing matching private TCP port numbers", () => {
  assert.doesNotThrow(() => validateMqttSnConfig(mqttSnDefaults));
  for (const broker_port of [
    mqttSnDefaults.port,
    mqttSnDefaults.discovery_port,
    1,
    65535,
  ])
    assert.doesNotThrow(() =>
      validateMqttSnConfig({ ...mqttSnDefaults, broker_port }),
    );
  assert.throws(() =>
    validateMqttSnConfig({
      ...mqttSnDefaults,
      discovery_port: mqttSnDefaults.port,
    }),
  );
  for (const field of ["port", "discovery_port", "broker_port"] as const)
    for (const value of [0, 65536, 1.5, NaN])
      assert.throws(() =>
        validateMqttSnConfig({ ...mqttSnDefaults, [field]: value }),
      );
});
test("MQTT-SN enforces real fixed binding addresses, IPv4 multicast and GWID endpoints", () => {
  for (const config of [
    { ...mqttSnDefaults, bind_ip: "127.0.0.1" },
    { ...mqttSnDefaults, broker_host: "0.0.0.0" },
    { ...mqttSnDefaults, broker_host: "localhost" },
  ]) {
    assert.throws(() => validateMqttSnConfig(config));
    assert.equal(isMqttSnConfig(config), false);
  }
  for (const discovery_group of ["224.0.0.0", "239.255.255.255"])
    for (const gateway_id of [1, 255])
      assert.doesNotThrow(() =>
        validateMqttSnConfig({
          ...mqttSnDefaults,
          discovery_group,
          gateway_id,
        }),
      );
  for (const discovery_group of [
    "223.255.255.255",
    "240.0.0.0",
    "255.255.255.255",
    "239.192.0.002",
    "ff02::1",
    "group.local",
  ])
    assert.throws(() =>
      validateMqttSnConfig({ ...mqttSnDefaults, discovery_group }),
    );
  for (const gateway_id of [0, 256, 1.5, NaN])
    assert.throws(() =>
      validateMqttSnConfig({ ...mqttSnDefaults, gateway_id }),
    );
});
test("MQTT-SN predefined count and ID boundaries are exact with independent name and ID uniqueness", () => {
  const topics = Array.from({ length: 16 }, (_, i) => ({
    topic_id: i + 1,
    topic: `plab/predefined/${i}`,
  }));
  assert.doesNotThrow(() =>
    validateMqttSnConfig({ ...mqttSnDefaults, predefined_topics: topics }),
  );
  assert.doesNotThrow(() =>
    validateMqttSnConfig({
      ...mqttSnDefaults,
      predefined_topics: [{ topic_id: 65534, topic: "last" }],
    }),
  );
  for (const predefined_topics of [
    [],
    [...topics, { topic_id: 17, topic: "another" }],
    [
      { topic_id: 1, topic: "a" },
      { topic_id: 1, topic: "b" },
    ],
    [
      { topic_id: 1, topic: "a" },
      { topic_id: 2, topic: "a" },
    ],
  ])
    assert.throws(() =>
      validateMqttSnConfig({ ...mqttSnDefaults, predefined_topics }),
    );
  for (const topic_id of [0, 65535, 1.5, NaN])
    assert.throws(() =>
      validateMqttSnConfig({
        ...mqttSnDefaults,
        predefined_topics: [{ topic_id, topic: "valid" }],
      }),
    );
});
test("MQTT-SN visible ASCII names allow slash and case sensitivity but exclude reserved test namespace", () => {
  for (const topic of [
    "a".repeat(128),
    "plab/predefined",
    "plab/testx",
    "PLAB/test",
    "/topic",
    "ordinary$dollar",
  ])
    assert.doesNotThrow(() =>
      validateMqttSnConfig({
        ...mqttSnDefaults,
        predefined_topics: [{ topic_id: 1, topic }],
      }),
    );
  for (const topic of [
    "",
    "a".repeat(129),
    "中文",
    "white space",
    "tab\tname",
    "null\0name",
    "del\x7f",
    "comma,name",
    "plus+",
    "hash#",
    "$SYS/review",
    "$ordinary",
    "plab/test",
    "plab/test/",
    "plab/test/child",
  ])
    assert.throws(
      () =>
        validateMqttSnConfig({
          ...mqttSnDefaults,
          predefined_topics: [{ topic_id: 1, topic }],
        }),
      undefined,
      topic,
    );
  assert.doesNotThrow(() =>
    validateMqttSnConfig({
      ...mqttSnDefaults,
      predefined_topics: [
        { topic_id: 1, topic: "Case" },
        { topic_id: 2, topic: "case" },
      ],
    }),
  );
});
test("MQTT-SN remains a distinct config and its snapshot describes real UDP discovery/private broker", () => {
  assert.equal(isMqttSnConfig(mqttSnDefaults), true);
  for (const other of [
    defaults,
    dnsDefaults,
    mqttDefaults,
    telnetDefaults,
    iec104Defaults,
  ])
    assert.equal(isMqttSnConfig(other), false);
  assert.equal(
    isMqttSnConfig({
      ...mqttSnDefaults,
      predefined_topics: [{ topic_id: "1", topic: "x" }],
    }),
    false,
  );
  assert.equal(
    sameMqttSnConfig(mqttSnDefaults, structuredClone(mqttSnDefaults)),
    true,
  );
  const edited = structuredClone(mqttSnDefaults);
  edited.predefined_topics[0].topic = "changed";
  assert.equal(sameMqttSnConfig(mqttSnDefaults, edited), false);
  const text = mqttSnDescription({
    ...mqttSnDefaults,
    port: 18298,
    discovery_port: 18299,
    broker_port: 28297,
    gateway_id: 77,
  });
  assert.match(text, /UDP 0\.0\.0\.0:18298/);
  assert.match(text, /239\.192\.0\.2:18299/);
  assert.match(text, /网关 ID 77/);
  assert.match(text, /127\.0\.0\.1:28297 TCP/);
});
