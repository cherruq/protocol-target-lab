import { validIpv4 } from "./dns-config.ts";

export type RtcpConfig = {
  bind_ip: string;
  port: number;
  max_packet_size: number;
  packet_profile: "sr-sdes";
};
export const rtcpDefaults: RtcpConfig = {
  bind_ip: "0.0.0.0",
  port: 5005,
  max_packet_size: 2048,
  packet_profile: "sr-sdes",
};
export const rtcpCaseLabels: Record<string, string> = {
  SR_SDES: "SR 与匹配 CNAME",
  REPORT_BLOCKS: "SR 报告块",
  SDES_ITEMS: "SDES 项与未知项",
  PADDING: "末子包填充",
  ALL: "全部测试",
};
export function isRtcpConfig(value: unknown): value is RtcpConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      "bind_ip" in value &&
      typeof value.bind_ip === "string" &&
      "port" in value &&
      typeof value.port === "number" &&
      "max_packet_size" in value &&
      typeof value.max_packet_size === "number" &&
      "packet_profile" in value &&
      value.packet_profile === "sr-sdes" &&
      Object.keys(value).every((key) =>
        ["bind_ip", "port", "max_packet_size", "packet_profile"].includes(key),
      ),
  );
}
export function validateRtcpConfig(config: RtcpConfig): void {
  if (config.packet_profile !== "sr-sdes")
    throw new Error("RTCP 必须显式使用本实验固定的 sr-sdes profile。");
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
      "最大数据报容量必须是 64～65507 之间的整数字节数，包含完整 compound RTCP 数据报；容量无需四字节对齐。",
    );
}
export function sameRtcpConfig(a: RtcpConfig, b: RtcpConfig): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.max_packet_size === b.max_packet_size &&
    a.packet_profile === b.packet_profile
  );
}
export function rtcpDescription(config: RtcpConfig): string {
  return `UDP ${config.bind_ip}:${config.port} · 容量 ${config.max_packet_size.toLocaleString()} 字节（四字节对齐报文上限 ${(Math.floor(config.max_packet_size / 4) * 4).toLocaleString()} 字节） · 固定 SR+SDES profile`;
}
