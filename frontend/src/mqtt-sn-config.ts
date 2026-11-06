import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { validIpv4 } from "./dns-config.ts";

export type PredefinedTopic = { topic_id: number; topic: string };
export type MqttSnConfig = {
  bind_ip: string;
  port: number;
  discovery_group: string;
  discovery_port: number;
  gateway_id: number;
  broker_host: string;
  broker_port: number;
  predefined_topics: PredefinedTopic[];
};
export const mqttSnDefaults: MqttSnConfig = {
  bind_ip: "0.0.0.0",
  port: 1884,
  discovery_group: "239.192.0.2",
  discovery_port: 1885,
  gateway_id: 1,
  broker_host: "127.0.0.1",
  broker_port: 28897,
  predefined_topics: [{ topic_id: 1, topic: "plab/predefined" }],
};
export const mqttSnCaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  CONNECT: guideText("mqtt-sn.verification.mqtt-sn-config.001"),
  REGISTER_PUBLISH: guideText("mqtt-sn.verification.mqtt-sn-config.002"),
  PREDEFINED_PUBLISH: guideText("mqtt-sn.verification.mqtt-sn-config.003"),
  DISCOVERY: guideText("mqtt-sn.verification.mqtt-sn-config.004"),
  ALL: guideText("mqtt-sn.verification.mqtt-sn-config.005"),
}));
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
export function isMqttSnConfig(value: unknown): value is MqttSnConfig {
  return (
    record(value) &&
    value.bind_ip === "0.0.0.0" &&
    value.broker_host === "127.0.0.1" &&
    typeof value.port === "number" &&
    typeof value.discovery_group === "string" &&
    typeof value.discovery_port === "number" &&
    typeof value.gateway_id === "number" &&
    typeof value.broker_port === "number" &&
    Array.isArray(value.predefined_topics) &&
    value.predefined_topics.every(
      (t) =>
        record(t) &&
        typeof t.topic_id === "number" &&
        typeof t.topic === "string",
    )
  );
}
export function validateMqttSnConfig(config: MqttSnConfig): void {
  if (config.bind_ip !== "0.0.0.0")
    throw new Error(guideText("mqtt-sn.configuration.mqtt-sn-config.010"));
  if (config.broker_host !== "127.0.0.1")
    throw new Error(
      guideText("mqtt-sn.configuration.mqtt-sn-config.011"),
    );
  for (const [name, value] of [
    [guideText("mqtt-sn.configuration.mqtt-sn-config.012"), config.port],
    [guideText("mqtt-sn.configuration.mqtt-sn-config.013"), config.discovery_port],
    [guideText("mqtt-sn.configuration.mqtt-sn-config.014"), config.broker_port],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 65535)
      throw new Error(`${name}${guideText("mqtt-sn.configuration.mqtt-sn-config.015")}`);
  }
  if (config.port === config.discovery_port)
    throw new Error(guideText("mqtt-sn.configuration.mqtt-sn-config.016"));
  if (
    !validIpv4(config.discovery_group) ||
    Number(config.discovery_group.split(".")[0]) < 224 ||
    Number(config.discovery_group.split(".")[0]) > 239
  )
    throw new Error(
      guideText("mqtt-sn.configuration.mqtt-sn-config.017"),
    );
  if (
    !Number.isInteger(config.gateway_id) ||
    config.gateway_id < 1 ||
    config.gateway_id > 255
  )
    throw new Error(guideText("mqtt-sn.configuration.mqtt-sn-config.018"));
  if (
    config.predefined_topics.length < 1 ||
    config.predefined_topics.length > 16
  )
    throw new Error(guideText("mqtt-sn.configuration.mqtt-sn-config.019"));
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const [index, item] of config.predefined_topics.entries()) {
    if (
      !Number.isInteger(item.topic_id) ||
      item.topic_id < 1 ||
      item.topic_id > 65534
    )
      throw new Error(
        `${guideText("mqtt-sn.configuration.mqtt-sn-config.020")}${index + 1}${guideText("mqtt-sn.configuration.mqtt-sn-config.021")}`,
      );
    if (!/^[\x21-\x7e]{1,128}$/.test(item.topic) || /[,+#]/.test(item.topic))
      throw new Error(
        `${guideText("mqtt-sn.configuration.mqtt-sn-config.022")}${index + 1}${guideText("mqtt-sn.configuration.mqtt-sn-config.023")}`,
      );
    if (item.topic === "plab/test" || item.topic.startsWith("plab/test/"))
      throw new Error(
        `${guideText("mqtt-sn.configuration.mqtt-sn-config.024")}${index + 1}${guideText("mqtt-sn.configuration.mqtt-sn-config.025")}`,
      );
    if (item.topic.startsWith("$"))
      throw new Error(
        `${guideText("mqtt-sn.configuration.mqtt-sn-config.026")}${index + 1}${guideText("mqtt-sn.configuration.mqtt-sn-config.027")}`,
      );
    if (ids.has(item.topic_id) || names.has(item.topic))
      throw new Error(guideText("mqtt-sn.configuration.mqtt-sn-config.028"));
    ids.add(item.topic_id);
    names.add(item.topic);
  }
}
export function sameMqttSnConfig(a: MqttSnConfig, b: MqttSnConfig): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.discovery_group === b.discovery_group &&
    a.discovery_port === b.discovery_port &&
    a.gateway_id === b.gateway_id &&
    a.broker_host === b.broker_host &&
    a.broker_port === b.broker_port &&
    JSON.stringify(a.predefined_topics) === JSON.stringify(b.predefined_topics)
  );
}
export function mqttSnDescription(config: MqttSnConfig): string {
  return `UDP ${config.bind_ip}:${config.port}${guideText("mqtt-sn.configuration.mqtt-sn-config.006")}${config.discovery_group}:${config.discovery_port}${guideText("mqtt-sn.configuration.mqtt-sn-config.007")}${config.gateway_id}${guideText("mqtt-sn.configuration.mqtt-sn-config.008")}${config.broker_host}:${config.broker_port} TCP · ${config.predefined_topics.length}${guideText("mqtt-sn.configuration.mqtt-sn-config.009")}`;
}
