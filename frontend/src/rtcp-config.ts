import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
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
export const rtcpCaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  SR_SDES: guideText("rtcp.verification.rtcp-config.001"),
  REPORT_BLOCKS: guideText("rtcp.verification.rtcp-config.002"),
  SDES_ITEMS: guideText("rtcp.verification.rtcp-config.003"),
  PADDING: guideText("rtcp.verification.rtcp-config.004"),
  ALL: guideText("rtcp.verification.rtcp-config.005"),
}));
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
    throw new Error(guideText("rtcp.configuration.rtcp-config.009"));
  if (!validIpv4(config.bind_ip))
    throw new Error(guideText("rtcp.configuration.rtcp-config.010"));
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      guideText("rtcp.configuration.rtcp-config.011"),
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error(guideText("rtcp.configuration.rtcp-config.012"));
  if (
    !Number.isInteger(config.max_packet_size) ||
    config.max_packet_size < 64 ||
    config.max_packet_size > 65507
  )
    throw new Error(
      guideText("rtcp.configuration.rtcp-config.013"),
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
  return `UDP ${config.bind_ip}:${config.port}${guideText("rtcp.configuration.rtcp-config.006")}${config.max_packet_size.toLocaleString()}${guideText("rtcp.configuration.rtcp-config.007")}${(Math.floor(config.max_packet_size / 4) * 4).toLocaleString()}${guideText("rtcp.configuration.rtcp-config.008")}`;
}
