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
export const iec104CaseLabels: Record<string, string> = {
  CONNECT: "连接与启动数据传输",
  GI: "总召唤 GI",
  READ: "点读取 READ",
  COMMAND: "模拟单点直接命令",
  ALL: "全部测试",
};
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
    throw new Error("绑定地址必须是有效 IPv4 地址。");
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      "绑定地址须为单播 IPv4 地址或 0.0.0.0，不能使用组播或广播地址。",
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("端口必须是 1～65535 之间的整数。");
  if (
    !Number.isInteger(config.max_connections) ||
    config.max_connections < 1 ||
    config.max_connections > 64
  )
    throw new Error("最大连接数必须是 1～64 之间的整数。");
  const seen = new Set<string>();
  for (const [role, name] of [
    ["single", "单点遥信"],
    ["measured", "浮点测量"],
    ["command", "直接命令"],
  ] as const) {
    const point = config.points[role];
    if (!Number.isInteger(point.ca) || point.ca < 1 || point.ca > 65534)
      throw new Error(`${name}的公共地址 CA 必须是 1～65534 之间的整数。`);
    if (!Number.isInteger(point.ioa) || point.ioa < 1 || point.ioa > 16777215)
      throw new Error(
        `${name}的信息体地址 IOA 必须是 1～16777215 之间的整数。`,
      );
    const key = `${point.ca}/${point.ioa}`;
    if (seen.has(key))
      throw new Error("三个角色的 (CA, IOA) 地址组合必须全局唯一，不能重叠。");
    seen.add(key);
  }
  if (typeof config.points.single.value !== "boolean")
    throw new Error("单点启动初值必须是布尔值 true 或 false。");
  const measured = config.points.measured.value;
  if (!Number.isFinite(measured) || Math.abs(measured) > FLOAT32_MAX)
    throw new Error(
      "测量启动初值必须是有限 float32 范围内的数字（绝对值不超过约 3.4028234663852886 × 10³⁸）。",
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
  return `启动参数（非实时点值）：单点 CA ${config.points.single.ca} / IOA ${config.points.single.ioa}，初值 ${config.points.single.value}；测量 CA ${config.points.measured.ca} / IOA ${config.points.measured.ioa}，初值 ${config.points.measured.value}；DIRECT 命令 CA ${config.points.command.ca} / IOA ${config.points.command.ioa} → 模拟单点 CA ${config.points.single.ca} / IOA ${config.points.single.ioa}`;
}
