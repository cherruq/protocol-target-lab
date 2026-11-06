import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { validIpv4 } from "./dns-config.ts";

export type MqttConfig = {
  bind_ip: string;
  port: number;
  max_connections: number;
  max_packet_size: number;
};
export const mqttDefaults: MqttConfig = {
  bind_ip: "0.0.0.0",
  port: 18883,
  max_connections: 32,
  max_packet_size: 1048576,
};
export const mqttCaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  MQTT311_QOS0: "MQTT 3.1.1 · QoS 0",
  MQTT311_QOS1: "MQTT 3.1.1 · QoS 1",
  MQTT311_QOS2: "MQTT 3.1.1 · QoS 2",
  MQTT5_QOS0: "MQTT 5.0 · QoS 0",
  MQTT5_QOS1: "MQTT 5.0 · QoS 1",
  MQTT5_QOS2: "MQTT 5.0 · QoS 2",
  ALL: guideText("mqtt.verification.mqtt-config.001"),
}));
export function isMqttConfig(value: unknown): value is MqttConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      "max_connections" in value &&
      "max_packet_size" in value,
  );
}
export function validateMqttConfig(config: MqttConfig): void {
  if (!validIpv4(config.bind_ip))
    throw new Error(guideText("mqtt.configuration.mqtt-config.002"));
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      guideText("mqtt.configuration.mqtt-config.003"),
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error(guideText("mqtt.configuration.mqtt-config.004"));
  if (
    !Number.isInteger(config.max_connections) ||
    config.max_connections < 1 ||
    config.max_connections > 128
  )
    throw new Error(guideText("mqtt.configuration.mqtt-config.005"));
  if (
    !Number.isInteger(config.max_packet_size) ||
    config.max_packet_size < 128 ||
    config.max_packet_size > 1048576
  )
    throw new Error(
      guideText("mqtt.configuration.mqtt-config.006"),
    );
}
export function sameMqttConfig(a: MqttConfig, b: MqttConfig): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.max_connections === b.max_connections &&
    a.max_packet_size === b.max_packet_size
  );
}
