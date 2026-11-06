import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
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
export const rtpCaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  BASIC: guideText("rtp.verification.rtp-config.001"),
  CSRC_EXTENSION: guideText("rtp.verification.rtp-config.002"),
  PADDING: guideText("rtp.verification.rtp-config.003"),
  SEQUENCE: guideText("rtp.verification.rtp-config.004"),
  ALL: guideText("rtp.verification.rtp-config.005"),
}));
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
    throw new Error(guideText("rtp.configuration.rtp-config.008"));
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      guideText("rtp.configuration.rtp-config.009"),
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error(guideText("rtp.configuration.rtp-config.010"));
  if (
    !Number.isInteger(config.max_packet_size) ||
    config.max_packet_size < 64 ||
    config.max_packet_size > 65507
  )
    throw new Error(
      guideText("rtp.configuration.rtp-config.011"),
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
  return `UDP ${config.bind_ip}:${config.port}${guideText("rtp.configuration.rtp-config.006")}${config.max_packet_size.toLocaleString()}${guideText("rtp.configuration.rtp-config.007")}`;
}
