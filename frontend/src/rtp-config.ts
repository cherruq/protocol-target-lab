import { validIpv4 } from "./dns-config.ts";

export type RtpConfig = {
  bind_ip: string;
  port: number;
  max_packet_size: number;
};
export const rtpDefaults: RtpConfig = {
  bind_ip: "0.0.0.0",
  port: 5004,
  max_packet_size: 2048,
};
export const rtpCaseLabels: Record<string, string> = {
  BASIC: "基本头与实际接收",
  CSRC_EXTENSION: "CSRC 与扩展头",
  PADDING: "填充与载荷边界",
  SEQUENCE: "序号回绕与重复接收",
  ALL: "全部测试",
};
export function isRtpConfig(value: unknown): value is RtpConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      "bind_ip" in value &&
      typeof value.bind_ip === "string" &&
      "port" in value &&
      typeof value.port === "number" &&
      "max_packet_size" in value &&
      typeof value.max_packet_size === "number" &&
      Object.keys(value).every((key) =>
        ["bind_ip", "port", "max_packet_size"].includes(key),
      ),
  );
}
export function validateRtpConfig(config: RtpConfig): void {
  if (!validIpv4(config.bind_ip))
    throw new Error("绑定地址必须是有效 IPv4 地址。");
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      "绑定地址须为单播 IPv4 地址或 0.0.0.0，不能使用组播或广播地址。",
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("UDP 端口必须是 1～65535 之间的整数。");
  if (
    !Number.isInteger(config.max_packet_size) ||
    config.max_packet_size < 64 ||
    config.max_packet_size > 65507
  )
    throw new Error(
      "最大数据报容量必须是 64～65507 之间的整数字节数，包含完整 RTP 头部、扩展、载荷和填充。",
    );
}
export function sameRtpConfig(a: RtpConfig, b: RtpConfig): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.max_packet_size === b.max_packet_size
  );
}
export function rtpDescription(config: RtpConfig): string {
  return `UDP ${config.bind_ip}:${config.port} · 完整数据报最大 ${config.max_packet_size.toLocaleString()} 字节 · RTPv2 接收与结构观察`;
}
