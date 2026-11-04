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
export const dlt645CaseLabels: Record<string, string> = {
  READ_ADDRESS: "读取当前表地址",
  READ_DATA: "读取当前数据",
  STREAM: "分片、粘连与恢复",
  ERROR_RESPONSE: "实际异常回应",
  WRITE_PERIOD: "写周期并恢复",
  SECURITY_FIXTURE: "固定扩展 fixture 传输",
  ALL: "核心只读全部测试",
};
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
      "DL/T645 必须使用固定 dlt645-2007-tcp profile 和完整、无多余字段的配置。",
    );
  if (!validIpv4(config.bind_ip))
    throw new Error("绑定地址必须是有效 IPv4 地址。");
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      "绑定地址须为单播 IPv4 地址或 0.0.0.0，不能使用组播或广播地址。",
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("TCP 端口必须是 1～65535 之间的整数。");
  if (
    !/^[0-9]{12}$/.test(config.meter_address) ||
    config.meter_address === "999999999999"
  )
    throw new Error(
      "表地址必须是恰好 12 位 ASCII 十进制数字，不能使用广播地址 999999999999。",
    );
  if (
    !Number.isInteger(config.energy_hundredths) ||
    config.energy_hundredths < 0 ||
    config.energy_hundredths > 99999999
  )
    throw new Error(
      "软件能量初值必须是 0～99999999 之间的整数，以百分之一单位计数。",
    );
  if (
    !Number.isInteger(config.period_minutes) ||
    config.period_minutes < 1 ||
    config.period_minutes > 99
  )
    throw new Error("周期初值必须是 1～99 之间的整数分钟。");
  if (
    !Number.isInteger(config.max_connections) ||
    config.max_connections < 1 ||
    config.max_connections > 128
  )
    throw new Error("最大并发连接数必须是 1～128 之间的整数。");
  if (config.security.mode === "fixture") {
    if (
      !["07000001", "07000002", "07000003"].includes(
        config.security.request_di.toLowerCase(),
      )
    )
      throw new Error(
        "固定 fixture 的请求 DI 仅允许 07000001、07000002 或 07000003。",
      );
    if (config.security.response_di.toUpperCase() !== "070000FF")
      throw new Error("固定 fixture 的回应 DI 必须是 070000FF。");
    for (const [key, length] of [
      ["request_di", 8],
      ["response_di", 8],
      ["operator", 8],
      ["request_hex", 16],
      ["response_hex", 24],
    ] as const)
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(config.security[key]))
        throw new Error(
          `固定 fixture 的 ${key} 必须是恰好 ${length} 位十六进制字符，不带 0x、空格或分隔符。`,
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
      ? `固定传输 fixture（crypto_verified=false） · DI ${config.security.request_di} → ${config.security.response_di} · operator ${config.security.operator} · 请求 ${config.security.request_hex} · 回应 ${config.security.response_hex}`
      : "明确拒绝";
  return `TCP ${config.bind_ip}:${config.port} · 启动表地址 ${config.meter_address} · 软件能量初值 ${config.energy_hundredths}（百分之一单位） · 周期初值 ${config.period_minutes} 分钟 · 模拟编程键 ${config.programming_key_enabled ? "启用" : "禁用"} · 最多 ${config.max_connections} 个并发连接 · 扩展03 ${security}`;
}
