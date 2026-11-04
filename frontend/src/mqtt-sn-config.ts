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
export const mqttSnCaseLabels: Record<string, string> = {
  CONNECT: "连接与会话",
  REGISTER_PUBLISH: "注册主题与 QoS 1 交付",
  PREDEFINED_PUBLISH: "预定义主题 QoS 1 交付",
  DISCOVERY: "组播发现与 GWINFO",
  ALL: "全部测试",
};
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
    throw new Error("MQTT-SN 原生网关固定绑定 0.0.0.0，不能选择其他地址。");
  if (config.broker_host !== "127.0.0.1")
    throw new Error(
      "同容器私有 Broker 固定使用 127.0.0.1，不能连接外部 Broker。",
    );
  for (const [name, value] of [
    ["主 UDP 端口", config.port],
    ["发现 UDP 端口", config.discovery_port],
    ["私有 Broker TCP 端口", config.broker_port],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 65535)
      throw new Error(`${name}必须是 1～65535 之间的整数。`);
  }
  if (config.port === config.discovery_port)
    throw new Error("MQTT-SN 主 UDP 端口与发现 UDP 端口必须不同。");
  if (
    !validIpv4(config.discovery_group) ||
    Number(config.discovery_group.split(".")[0]) < 224 ||
    Number(config.discovery_group.split(".")[0]) > 239
  )
    throw new Error(
      "发现组地址必须是 IPv4 组播地址（224.0.0.0～239.255.255.255）。",
    );
  if (
    !Number.isInteger(config.gateway_id) ||
    config.gateway_id < 1 ||
    config.gateway_id > 255
  )
    throw new Error("网关 ID 必须是 1～255 之间的整数。");
  if (
    config.predefined_topics.length < 1 ||
    config.predefined_topics.length > 16
  )
    throw new Error("请配置 1～16 条预定义主题。");
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const [index, item] of config.predefined_topics.entries()) {
    if (
      !Number.isInteger(item.topic_id) ||
      item.topic_id < 1 ||
      item.topic_id > 65534
    )
      throw new Error(
        `第 ${index + 1} 条预定义主题 ID 必须是 1～65534 之间的整数。`,
      );
    if (!/^[\x21-\x7e]{1,128}$/.test(item.topic) || /[,+#]/.test(item.topic))
      throw new Error(
        `第 ${index + 1} 条主题名须为 1～128 字节可见 ASCII，不能含空白、逗号、+ 或 #。`,
      );
    if (item.topic === "plab/test" || item.topic.startsWith("plab/test/"))
      throw new Error(
        `第 ${index + 1} 条主题名使用了测试保留命名空间 plab/test，请更换。`,
      );
    if (item.topic.startsWith("$"))
      throw new Error(
        `第 ${index + 1} 条主题名不能以 $ 开头；本实验不提供向 Broker 系统主题发布的能力。`,
      );
    if (ids.has(item.topic_id) || names.has(item.topic))
      throw new Error("预定义主题 ID 与主题名称均须分别唯一，不能重复。");
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
  return `UDP ${config.bind_ip}:${config.port} · 发现 ${config.discovery_group}:${config.discovery_port} · 网关 ID ${config.gateway_id} · 同容器私有 Broker ${config.broker_host}:${config.broker_port} TCP · ${config.predefined_topics.length} 条预定义主题`;
}
