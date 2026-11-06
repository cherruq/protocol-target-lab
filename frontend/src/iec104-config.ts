import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { validIpv4 } from "./dns-config.ts";

export type Iec104Address = { ca: number; ioa: number };
export type Iec104Config = {
  bind_ip: string;
  port: number;
  max_connections: number;
  points: {
    single: Iec104Address & { value: boolean };
    measured: Iec104Address & { value: number };
    command: Iec104Address;
  };
};
export const FLOAT32_MAX = 3.4028234663852886e38;
export const iec104Defaults: Iec104Config = {
  bind_ip: "0.0.0.0",
  port: 2404,
  max_connections: 16,
  points: {
    single: { ca: 1, ioa: 1, value: false },
    measured: { ca: 1, ioa: 100, value: 12.5 },
    command: { ca: 2, ioa: 1 },
  },
};
export const iec104CaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  CONNECT: guideText("iec104.verification.iec104-config.001"),
  GI: guideText("iec104.verification.iec104-config.002"),
  READ: guideText("iec104.verification.iec104-config.003"),
  COMMAND: guideText("iec104.verification.iec104-config.004"),
  ALL: guideText("iec104.verification.iec104-config.005"),
}));
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function address(value: unknown): value is Iec104Address {
  return (
    object(value) &&
    typeof value.ca === "number" &&
    typeof value.ioa === "number"
  );
}
export function isIec104Config(value: unknown): value is Iec104Config {
  return (
    object(value) &&
    typeof value.bind_ip === "string" &&
    typeof value.port === "number" &&
    typeof value.max_connections === "number" &&
    object(value.points) &&
    address(value.points.single) &&
    "value" in value.points.single &&
    typeof value.points.single.value === "boolean" &&
    address(value.points.measured) &&
    "value" in value.points.measured &&
    typeof value.points.measured.value === "number" &&
    address(value.points.command)
  );
}
export function validateIec104Config(config: Iec104Config): void {
  if (!validIpv4(config.bind_ip))
    throw new Error(guideText("iec104.configuration.iec104-config.012"));
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      guideText("iec104.configuration.iec104-config.013"),
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error(guideText("iec104.configuration.iec104-config.014"));
  if (
    !Number.isInteger(config.max_connections) ||
    config.max_connections < 1 ||
    config.max_connections > 64
  )
    throw new Error(guideText("iec104.configuration.iec104-config.015"));
  const seen = new Set<string>();
  for (const [role, name] of [
    ["single", guideText("iec104.configuration.iec104-config.016")],
    ["measured", guideText("iec104.configuration.iec104-config.017")],
    ["command", guideText("iec104.configuration.iec104-config.018")],
  ] as const) {
    const point = config.points[role];
    if (!Number.isInteger(point.ca) || point.ca < 1 || point.ca > 65534)
      throw new Error(`${name}${guideText("iec104.configuration.iec104-config.019")}`);
    if (!Number.isInteger(point.ioa) || point.ioa < 1 || point.ioa > 16777215)
      throw new Error(
        `${name}${guideText("iec104.configuration.iec104-config.020")}`,
      );
    const key = `${point.ca}/${point.ioa}`;
    if (seen.has(key))
      throw new Error(guideText("iec104.configuration.iec104-config.021"));
    seen.add(key);
  }
  if (typeof config.points.single.value !== "boolean")
    throw new Error(guideText("iec104.configuration.iec104-config.022"));
  const measured = config.points.measured.value;
  if (!Number.isFinite(measured) || Math.abs(measured) > FLOAT32_MAX)
    throw new Error(
      guideText("iec104.configuration.iec104-config.023"),
    );
}
export function sameIec104Config(a: Iec104Config, b: Iec104Config): boolean {
  return (
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.max_connections === b.max_connections &&
    a.points.single.ca === b.points.single.ca &&
    a.points.single.ioa === b.points.single.ioa &&
    a.points.single.value === b.points.single.value &&
    a.points.measured.ca === b.points.measured.ca &&
    a.points.measured.ioa === b.points.measured.ioa &&
    a.points.measured.value === b.points.measured.value &&
    a.points.command.ca === b.points.command.ca &&
    a.points.command.ioa === b.points.command.ioa
  );
}
export function iec104StartupDescription(config: Iec104Config): string {
  return `${guideText("iec104.configuration.iec104-config.006")}${config.points.single.ca} / IOA ${config.points.single.ioa}${guideText("iec104.configuration.iec104-config.007")}${config.points.single.value}${guideText("iec104.configuration.iec104-config.008")}${config.points.measured.ca} / IOA ${config.points.measured.ioa}${guideText("iec104.configuration.iec104-config.009")}${config.points.measured.value}${guideText("iec104.configuration.iec104-config.010")}${config.points.command.ca} / IOA ${config.points.command.ioa}${guideText("iec104.configuration.iec104-config.011")}${config.points.single.ca} / IOA ${config.points.single.ioa}`;
}
