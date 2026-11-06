import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { validIpv4 } from "./dns-config.ts";

export type TelnetConfig = {
  bind_ip: string;
  port: number;
  banner: string;
  max_connections: number;
  max_line_bytes: number;
};
export const telnetDefaults: TelnetConfig = {
  bind_ip: "0.0.0.0",
  port: 2323,
  banner: "Protocol Target Lab Telnet",
  max_connections: 16,
  max_line_bytes: 4096,
};
export const telnetCaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  CONNECT: guideText("telnet.verification.telnet-config.001"),
  ECHO: guideText("telnet.verification.telnet-config.002"),
  OPTIONS: guideText("telnet.verification.telnet-config.003"),
  UNKNOWN_OPTION: guideText("telnet.verification.telnet-config.004"),
  ALL: guideText("telnet.verification.telnet-config.005"),
}));
export function isTelnetConfig(value: unknown): value is TelnetConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      "banner" in value &&
      typeof value.banner === "string" &&
      "max_line_bytes" in value &&
      typeof value.max_line_bytes === "number" &&
      "max_connections" in value &&
      typeof value.max_connections === "number" &&
      "bind_ip" in value &&
      typeof value.bind_ip === "string" &&
      "port" in value &&
      typeof value.port === "number",
  );
}
export function bannerByteLength(banner: string): number {
  return new TextEncoder().encode(banner).length;
}
export function validateTelnetConfig(config: TelnetConfig): void {
  if (!validIpv4(config.bind_ip))
    throw new Error(guideText("telnet.configuration.telnet-config.006"));
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      guideText("telnet.configuration.telnet-config.007"),
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error(guideText("telnet.configuration.telnet-config.008"));
  if (!config.banner.length || bannerByteLength(config.banner) > 256)
    throw new Error(guideText("telnet.configuration.telnet-config.009"));
  if (/[\x00-\x1f\x7f]/.test(config.banner))
    throw new Error(
      guideText("telnet.configuration.telnet-config.010"),
    );
  if (
    !Number.isInteger(config.max_connections) ||
    config.max_connections < 1 ||
    config.max_connections > 128
  )
    throw new Error(guideText("telnet.configuration.telnet-config.011"));
  if (
    !Number.isInteger(config.max_line_bytes) ||
    config.max_line_bytes < 64 ||
    config.max_line_bytes > 65536
  )
    throw new Error(
      guideText("telnet.configuration.telnet-config.012"),
    );
}
export function sameTelnetConfig(a: TelnetConfig, b: TelnetConfig): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.banner === b.banner &&
    a.max_connections === b.max_connections &&
    a.max_line_bytes === b.max_line_bytes
  );
}
