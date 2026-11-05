import { validIpv4 } from "./dns-config.ts";
export const profinetNScenarios = [
  "good",
  "wrong-seq",
  "bad-tlv",
  "wrong-port",
  "old-seq-first",
] as const;
export const profinetFScenarios = [
  "good",
  "wrong-seq",
  "missing-follow-up",
  "bad-tlv",
  "wrong-port",
  "old-seq-first",
  "truncated-follow-up",
  "follow-up-reserved",
  "follow-up-padding",
  "follow-up-duplicate-port",
  "follow-up-bad-end",
] as const;
export type ProfinetNScenario = (typeof profinetNScenarios)[number];
export type ProfinetFScenario = (typeof profinetFScenarios)[number];
export type ProfinetIpSuite = { ip: string; netmask: string; gateway: string };
export type ProfinetConfig = {
  wire_profile: "pnet-dcp-ptcp-lab-v1";
  link: { mode: "owned-data-l2" };
  test_peer_mac: string;
  dcp: {
    mac: string;
    initial_station_name: string;
    initial_ip_suite: ProfinetIpSuite;
  };
  ptcp_n: { mac: string; scenario: { mode: ProfinetNScenario } };
  ptcp_f: {
    mac: string;
    scenario: { mode: ProfinetFScenario };
    truncated_follow_up_size: number;
  };
};
export const profinetDefaults: ProfinetConfig = {
  wire_profile: "pnet-dcp-ptcp-lab-v1",
  link: { mode: "owned-data-l2" },
  test_peer_mac: "02:00:00:00:86:10",
  dcp: {
    mac: "02:00:00:00:86:20",
    initial_station_name: "protocol-target-lab-profinet",
    initial_ip_suite: {
      ip: "198.18.86.20",
      netmask: "255.255.255.0",
      gateway: "0.0.0.0",
    },
  },
  ptcp_n: { mac: "02:00:00:00:86:21", scenario: { mode: "good" } },
  ptcp_f: {
    mac: "02:00:00:00:86:22",
    scenario: { mode: "good" },
    truncated_follow_up_size: 37,
  },
};
export const profinetScenarioLabels: Record<ProfinetFScenario, string> = {
  good: "正常输出",
  "wrong-seq": "错误序号",
  "missing-follow-up": "缺少Delay FollowUp",
  "bad-tlv": "错误TLV长度",
  "wrong-port": "错误RequestorPort",
  "old-seq-first": "先发旧序号再发当前序号",
  "truncated-follow-up": "截断Delay FollowUp",
  "follow-up-reserved": "FollowUp保留位非零",
  "follow-up-padding": "FollowUp头部padding非零",
  "follow-up-duplicate-port": "FollowUp重复端口块",
  "follow-up-bad-end": "FollowUp错误End块",
};
export const profinetCaseLabels = {
  DCP_READ: "DCP识别与读取（7类×2轮）",
  PTCP_N_DELAY: "PTCP-N Delay无FU（2轮）",
  PTCP_F_DELAY: "PTCP-F Delay有FU（2轮）",
  PTCP_SYNC: "两PTCP节点单步Sync接纳（2轮）",
  PTCP_SYNC_FOLLOW_UP: "两节点Sync / FollowUp配对（2轮）",
  PTCP_ANNOUNCE: "两节点Announce接纳（2轮）",
  ALL: "三节点全部只读验证（24项）",
  DCP_WRITE_STATION_TEMP: "临时写站名并恢复当前/NV/OS",
  DCP_WRITE_IP_TEMP: "临时写IP并恢复当前/NV/OS",
  DCP_SIGNAL: "DCP Signal软件LED（2轮）",
};
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, k: string[]) {
  return (
    Object.keys(v).length === k.length &&
    Object.keys(v).every((x) => k.includes(x))
  );
}
export function isProfinetIpSuite(v: unknown): v is ProfinetIpSuite {
  return (
    object(v) &&
    keys(v, ["ip", "netmask", "gateway"]) &&
    ["ip", "netmask", "gateway"].every((k) => typeof v[k] === "string")
  );
}
export function isProfinetConfig(v: unknown): v is ProfinetConfig {
  return (
    object(v) &&
    keys(v, [
      "wire_profile",
      "link",
      "test_peer_mac",
      "dcp",
      "ptcp_n",
      "ptcp_f",
    ]) &&
    v.wire_profile === "pnet-dcp-ptcp-lab-v1" &&
    object(v.link) &&
    keys(v.link, ["mode"]) &&
    v.link.mode === "owned-data-l2" &&
    typeof v.test_peer_mac === "string" &&
    object(v.dcp) &&
    keys(v.dcp, ["mac", "initial_station_name", "initial_ip_suite"]) &&
    typeof v.dcp.mac === "string" &&
    typeof v.dcp.initial_station_name === "string" &&
    isProfinetIpSuite(v.dcp.initial_ip_suite) &&
    object(v.ptcp_n) &&
    keys(v.ptcp_n, ["mac", "scenario"]) &&
    typeof v.ptcp_n.mac === "string" &&
    object(v.ptcp_n.scenario) &&
    keys(v.ptcp_n.scenario, ["mode"]) &&
    typeof v.ptcp_n.scenario.mode === "string" &&
    profinetNScenarios.includes(v.ptcp_n.scenario.mode as ProfinetNScenario) &&
    object(v.ptcp_f) &&
    keys(v.ptcp_f, ["mac", "scenario", "truncated_follow_up_size"]) &&
    typeof v.ptcp_f.mac === "string" &&
    object(v.ptcp_f.scenario) &&
    keys(v.ptcp_f.scenario, ["mode"]) &&
    typeof v.ptcp_f.scenario.mode === "string" &&
    profinetFScenarios.includes(v.ptcp_f.scenario.mode as ProfinetFScenario) &&
    typeof v.ptcp_f.truncated_follow_up_size === "number"
  );
}
export function validProfinetInitialName(v: string) {
  const labels = v.split(".");
  return (
    v.length >= 1 &&
    v.length <= 240 &&
    labels.every(
      (l) =>
        l.length >= 1 &&
        l.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l),
    ) &&
    !/^port-\d{3}(?:-\d{5})?$/.test(labels[0]) &&
    !(labels.length === 4 && labels.every((l) => /^\d+$/.test(l)))
  );
}
function ipNumber(v: string) {
  return v.split(".").reduce((a, b) => a * 256 + Number(b), 0) >>> 0;
}
function unicast(n: number) {
  const first = n >>> 24;
  return first > 0 && first < 224 && first !== 127;
}
export function validateProfinetIpSuite(s: ProfinetIpSuite): void {
  if (!isProfinetIpSuite(s) || ![s.ip, s.netmask, s.gateway].every(validIpv4))
    throw new Error("DCP初始IP/mask/gateway须为完整标准IPv4。");
  const i = ipNumber(s.ip),
    m = ipNumber(s.netmask),
    g = ipNumber(s.gateway);
  if (i === 0 && m === 0 && g === 0) return;
  const h = ~m >>> 0;
  if (!unicast(i) || m === 0 || ((h + 1) & h) !== 0)
    throw new Error(
      "DCP初始IP须非0/8、127/8、组播/保留地址；mask须连续/1～32，或完整全零未配置suite。",
    );
  const host = (i & h) >>> 0;
  if (host === 0 || host === h)
    throw new Error(
      "DCP初始IP不能为网络/广播地址；非零/31或/32没有native允许的host。",
    );
  if (
    g !== 0 &&
    (!unicast(g) ||
      (g & m) >>> 0 !== (i & m) >>> 0 ||
      (g & h) === 0 ||
      (g & h) >>> 0 === h)
  )
    throw new Error("DCP gateway须为0.0.0.0或同网段合法host。");
}
function mac(v: string) {
  return (
    /^(?:[a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}$/.test(v) &&
    v !== "00:00:00:00:00:00" &&
    (parseInt(v.slice(0, 2), 16) & 1) === 0
  );
}
export function validateProfinetConfig(c: ProfinetConfig) {
  if (!isProfinetConfig(c))
    throw new Error(
      "PROFINET必须包含固定profile、6个完整字段及三个必需节点；不支持host link、单节点开关或多余字段。",
    );
  const macs = [c.test_peer_mac, c.dcp.mac, c.ptcp_n.mac, c.ptcp_f.mac];
  if (!macs.every(mac) || new Set(macs.map((m) => m.toLowerCase())).size !== 4)
    throw new Error(
      "DCP、PTCP-N/F与默认测试peer须为四个不同非零单播MAC；保存统一小写。",
    );
  if (!validProfinetInitialName(c.dcp.initial_station_name))
    throw new Error(
      "初始站名须为小写ASCII标签1～63、总长≤240，无空标签/边界连字符/末点，首标签不能为保留port-数字格式，不能是四段纯数字。此限制不用于runtime当前名。",
    );
  validateProfinetIpSuite(c.dcp.initial_ip_suite);
  if (
    !Number.isInteger(c.ptcp_f.truncated_follow_up_size) ||
    c.ptcp_f.truncated_follow_up_size < 16 ||
    c.ptcp_f.truncated_follow_up_size > 45
  )
    throw new Error(
      "PTCP-F截断长度须为16～45整数，非活跃时仍保存；若草稿无效，请选择truncated-follow-up修正。",
    );
}
export function normalizeProfinetConfig(c: ProfinetConfig): ProfinetConfig {
  validateProfinetConfig(c);
  return {
    ...c,
    link: { mode: "owned-data-l2" },
    test_peer_mac: c.test_peer_mac.toLowerCase(),
    dcp: {
      ...c.dcp,
      mac: c.dcp.mac.toLowerCase(),
      initial_ip_suite: { ...c.dcp.initial_ip_suite },
    },
    ptcp_n: {
      mac: c.ptcp_n.mac.toLowerCase(),
      scenario: { mode: c.ptcp_n.scenario.mode },
    },
    ptcp_f: {
      mac: c.ptcp_f.mac.toLowerCase(),
      scenario: { mode: c.ptcp_f.scenario.mode },
      truncated_follow_up_size: c.ptcp_f.truncated_follow_up_size,
    },
  };
}
export function sameProfinetConfig(a: ProfinetConfig, b: ProfinetConfig) {
  return (
    a.wire_profile === b.wire_profile &&
    a.link.mode === b.link.mode &&
    a.test_peer_mac.toLowerCase() === b.test_peer_mac.toLowerCase() &&
    a.dcp.mac.toLowerCase() === b.dcp.mac.toLowerCase() &&
    a.ptcp_n.mac.toLowerCase() === b.ptcp_n.mac.toLowerCase() &&
    a.ptcp_f.mac.toLowerCase() === b.ptcp_f.mac.toLowerCase() &&
    a.dcp.initial_station_name === b.dcp.initial_station_name &&
    (["ip", "netmask", "gateway"] as const).every(
      (k) => a.dcp.initial_ip_suite[k] === b.dcp.initial_ip_suite[k],
    ) &&
    a.ptcp_n.scenario.mode === b.ptcp_n.scenario.mode &&
    a.ptcp_f.scenario.mode === b.ptcp_f.scenario.mode &&
    Object.is(
      a.ptcp_f.truncated_follow_up_size,
      b.ptcp_f.truncated_follow_up_size,
    )
  );
}
export function profinetLinkDescription() {
  return "受管私有 management / data 双网络 · 三个同时真实MAC节点";
}
export function profinetDescription(value: unknown) {
  if (!isProfinetConfig(value)) return "PROFINET配置快照不匹配，请核对版本。";
  return `三节点同时运行 · DCP ${value.dcp.mac} 初始名${value.dcp.initial_station_name} / ${value.dcp.initial_ip_suite.ip}（仅新存储，不等于当前native值）· PTCP-N ${value.ptcp_n.mac}/${value.ptcp_n.scenario.mode} · PTCP-F ${value.ptcp_f.mac}/${value.ptcp_f.scenario.mode} 截断参数${value.ptcp_f.truncated_follow_up_size}`;
}
export function profinetReportLabel(method: string, snapshot: unknown) {
  if (!isProfinetConfig(snapshot)) return method;
  return `DCP / PTCP-N:${snapshot.ptcp_n.scenario.mode} / PTCP-F:${snapshot.ptcp_f.scenario.mode} · ${profinetCaseLabels[method as keyof typeof profinetCaseLabels] || method}（测试时启动快照，非实时native值）`;
}
