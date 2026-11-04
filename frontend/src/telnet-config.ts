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
export const telnetCaseLabels: Record<string, string> = {
  CONNECT: "连接与欢迎语",
  ECHO: "ECHO 往返",
  OPTIONS: "协议协商",
  UNKNOWN_OPTION: "未知选项拒绝",
  ALL: "全部测试",
};
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
    throw new Error("绑定地址必须是有效 IPv4 地址。");
  const first = Number(config.bind_ip.split(".")[0]);
  if ((first >= 224 && first <= 239) || config.bind_ip === "255.255.255.255")
    throw new Error(
      "绑定地址须为单播 IPv4 地址或 0.0.0.0，不能使用组播或广播地址。",
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("端口必须是 1～65535 之间的整数。");
  if (!config.banner.length || bannerByteLength(config.banner) > 256)
    throw new Error("欢迎语不能为空，UTF-8 编码后不能超过 256 字节。");
  if (/[\x00-\x1f\x7f]/.test(config.banner))
    throw new Error(
      "欢迎语不能包含 ASCII 控制字符，包括换行、回车、NUL、制表符或 DEL。",
    );
  if (
    !Number.isInteger(config.max_connections) ||
    config.max_connections < 1 ||
    config.max_connections > 128
  )
    throw new Error("最大连接数必须是 1～128 之间的整数。");
  if (
    !Number.isInteger(config.max_line_bytes) ||
    config.max_line_bytes < 64 ||
    config.max_line_bytes > 65536
  )
    throw new Error(
      "最大输入行必须是 64～65536 之间的整数字节数，去掉行尾 CRLF 后计数。",
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
