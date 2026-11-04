import { validIpv4 } from "./dns-config.ts";

export type Iec101Channel = {
  port: number;
  link_address: number;
  originator_address: number;
  common_address: number;
  single_char_ack: boolean;
  point: { ioa: number; value: boolean };
};
export type Iec101Config = {
  wire_profile: "iec101-unbalanced-dual";
  bind_ip: string;
  serial: { baud_rate: 9600; data_bits: 8; parity: "N"; stop_bits: 1 };
  single: Iec101Channel;
  double: Iec101Channel;
};
export const iec101Defaults: Iec101Config = {
  wire_profile: "iec101-unbalanced-dual",
  bind_ip: "0.0.0.0",
  serial: { baud_rate: 9600, data_bits: 8, parity: "N", stop_bits: 1 },
  single: {
    port: 24741,
    link_address: 1,
    originator_address: 0,
    common_address: 1,
    single_char_ack: false,
    point: { ioa: 1, value: true },
  },
  double: {
    port: 24742,
    link_address: 4660,
    originator_address: 7,
    common_address: 513,
    single_char_ack: false,
    point: { ioa: 1, value: true },
  },
};
export const iec101CaseLabels: Record<string, string> = {
  RESET_STATUS: "链路复位与状态",
  CLASS2: "二级数据与遥信",
  GI: "总召唤确认、数据与结束",
  STREAM: "原生期限内分片与粘连",
  ALL: "全部测试（默认双通道16项）",
};
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key))
  );
}
function channel(value: unknown): value is Iec101Channel {
  return (
    object(value) &&
    keys(value, [
      "port",
      "link_address",
      "originator_address",
      "common_address",
      "single_char_ack",
      "point",
    ]) &&
    ["port", "link_address", "originator_address", "common_address"].every(
      (key) => typeof value[key] === "number",
    ) &&
    typeof value.single_char_ack === "boolean" &&
    object(value.point) &&
    keys(value.point, ["ioa", "value"]) &&
    typeof value.point.ioa === "number" &&
    typeof value.point.value === "boolean"
  );
}
export function isIec101Config(value: unknown): value is Iec101Config {
  return (
    object(value) &&
    keys(value, ["wire_profile", "bind_ip", "serial", "single", "double"]) &&
    value.wire_profile === "iec101-unbalanced-dual" &&
    typeof value.bind_ip === "string" &&
    object(value.serial) &&
    keys(value.serial, ["baud_rate", "data_bits", "parity", "stop_bits"]) &&
    value.serial.baud_rate === 9600 &&
    value.serial.data_bits === 8 &&
    value.serial.parity === "N" &&
    value.serial.stop_bits === 1 &&
    channel(value.single) &&
    channel(value.double)
  );
}
export function validateIec101Config(config: Iec101Config): void {
  if (!isIec101Config(config))
    throw new Error(
      "IEC101 必须含固定 profile、9600/8N1 及两个完整通道；不支持 enabled 或多余字段。",
    );
  if (!validIpv4(config.bind_ip))
    throw new Error("绑定地址必须是有效 IPv4 地址。");
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      "绑定地址须为单播 IPv4 地址或 0.0.0.0，不能使用组播或广播地址。",
    );
  for (const kind of ["single", "double"] as const) {
    const c = config[kind];
    const name = kind === "single" ? "单字节通道" : "双字节通道";
    const max = kind === "single" ? 254 : 65534;
    const maxIoa = kind === "single" ? 255 : 16777215;
    for (const [key, low, high, label] of [
      ["port", 1, 65535, "TCP端口"],
      ["link_address", 1, max, "链路地址"],
      ["common_address", 1, max, "公共地址 CA"],
      ["originator_address", 0, kind === "single" ? 0 : 255, "发起地址 OA"],
    ] as const)
      if (!Number.isInteger(c[key]) || c[key] < low || c[key] > high)
        throw new Error(`${name}的${label}必须是 ${low}～${high} 之间的整数。`);
    if (
      !Number.isInteger(c.point.ioa) ||
      c.point.ioa < 1 ||
      c.point.ioa > maxIoa
    )
      throw new Error(`${name}的 IOA 必须是 1～${maxIoa} 之间的整数。`);
  }
  if (config.single.port === config.double.port)
    throw new Error("IEC101 两个通道的 TCP 端口必须不同。");
}
export function updateIec101Channel(
  config: Iec101Config,
  kind: "single" | "double",
  patch: Partial<Omit<Iec101Channel, "point">> & {
    point?: Partial<Iec101Channel["point"]>;
  },
): Iec101Config {
  return {
    ...config,
    [kind]: {
      ...config[kind],
      ...patch,
      point: { ...config[kind].point, ...patch.point },
    },
  };
}
export function sameIec101Config(a: Iec101Config, b: Iec101Config): boolean {
  return (
    a.wire_profile === b.wire_profile &&
    a.bind_ip === b.bind_ip &&
    a.serial.baud_rate === b.serial.baud_rate &&
    a.serial.data_bits === b.serial.data_bits &&
    a.serial.parity === b.serial.parity &&
    a.serial.stop_bits === b.serial.stop_bits &&
    (["single", "double"] as const).every(
      (key) =>
        a[key].port === b[key].port &&
        a[key].link_address === b[key].link_address &&
        a[key].originator_address === b[key].originator_address &&
        a[key].common_address === b[key].common_address &&
        a[key].single_char_ack === b[key].single_char_ack &&
        a[key].point.ioa === b[key].point.ioa &&
        a[key].point.value === b[key].point.value,
    )
  );
}
export function iec101Description(config: Iec101Config): string {
  return `9600/8N1（PTY请求） · ${(["single", "double"] as const)
    .map((kind) => {
      const c = config[kind];
      return `${kind} TCP ${config.bind_ip}:${c.port} · 宽度 ${kind === "single" ? "1/1/1/1" : "2/2/2/3"} · link ${c.link_address} / CA ${c.common_address} / ${kind === "single" ? "OA不在线编码" : `OA ${c.originator_address}`} / IOA ${c.point.ioa} / 模拟单点 ${c.point.value} / E5 ${c.single_char_ack ? "启用" : "禁用"}`;
    })
    .join("；")}`;
}
