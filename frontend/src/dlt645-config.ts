import { guideText, lazyGuidanceLabels } from "./protocol-description.ts";
import { validIpv4 } from "./dns-config.ts";

export type Dlt645Security =
  | { mode: "reject" }
  | {
      mode: "fixture";
      request_di: string;
      response_di: string;
      operator: string;
      request_hex: string;
      response_hex: string;
    };
export type Dlt645Config = {
  wire_profile: "dlt645-2007-tcp";
  bind_ip: string;
  port: number;
  meter_address: string;
  energy_hundredths: number;
  period_minutes: number;
  programming_key_enabled: boolean;
  max_connections: number;
  security: Dlt645Security;
};
export const dlt645Defaults: Dlt645Config = {
  wire_profile: "dlt645-2007-tcp",
  bind_ip: "0.0.0.0",
  port: 20645,
  meter_address: "000000000001",
  energy_hundredths: 12345678,
  period_minutes: 30,
  programming_key_enabled: false,
  max_connections: 16,
  security: { mode: "reject" },
};
export const dlt645FixtureDefaults: Extract<
  Dlt645Security,
  { mode: "fixture" }
> = {
  mode: "fixture",
  request_di: "07000001",
  response_di: "070000FF",
  operator: "00000000",
  request_hex: "0001020304050607",
  response_hex: "000102030405060708090a0b",
};
export const dlt645CaseLabels: Record<string, string> = lazyGuidanceLabels(() => ({
  READ_ADDRESS: guideText("dlt645.verification.dlt645-config.001"),
  READ_DATA: guideText("dlt645.verification.dlt645-config.002"),
  STREAM: guideText("dlt645.verification.dlt645-config.003"),
  ERROR_RESPONSE: guideText("dlt645.verification.dlt645-config.004"),
  WRITE_PERIOD: guideText("dlt645.verification.dlt645-config.005"),
  SECURITY_FIXTURE: guideText("dlt645.verification.dlt645-config.006"),
  ALL: guideText("dlt645.verification.dlt645-config.007"),
}));
const fixtureFields = [
  "request_di",
  "response_di",
  "operator",
  "request_hex",
  "response_hex",
] as const;
function securityShape(value: unknown): value is Dlt645Security {
  if (!value || typeof value !== "object" || !("mode" in value)) return false;
  if (value.mode === "reject") return Object.keys(value).length === 1;
  if (value.mode !== "fixture") return false;
  return (
    fixtureFields.every(
      (key) =>
        key in value &&
        typeof (value as Record<string, unknown>)[key] === "string",
    ) &&
    Object.keys(value).every(
      (key) => key === "mode" || fixtureFields.some((field) => field === key),
    )
  );
}
export function isDlt645Config(value: unknown): value is Dlt645Config {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  return (
    config.wire_profile === "dlt645-2007-tcp" &&
    ["bind_ip", "meter_address"].every(
      (key) => typeof config[key] === "string",
    ) &&
    ["port", "energy_hundredths", "period_minutes", "max_connections"].every(
      (key) => typeof config[key] === "number",
    ) &&
    typeof config.programming_key_enabled === "boolean" &&
    securityShape(config.security) &&
    Object.keys(config).every((key) =>
      [
        "wire_profile",
        "bind_ip",
        "port",
        "meter_address",
        "energy_hundredths",
        "period_minutes",
        "programming_key_enabled",
        "max_connections",
        "security",
      ].includes(key),
    )
  );
}
export function validateDlt645Config(config: Dlt645Config): void {
  if (!isDlt645Config(config))
    throw new Error(
      guideText("dlt645.configuration.dlt645-config.020"),
    );
  if (!validIpv4(config.bind_ip))
    throw new Error(guideText("dlt645.configuration.dlt645-config.021"));
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      guideText("dlt645.configuration.dlt645-config.022"),
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error(guideText("dlt645.configuration.dlt645-config.023"));
  if (
    !/^[0-9]{12}$/.test(config.meter_address) ||
    config.meter_address === "999999999999"
  )
    throw new Error(
      guideText("dlt645.configuration.dlt645-config.024"),
    );
  if (
    !Number.isInteger(config.energy_hundredths) ||
    config.energy_hundredths < 0 ||
    config.energy_hundredths > 99999999
  )
    throw new Error(
      guideText("dlt645.configuration.dlt645-config.025"),
    );
  if (
    !Number.isInteger(config.period_minutes) ||
    config.period_minutes < 1 ||
    config.period_minutes > 99
  )
    throw new Error(guideText("dlt645.configuration.dlt645-config.026"));
  if (
    !Number.isInteger(config.max_connections) ||
    config.max_connections < 1 ||
    config.max_connections > 128
  )
    throw new Error(guideText("dlt645.configuration.dlt645-config.027"));
  if (config.security.mode === "fixture") {
    if (
      !["07000001", "07000002", "07000003"].includes(
        config.security.request_di.toLowerCase(),
      )
    )
      throw new Error(
        guideText("dlt645.configuration.dlt645-config.028"),
      );
    if (config.security.response_di.toUpperCase() !== "070000FF")
      throw new Error(guideText("dlt645.configuration.dlt645-config.029"));
    for (const [key, length] of [
      ["request_di", 8],
      ["response_di", 8],
      ["operator", 8],
      ["request_hex", 16],
      ["response_hex", 24],
    ] as const)
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(config.security[key]))
        throw new Error(
          `${guideText("dlt645.configuration.dlt645-config.030")}${key}${guideText("dlt645.configuration.dlt645-config.031")}${length}${guideText("dlt645.configuration.dlt645-config.032")}`,
        );
  }
}
export function sameDlt645Config(a: Dlt645Config, b: Dlt645Config): boolean {
  return (
    a.wire_profile === b.wire_profile &&
    a.bind_ip === b.bind_ip &&
    a.port === b.port &&
    a.meter_address === b.meter_address &&
    a.energy_hundredths === b.energy_hundredths &&
    a.period_minutes === b.period_minutes &&
    a.programming_key_enabled === b.programming_key_enabled &&
    a.max_connections === b.max_connections &&
    a.security.mode === b.security.mode &&
    (a.security.mode === "reject" ||
      (b.security.mode === "fixture" &&
        fixtureFields.every(
          (key) =>
            a.security.mode === "fixture" &&
            b.security.mode === "fixture" &&
            a.security[key] === b.security[key],
        )))
  );
}
export function dlt645Description(config: Dlt645Config): string {
  const security =
    config.security.mode === "fixture"
      ? `${guideText("dlt645.configuration.dlt645-config.008")}${config.security.request_di} → ${config.security.response_di} · operator ${config.security.operator}${guideText("dlt645.configuration.dlt645-config.009")}${config.security.request_hex}${guideText("dlt645.configuration.dlt645-config.010")}${config.security.response_hex}`
      : guideText("dlt645.configuration.dlt645-config.011");
  return `TCP ${config.bind_ip}:${config.port}${guideText("dlt645.configuration.dlt645-config.014")}${config.meter_address}${guideText("dlt645.configuration.dlt645-config.015")}${config.energy_hundredths}${guideText("dlt645.configuration.dlt645-config.016")}${config.period_minutes}${guideText("dlt645.configuration.dlt645-config.017")}${config.programming_key_enabled ? guideText("dlt645.configuration.dlt645-config.012") : guideText("dlt645.configuration.dlt645-config.013")}${guideText("dlt645.configuration.dlt645-config.018")}${config.max_connections}${guideText("dlt645.configuration.dlt645-config.019")}${security}`;
}
