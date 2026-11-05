import { validIpv4 } from "./dns-config.ts";
export const mplsScenarios = [
  "normal",
  "silent",
  "wrong-eth-src",
  "wrong-eth-dst",
  "wrong-ip-src",
  "wrong-ip-dst",
  "wrong-id",
  "wrong-seq",
  "wrong-payload",
  "bad-ip-checksum",
  "bad-icmp-checksum",
  "short-ethernet",
  "short-ipv4",
  "short-icmp",
] as const;
export type MplsScenario = (typeof mplsScenarios)[number];
export type MplsLink =
  | { mode: "docker-bridge" }
  | { mode: "host-interface"; interface: string };
export type MplsConfig = {
  wire_profile: "mpls-single-label-ipv4-icmp-echo";
  link: MplsLink;
  source_mac: string;
  source_ip: string;
  client_mac: string;
  client_ip: string;
  label: number;
  reply_ttl: number;
  scenario: { mode: MplsScenario };
};
export const mplsDefaults: MplsConfig = {
  wire_profile: "mpls-single-label-ipv4-icmp-echo",
  link: { mode: "docker-bridge" },
  source_mac: "02:00:00:00:58:20",
  source_ip: "198.18.58.20",
  client_mac: "02:00:00:00:58:10",
  client_ip: "198.18.58.10",
  label: 58,
  reply_ttl: 64,
  scenario: { mode: "normal" },
};
export const mplsScenarioLabels: Record<MplsScenario, string> = {
  normal: "正常无标签 IPv4 Echo Reply",
  silent: "静默（真实 accepted + suppressed）",
  "wrong-eth-src": "错误以太网源 MAC",
  "wrong-eth-dst": "错误以太网目的 MAC",
  "wrong-ip-src": "错误 IPv4 源地址",
  "wrong-ip-dst": "错误 IPv4 目的地址",
  "wrong-id": "错误 ICMP identifier（+1）",
  "wrong-seq": "错误 ICMP sequence（+1）",
  "wrong-payload": "错误 ICMP payload",
  "bad-ip-checksum": "错误 IPv4 校验和",
  "bad-icmp-checksum": "错误 ICMP 校验和",
  "short-ethernet": "13 字节 Ethernet 输出（能力可能不可用）",
  "short-ipv4": "33 字节截断 IPv4 输出",
  "short-icmp": "41 字节截断 ICMP 输出",
};
export const mplsCaseLabels = {
  ECHO: "当前场景 Echo 输出（2轮）",
  TC_TTL: "TC / shim TTL 边界（2轮）",
  PADDING: "奇数载荷与 Ethernet padding（2轮）",
  INVALID_REQUEST: "错误标签 / 过期 TTL 拒绝（2轮）",
  ALL: "当前生效场景全部8项",
};
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(v).length === expected.length &&
    Object.keys(v).every((k) => expected.includes(k))
  );
}
export function isMplsConfig(v: unknown): v is MplsConfig {
  return (
    object(v) &&
    keys(v, [
      "wire_profile",
      "link",
      "source_mac",
      "source_ip",
      "client_mac",
      "client_ip",
      "label",
      "reply_ttl",
      "scenario",
    ]) &&
    v.wire_profile === "mpls-single-label-ipv4-icmp-echo" &&
    object(v.link) &&
    (v.link.mode === "docker-bridge"
      ? keys(v.link, ["mode"])
      : v.link.mode === "host-interface" &&
        keys(v.link, ["mode", "interface"]) &&
        typeof v.link.interface === "string") &&
    ["source_mac", "source_ip", "client_mac", "client_ip"].every(
      (k) => typeof v[k] === "string",
    ) &&
    typeof v.label === "number" &&
    typeof v.reply_ttl === "number" &&
    object(v.scenario) &&
    keys(v.scenario, ["mode"]) &&
    typeof v.scenario.mode === "string" &&
    mplsScenarios.includes(v.scenario.mode as MplsScenario)
  );
}
function roleIp(v: string) {
  if (!validIpv4(v)) return false;
  const first = Number(v.split(".")[0]);
  return (
    first > 0 && !(first >= 224 && first <= 239) && v !== "255.255.255.255"
  );
}
function mac(v: string) {
  return (
    /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(v) &&
    v !== "00:00:00:00:00:00" &&
    (parseInt(v.slice(0, 2), 16) & 1) === 0
  );
}
export function validateMplsConfig(c: MplsConfig): void {
  if (!isMplsConfig(c))
    throw new Error(
      "MPLS 必须含固定 profile、完整9字段和严格 link / scenario；没有 bind_ip 或应用 port。",
    );
  if (
    !mac(c.source_mac) ||
    !mac(c.client_mac) ||
    c.source_mac.toLowerCase() === c.client_mac.toLowerCase()
  )
    throw new Error("目标与测试对端须使用不同的非零单播 MAC；保存统一小写。");
  if (
    !roleIp(c.source_ip) ||
    !roleIp(c.client_ip) ||
    c.source_ip === c.client_ip
  )
    throw new Error("两个协议角色 IPv4 须不同，不能是0/8、组播或全一广播。");
  if (
    c.link.mode === "host-interface" &&
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/.test(c.link.interface)
  )
    throw new Error(
      "接口名须为1～15个ASCII字符，以字母/数字/下划线开头，其余仅字母/数字/下划线/点/连字符。",
    );
  if (!Number.isInteger(c.label) || c.label < 16 || c.label > 1048575)
    throw new Error("MPLS label 须为16～1048575的整数。");
  if (!Number.isInteger(c.reply_ttl) || c.reply_ttl < 1 || c.reply_ttl > 255)
    throw new Error("IPv4回复 TTL 须为1～255的整数。");
}
export function normalizeMplsConfig(c: MplsConfig): MplsConfig {
  validateMplsConfig(c);
  return {
    ...c,
    source_mac: c.source_mac.toLowerCase(),
    client_mac: c.client_mac.toLowerCase(),
    link:
      c.link.mode === "docker-bridge"
        ? { mode: "docker-bridge" }
        : { mode: "host-interface", interface: c.link.interface },
    scenario: { mode: c.scenario.mode },
  };
}
export function sameMplsConfig(a: MplsConfig, b: MplsConfig) {
  return (
    a.wire_profile === b.wire_profile &&
    a.link.mode === b.link.mode &&
    (a.link.mode !== "host-interface" ||
      (b.link.mode === "host-interface" &&
        a.link.interface === b.link.interface)) &&
    a.source_mac.toLowerCase() === b.source_mac.toLowerCase() &&
    a.client_mac.toLowerCase() === b.client_mac.toLowerCase() &&
    a.source_ip === b.source_ip &&
    a.client_ip === b.client_ip &&
    Object.is(a.label, b.label) &&
    Object.is(a.reply_ttl, b.reply_ttl) &&
    a.scenario.mode === b.scenario.mode
  );
}
export function changeMplsLink(
  c: MplsConfig,
  mode: MplsLink["mode"],
  cachedInterface = "",
): MplsConfig {
  return {
    ...c,
    link:
      mode === "docker-bridge"
        ? { mode }
        : {
            mode,
            interface:
              c.link.mode === "host-interface"
                ? c.link.interface
                : cachedInterface,
          },
  };
}
export function mplsLinkDescription(c: MplsConfig) {
  return c.link.mode === "docker-bridge"
    ? "受管隔离内部 bridge · 两个真实 veth"
    : `现有 Ethernet 接口 ${c.link.interface}（启动核对实际 MAC）`;
}
export function mplsDescription(c: unknown) {
  if (!isMplsConfig(c)) return "MPLS配置快照类型不匹配，请核对版本。";
  return `${mplsLinkDescription(c)} · 目标 ${c.source_mac} / 角色IP ${c.source_ip} · 对端 ${c.client_mac} / 角色IP ${c.client_ip} · label ${c.label} · 新IPv4回复TTL ${c.reply_ttl} · ${c.scenario.mode}`;
}
export function mplsReportLabel(method: string, c: unknown) {
  if (!isMplsConfig(c)) return method;
  return `${c.scenario.mode} · ${c.link.mode} · ${method === "ALL" ? "当前场景8项" : mplsCaseLabels[method as keyof typeof mplsCaseLabels] || method}（测试时生效快照）`;
}
